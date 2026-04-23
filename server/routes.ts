import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import {
  runAnalysisPipeline,
  resumeAfterAiChoice,
  hasPendingAi,
  type PipelineSource,
} from "./analysis-pipeline";

// Strict aggregate caps to keep memory bounded:
// - per file: 10MB
// - per request: 12 files total, 60MB total bytes
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 12;
const MAX_TOTAL_BYTES_PER_REQUEST = 60 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES_PER_REQUEST,
    fields: 20,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/csv", "application/csv", "application/pdf", "text/plain"];
    const ext = file.originalname.toLowerCase().split(".").pop();
    if (allowed.includes(file.mimetype) || ext === "csv" || ext === "pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and PDF files are supported."));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Upload statement and begin analysis ──────────────────────────────────
  app.post(
    "/api/onboarding/upload",
    upload.fields([
      { name: "mpesa[]", maxCount: MAX_FILES_PER_REQUEST },
      { name: "bank[]", maxCount: MAX_FILES_PER_REQUEST },
      // Accept legacy unbracketed names too for backwards-compat. The
      // multer-level `files` cap (MAX_FILES_PER_REQUEST) bounds the
      // *aggregate* count across all fields, so this can't multiply
      // capacity.
      { name: "mpesa", maxCount: MAX_FILES_PER_REQUEST },
      { name: "bank", maxCount: MAX_FILES_PER_REQUEST },
    ]),
    async (req: Request, res: Response) => {
      try {
        const userId = req.body.userId as string;
        const isDemo = req.body.demo === "true";
        const smsText = (req.body.smsText as string | undefined)?.trim() || null;
        const annotation = (req.body.annotation as string | undefined)?.trim() || null;

        if (!userId) {
          return res.status(400).json({ error: "userId is required" });
        }

        // Verify user exists (or create a session user)
        let user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const mpesaFiles = [...(files?.["mpesa[]"] || []), ...(files?.mpesa || [])];
        const bankFiles = [...(files?.["bank[]"] || []), ...(files?.bank || [])];

        // Aggregate-bytes cap (defence in depth on top of multer's per-file
        // and per-request-file-count limits).
        const totalBytes = [...mpesaFiles, ...bankFiles].reduce(
          (n, f) => n + f.size,
          0
        );
        if (totalBytes > MAX_TOTAL_BYTES_PER_REQUEST) {
          return res.status(413).json({
            error: `Total upload size exceeds ${Math.round(
              MAX_TOTAL_BYTES_PER_REQUEST / (1024 * 1024)
            )}MB. Try fewer or smaller files.`,
          });
        }

        // Honesty rule: NEVER silently substitute demo data when a real upload
        // is expected. Either the user opts into the demo path or they must
        // attach at least one source (file or pasted SMS text).
        const hasAnySource = mpesaFiles.length > 0 || bankFiles.length > 0 || !!smsText;
        if (!isDemo && !hasAnySource) {
          return res.status(400).json({
            error:
              "No sources attached. Add at least one M-Pesa or bank statement, or paste M-Pesa SMS text.",
          });
        }

        const sourceFormatOf = (name: string): "pdf" | "csv" | "other" => {
          const ext = name.toLowerCase().split(".").pop();
          if (ext === "pdf") return "pdf";
          if (ext === "csv") return "csv";
          return "other";
        };

        const attachedSources = [
          ...mpesaFiles.map((f) => ({
            fileName: f.originalname,
            kind: "mpesa" as const,
            size: f.size,
            sourceFormat: sourceFormatOf(f.originalname),
          })),
          ...bankFiles.map((f) => ({
            fileName: f.originalname,
            kind: "bank" as const,
            size: f.size,
            sourceFormat: sourceFormatOf(f.originalname),
          })),
        ];

        // Create analysis job with all the upload context attached.
        const job = await storage.createAnalysisJob(userId, {
          attachedSources,
          smsText,
          annotation,
        });

        // Update user with job ID and stage
        await storage.updateUser(userId, {
          onboardingStage: "analyzing",
          onboardingJobId: job.id,
        });

        // Build the pipeline source list. The dispatcher routes every
        // M-Pesa file (CSV or PDF) and pasted SMS text to the right parser,
        // and bank PDFs go through the I&M Bank parser. Failures are HARD
        // errors — we never silently substitute demo data for a real upload.
        const sources: PipelineSource[] = [];
        for (const f of mpesaFiles) {
          sources.push({
            kind: "auto",
            buffer: f.buffer,
            fileName: f.originalname,
            sourceName: `M-Pesa statement (${f.originalname})`,
            source: "mpesa",
          });
        }
        for (const f of bankFiles) {
          sources.push({
            kind: "bank",
            buffer: f.buffer,
            fileName: f.originalname,
            sourceName: `Bank statement (${f.originalname})`,
            source: "bank",
          });
        }
        if (smsText) {
          sources.push({
            kind: "sms",
            text: smsText,
            sourceName: "M-Pesa SMS",
            source: "mpesa",
          });
        }

        // Run pipeline in background (don't await)
        runAnalysisPipeline(job.id, userId, sources, isDemo).catch(
          (err) => console.error("Pipeline error:", err)
        );

        res.json({ jobId: job.id });
      } catch (error: any) {
        console.error("Upload error:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ── Poll analysis job status ─────────────────────────────────────────────
  app.get("/api/onboarding/job/:jobId", async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getAnalysisJob(jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Get current onboarding state for user ───────────────────────────────
  app.get("/api/onboarding/state/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      let jobData = null;
      if (user.onboardingJobId) {
        jobData = await storage.getAnalysisJob(user.onboardingJobId);
      }

      res.json({
        stage: user.onboardingStage,
        jobId: user.onboardingJobId,
        job: jobData,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Resolve the "AI is offline" choice on a paused analysis job ──────────
  // The user has two options: retry Stage B, or continue with the basic
  // (deterministic) categorisation only. We never silently degrade —
  // this is always an explicit user choice.
  app.post(
    "/api/onboarding/job/:jobId/ai-choice",
    async (req: Request, res: Response) => {
      try {
        const { jobId } = req.params;
        const { choice, userId } = req.body as {
          choice?: string;
          userId?: string;
        };
        if (choice !== "retry" && choice !== "basic") {
          return res
            .status(400)
            .json({ error: "choice must be 'retry' or 'basic'" });
        }
        if (!userId || typeof userId !== "string") {
          return res.status(400).json({ error: "userId is required" });
        }
        const job = await storage.getAnalysisJob(jobId);
        if (!job) return res.status(404).json({ error: "Job not found" });
        // Authz: only the user who owns the job may resume it. We
        // intentionally return 404 rather than 403 to avoid leaking the
        // existence of jobs that belong to other users.
        if (job.userId !== userId) {
          return res.status(404).json({ error: "Job not found" });
        }
        if (job.status !== "ai_unavailable") {
          return res
            .status(409)
            .json({ error: `Job is in '${job.status}', not waiting on AI.` });
        }
        // Fail fast (and truthfully) if the in-memory pending state is
        // gone — e.g. the server restarted between the pause and the
        // user clicking a button. Without this check, a fire-and-forget
        // resume would return ok:true while the job sits stuck forever.
        if (!hasPendingAi(jobId)) {
          await storage.updateAnalysisJob(jobId, {
            status: "error",
            error:
              "This analysis can no longer be resumed. Please upload your statement again.",
            progressLabel: "Analysis expired",
          });
          return res.status(410).json({
            ok: false,
            reason:
              "This analysis can no longer be resumed. Please upload your statement again.",
          });
        }
        // Resume in the background — the client polls. resumeAfterAiChoice
        // mirrors any failure into the job row, so polling clients still
        // see the truth even though we return immediately.
        resumeAfterAiChoice(jobId, choice).catch((err) =>
          console.error("Resume error:", err)
        );
        res.json({ ok: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ── Submit gap-filling answer ────────────────────────────────────────────
  app.post("/api/onboarding/gap-fill", async (req: Request, res: Response) => {
    try {
      const { entityId, category, notes } = req.body;
      if (!entityId || !category) {
        return res.status(400).json({ error: "entityId and category are required" });
      }

      // Map the Kenyan-context answer chips onto the existing entity
      // category enum. domestic_worker / debt / friend don't have their
      // own enum slot yet, so we land them on the closest existing one
      // and preserve the user's exact answer in `notes` so nothing is
      // lost. Tier follows the answer, not the storage category.
      const categoryMap: Record<string, string> = {
        family: "family",
        chama: "chama",
        domestic_worker: "family",
        debt: "one_time",
        business: "business",
        friend: "one_time",
        unknown: "unknown",
      };
      const tierMap: Record<string, string> = {
        family: "2",
        chama: "2",
        domestic_worker: "2",
        debt: "1",
        business: "4",
        friend: "4",
        unknown: "unknown",
      };
      const labelMap: Record<string, string> = {
        family: "Family or relative",
        chama: "Chama or savings group",
        domestic_worker: "Domestic worker",
        debt: "Debt repayment",
        business: "Business",
        friend: "Friend (one-off)",
      };

      const storedCategory = categoryMap[category] || "unknown";
      const storedTier = tierMap[category] || "unknown";
      const storedNotes =
        category === "unknown"
          ? notes || null
          : labelMap[category]
            ? `${labelMap[category]}${notes ? ` — ${notes}` : ""}`
            : notes || null;

      await storage.updateEntity(entityId, {
        category: storedCategory as any,
        tier: storedTier as any,
        isUserResolved: true,
        notes: storedNotes,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Save final priority stack ────────────────────────────────────────────
  app.post("/api/onboarding/save-stack", async (req: Request, res: Response) => {
    try {
      const { userId, items, safeBuffer } = req.body;
      if (!userId || !items) {
        return res.status(400).json({ error: "userId and items are required" });
      }

      await storage.savePriorityStack(userId, items);
      await storage.updateUser(userId, {
        onboardingStage: "complete",
        safeBuffer: safeBuffer || 2000,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Get home screen data ─────────────────────────────────────────────────
  app.get("/api/home/:userId", async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const priorityStack = await storage.getPriorityStack(userId);
      const entities = await storage.getEntities(userId);

      let jobData = null;
      if (user.onboardingJobId) {
        jobData = await storage.getAnalysisJob(user.onboardingJobId);
      }

      res.json({
        user: {
          id: user.id,
          displayName: user.displayName || user.username,
          estimatedBalance: user.estimatedBalance,
          financialHealthScore: user.financialHealthScore,
          safeBuffer: user.safeBuffer,
        },
        priorityStack: priorityStack.sort((a, b) => a.rank - b.rank),
        summaryData: jobData?.summaryData || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Create or get demo user ──────────────────────────────────────────────
  app.post("/api/user/init", async (req: Request, res: Response) => {
    try {
      const { username, displayName } = req.body;
      const uname = username || `user_${Date.now()}`;

      let user = await storage.getUserByUsername(uname);
      if (!user) {
        user = await storage.createUser({
          username: uname,
          password: "demo",
          displayName: displayName || null,
        });
      }

      res.json({ userId: user.id, stage: user.onboardingStage });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
