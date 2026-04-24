import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { useRafiki } from "@/lib/rafiki-context";
import type { Goal } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoalWithStatus extends Goal {
  status: "on_track" | "at_risk" | "paused";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

function computePct(g: GoalWithStatus): number {
  if (!g.targetAmount || g.targetAmount === 0) return 0;
  return Math.min(1, (g.currentAmount ?? 0) / g.targetAmount);
}

// ── Circular Arc ──────────────────────────────────────────────────────────────

function CircleArc({ pct, status }: { pct: number; status: string }) {
  const r = 34;
  const cx = 44;
  const cy = 44;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(1, Math.max(0, pct)));
  const arcColor =
    status === "at_risk" ? "#FFA000" : status === "paused" ? "#bfc9c4" : "#00342b";

  return (
    <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} stroke="#e8e8e8" strokeWidth={6} fill="none" />
      {pct > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={arcColor}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      )}
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={13}
        fontWeight={500}
        fill="#1a1c1c"
        fontFamily="Inter, sans-serif"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

// ── Status Pill ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  paused: "Paused",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  on_track: { bg: "rgba(0,52,43,0.08)", text: "#00342b" },
  at_risk: { bg: "rgba(255,160,0,0.14)", text: "#b36200" },
  paused: { bg: "#f3f3f3", text: "#3f4945" },
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.paused;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 12px",
        borderRadius: 9999,
        background: c.bg,
        color: c.text,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Goal Card ─────────────────────────────────────────────────────────────────

function GoalCard({ goal }: { goal: GoalWithStatus }) {
  const pct = computePct(goal);

  return (
    <div
      data-testid={`card-goal-${goal.id}`}
      style={{
        background: "#ffffff",
        borderRadius: 24,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxShadow: "0 12px 32px rgba(0,52,43,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3
          style={{ fontSize: 16, fontWeight: 500, color: "#1a1c1c", margin: 0 }}
          data-testid={`text-goal-name-${goal.id}`}
        >
          {goal.name}
        </h3>
        <StatusPill status={goal.status} />
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <CircleArc pct={pct} status={goal.status} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-around" }}>
        <div style={{ textAlign: "center" }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "#3f4945",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
              margin: "0 0 4px",
            }}
          >
            Saved
          </p>
          <p
            style={{ fontSize: 15, fontWeight: 500, color: "#1a1c1c", margin: 0 }}
            data-testid={`text-goal-saved-${goal.id}`}
          >
            {fmt(goal.currentAmount ?? 0)}
          </p>
        </div>
        <div style={{ textAlign: "center" }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "#3f4945",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
              margin: "0 0 4px",
            }}
          >
            Target
          </p>
          <p
            style={{ fontSize: 15, fontWeight: 500, color: "#1a1c1c", margin: 0 }}
            data-testid={`text-goal-target-${goal.id}`}
          >
            {fmt(goal.targetAmount)}
          </p>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "#3f4945", textAlign: "center", margin: 0 }}>
        {fmt(goal.weeklyContribution ?? 0)} / week
      </p>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function GoalSkeleton() {
  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 24,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ height: 20, width: "55%", borderRadius: 8, background: "#e8e8e8" }} />
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: "50%",
          background: "#f3f3f3",
          alignSelf: "center",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-around" }}>
        <div style={{ height: 32, width: 80, borderRadius: 8, background: "#f3f3f3" }} />
        <div style={{ height: 32, width: 80, borderRadius: 8, background: "#f3f3f3" }} />
      </div>
    </div>
  );
}

// ── Goals Page ────────────────────────────────────────────────────────────────

export function Goals() {
  const { user } = useRafiki();
  const [, setLocation] = useLocation();
  const userId = user?.userId ?? "";

  const { data: goals, isLoading } = useQuery<GoalWithStatus[]>({
    queryKey: ["/api/user", userId, "goals"],
    queryFn: () => fetch(`/api/user/${userId}/goals`).then((r) => r.json()),
    enabled: !!userId,
  });

  const handleNewGoal = () => {
    setLocation("/chat?q=" + encodeURIComponent("I want to save for "));
  };

  return (
    <AppLayout>
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "24px 20px 32px",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#1a1c1c",
            marginBottom: 24,
            letterSpacing: "-0.01em",
          }}
          data-testid="text-goals-heading"
        >
          Savings goals
        </h1>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <GoalSkeleton />
            <GoalSkeleton />
          </div>
        )}

        {!isLoading && (!goals || goals.length === 0) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: 72,
              gap: 16,
            }}
            data-testid="goals-empty-state"
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#f3f3f3",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#3f4945" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="6" stroke="#3f4945" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="2" fill="#3f4945" />
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 16, fontWeight: 500, color: "#1a1c1c", marginBottom: 6 }}>
                No goals yet
              </p>
              <p style={{ fontSize: 14, color: "#3f4945", lineHeight: 1.5 }}>
                Tell RAFIKI what you're saving for and it will set one up for you.
              </p>
            </div>
          </div>
        )}

        {!isLoading && goals && goals.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {goals.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </div>
        )}
      </div>

      <button
        data-testid="button-new-goal"
        onClick={handleNewGoal}
        style={{
          position: "fixed",
          bottom: 88,
          right: 20,
          height: 52,
          paddingLeft: 20,
          paddingRight: 20,
          borderRadius: 9999,
          background: "linear-gradient(135deg, #00342b, #004d40)",
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 500,
          border: "none",
          cursor: "pointer",
          boxShadow: "0 12px 32px rgba(0,52,43,0.18)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "'Inter', sans-serif",
          letterSpacing: "0.01em",
          zIndex: 40,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        </svg>
        New goal
      </button>
    </AppLayout>
  );
}
