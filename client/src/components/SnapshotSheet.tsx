import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useHealthScore, useGoals } from "@/hooks/useFinancialData";

interface StackItem {
  id: string;
  rank: number;
  label: string;
  monthlyAmount: number;
  tier: string;
  isActive?: boolean;
}

interface SnapshotSheetProps {
  userId: string;
  stack: StackItem[];
  onClose: () => void;
}

function healthLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Good shape", color: "#00342b" };
  if (score >= 40) return { label: "Watch out", color: "#FFA000" };
  return { label: "At risk", color: "#c0392b" };
}

function ScoreArc({ score, size = 140 }: { score: number; size?: number }) {
  const r = 52;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const { label, color } = healthLabel(score);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Health score ${score} out of 100`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f3f3" strokeWidth={9} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        fontSize={28}
        fontWeight={500}
        fontFamily="Inter, sans-serif"
        fill="#1a1c1c"
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fontSize={11}
        fontWeight={500}
        fontFamily="Inter, sans-serif"
        fill={color}
      >
        {label}
      </text>
    </svg>
  );
}

function GoalArc({ pct, size = 80 }: { pct: number; size?: number }) {
  const r = 32;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.max(0, Math.min(1, pct)));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f3f3" strokeWidth={7} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#00342b"
        strokeWidth={7}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={500} fontFamily="Inter, sans-serif" fill="#1a1c1c">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

function SpendingBar({ label, amount, maxAmount, tier }: { label: string; amount: number; maxAmount: number; tier: string }) {
  const pct = maxAmount > 0 ? Math.max(4, (amount / maxAmount) * 100) : 4;
  const barColor = tier === "1" ? "#00342b" : "#4755b6";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 400, color: "#3f4945", width: 100, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 6, borderRadius: 6, background: "#f3f3f3", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 6, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 500, color: "#1a1c1c", width: 72, textAlign: "right", flexShrink: 0 }}>
        KSh {amount.toLocaleString()}
      </span>
    </div>
  );
}

export function SnapshotSheet({ userId, stack, onClose }: SnapshotSheetProps) {
  const healthQ = useHealthScore(userId);
  const goalsQ = useGoals(userId);
  const sheetRef = useRef<HTMLDivElement>(null);

  const health = healthQ.data;
  const goals = goalsQ.data ?? [];
  const topGoal = goals.find((g) => g.status !== "paused") ?? null;

  const activeStack = stack.filter((i) => i.isActive !== false);
  const maxAmount = Math.max(...activeStack.map((i) => i.monthlyAmount), 1);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const projectedCompletion = (goal: typeof topGoal): string => {
    if (!goal) return "";
    if (goal.deadline) {
      const d = new Date(goal.deadline);
      return d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
    }
    const remaining = goal.targetAmount - (goal.currentAmount ?? 0);
    const weekly = goal.weeklyContribution ?? 0;
    if (weekly <= 0) return "—";
    const weeks = Math.ceil(remaining / weekly);
    const d = new Date();
    d.setDate(d.getDate() + weeks * 7);
    return d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
  };

  return (
    <>
      {/* Overlay */}
      <div
        data-testid="snapshot-overlay"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)",
          zIndex: 100, animation: "fadeIn 0.2s ease",
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        data-testid="snapshot-sheet"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "#ffffff",
          borderRadius: "24px 24px 0 0",
          zIndex: 101,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 -12px 32px rgba(0,52,43,0.08)",
          animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e8e8e8" }} />
        </div>

        <div style={{ padding: "16px 24px 32px" }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <span style={{ fontSize: 16, fontWeight: 500, color: "#1a1c1c" }}>Financial Snapshot</span>
            <button
              data-testid="snapshot-close"
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#3f4945" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Health arc */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            {healthQ.isLoading ? (
              <div style={{ width: 140, height: 140, borderRadius: "50%", background: "#f3f3f3", animation: "pulse 1.5s ease-in-out infinite" }} />
            ) : health ? (
              <>
                <ScoreArc score={health.score} />
                <p style={{ marginTop: 12, fontSize: 13, fontWeight: 400, color: "#3f4945", textAlign: "center", maxWidth: 280, lineHeight: 1.5 }}>
                  {health.explanation}
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#3f4945" }}>Couldn't load your health score right now.</p>
            )}
          </div>

          {/* Spending breakdown */}
          {activeStack.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 12 }}>
                Monthly obligations
              </p>
              {activeStack.map((item) => (
                <SpendingBar
                  key={item.id}
                  label={item.label}
                  amount={item.monthlyAmount}
                  maxAmount={maxAmount}
                  tier={item.tier}
                />
              ))}
            </div>
          )}

          {/* Top goal */}
          {topGoal && (
            <div
              style={{
                background: "#f9f9f9",
                borderRadius: 20,
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginBottom: 24,
              }}
            >
              <GoalArc pct={(topGoal.currentAmount ?? 0) / topGoal.targetAmount} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#1a1c1c", marginBottom: 2 }}>{topGoal.name}</p>
                <p style={{ fontSize: 12, color: "#3f4945" }}>
                  KSh {(topGoal.currentAmount ?? 0).toLocaleString()} of KSh {topGoal.targetAmount.toLocaleString()}
                </p>
                <p style={{ fontSize: 11, color: "#00342b", marginTop: 2 }}>
                  On track for {projectedCompletion(topGoal)}
                </p>
              </div>
            </div>
          )}

          {/* See full activity */}
          <div style={{ textAlign: "center" }}>
            <Link
              href="/activity"
              data-testid="link-see-activity"
              style={{ fontSize: 13, fontWeight: 500, color: "#00342b", textDecoration: "none" }}
              onClick={onClose}
            >
              See full activity
            </Link>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }
      `}</style>
    </>
  );
}
