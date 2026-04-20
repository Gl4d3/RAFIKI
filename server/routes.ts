import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { runAnalysisPipeline } from "./analysis-pipeline";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
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
      { name: "mpesa", maxCount: 1 },
      { name: "bank", maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      try {
        const userId = req.body.userId as string;
        const isDemo = req.body.demo === "true";

        if (!userId) {
          return res.status(400).json({ error: "userId is required" });
        }

        // Verify user exists (or create a session user)
        let user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        // Create analysis job
        const job = await storage.createAnalysisJob(userId);

        // Update user with job ID and stage
        await storage.updateUser(userId, {
          onboardingStage: "analyzing",
          onboardingJobId: job.id,
        });

        // Get file buffer
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const mpesaFile = files?.mpesa?.[0];
        const fileBuffer = mpesaFile?.buffer || Buffer.alloc(0);

        // Run pipeline in background (don't await)
        runAnalysisPipeline(job.id, userId, fileBuffer, isDemo || !mpesaFile).catch(
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

  // ── Submit gap-filling answer ────────────────────────────────────────────
  app.post("/api/onboarding/gap-fill", async (req: Request, res: Response) => {
    try {
      const { entityId, category, notes } = req.body;
      if (!entityId || !category) {
        return res.status(400).json({ error: "entityId and category are required" });
      }

      // Determine tier from category
      const tierMap: Record<string, string> = {
        rent: "1", utilities: "1", transport: "1", food: "1", healthcare: "1",
        family: "2", chama: "2", education: "2",
        savings: "3",
        entertainment: "4", merchant: "4", one_time: "4",
        unknown: "unknown",
      };

      await storage.updateEntity(entityId, {
        category: category as any,
        tier: (tierMap[category] || "unknown") as any,
        isUserResolved: true,
        notes: notes || null,
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
