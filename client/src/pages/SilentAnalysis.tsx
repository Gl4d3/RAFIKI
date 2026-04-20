import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";

const STAGES = [
  { label: "Reading your statement...", pct: 10 },
  { label: "Identifying transactions...", pct: 25 },
  { label: "Categorising spending...", pct: 45 },
  { label: "Finding recurring obligations...", pct: 60 },
  { label: "Identifying income sources...", pct: 75 },
  { label: "Building your financial model...", pct: 85 },
  { label: "RAFIKI is reading your results...", pct: 92 },
  { label: "Almost ready...", pct: 97 },
];

export const SilentAnalysis = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, setStage } = useRafiki();
  const [progress, setProgress] = useState(5);
  const [label, setLabel] = useState("Starting...");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const jobId = user?.jobId;
    if (!jobId) {
      // No job — redirect to upload
      setLocation("/");
      return;
    }

    const poll = async () => {
      try {
        const resp = await fetch(`/api/onboarding/job/${jobId}`);
        if (!resp.ok) return;
        const job = await resp.json();

        setProgress(job.progress || 5);
        setLabel(job.progressLabel || "Processing...");

        if (job.status === "complete") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStage("reveal");
          setTimeout(() => setLocation("/reveal"), 600);
        } else if (job.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(job.error || "Analysis failed. Please try again.");
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    };

    poll();
    pollRef.current = setInterval(poll, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user?.jobId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#f9f9f9] px-6">
        <p className="text-[#1a1c1c] text-lg font-medium mb-2">Something went wrong</p>
        <p className="text-[#3f4945] text-sm text-center mb-8">{error}</p>
        <button
          onClick={() => setLocation("/")}
          className="h-12 px-8 rounded-full text-white text-sm font-medium"
          style={{ background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)", border: "none" }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen bg-[#f9f9f9] overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Subtle background blobs */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 256, height: 256,
          top: 120, right: -80,
          background: "rgba(138,153,254,0.05)",
          filter: "blur(40px)",
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 288, height: 288,
          bottom: 200, left: -80,
          background: "rgba(0,52,43,0.05)",
          filter: "blur(50px)",
        }}
      />

      {/* Main content */}
      <div className="relative flex flex-col items-center gap-12 max-w-[390px] w-full px-8">
        {/* Animated ring */}
        <div className="relative flex items-center justify-center">
          <div
            className="absolute rounded-full animate-ping"
            style={{ width: 120, height: 120, background: "rgba(0,52,43,0.06)" }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: 96, height: 96, background: "rgba(0,52,43,0.08)", animation: "pulse 2s infinite" }}
          />
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Progress text */}
        <div className="flex flex-col items-center gap-4 w-full">
          <p
            className="text-[#1a1c1c] text-base text-center leading-6"
            style={{ minHeight: 24 }}
          >
            {label}
          </p>

          {/* Progress bar */}
          <div className="w-full h-1 rounded-full bg-[#e8e8e8] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, #00342b 0%, #4755b6 100%)",
              }}
            />
          </div>
          <p className="text-[#3f4945] text-sm">{progress}%</p>
        </div>

        {/* Status labels */}
        <div className="flex flex-col items-center gap-2">
          {STAGES.filter((s) => s.pct <= progress).slice(-3).map((s, i, arr) => (
            <p
              key={s.label}
              className="text-[#3f4945] text-sm text-center transition-opacity duration-500"
              style={{ opacity: i === arr.length - 1 ? 1 : 0.4 }}
            >
              {s.label}
            </p>
          ))}
        </div>
      </div>

      {/* Brand */}
      <div className="absolute bottom-12 flex flex-col items-center gap-1">
        <span className="text-[#00342b] text-lg font-medium tracking-[-0.5px]">
          Rafiki
        </span>
        <p className="text-[#3f4945] text-xs opacity-50">
          Analysing your finances...
        </p>
      </div>
    </div>
  );
};
