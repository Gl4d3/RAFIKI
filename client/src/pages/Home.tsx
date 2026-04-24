import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";
import { useFinancialState, useHealthScore, useNudge } from "@/hooks/useFinancialData";
import { AppLayout } from "@/components/AppLayout";
import { SnapshotSheet } from "@/components/SnapshotSheet";
import { useQuery } from "@tanstack/react-query";

interface StackItem {
  id: string;
  rank: number;
  label: string;
  monthlyAmount: number;
  tier: string;
  isActive: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function healthDot(score: number | undefined): string {
  if (score === undefined) return "#bfc9c4";
  if (score >= 70) return "#00342b";
  if (score >= 40) return "#FFA000";
  return "#c0392b";
}

function SkeletonBlock({ width, height, radius = 8 }: { width: number | string; height: number; radius?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: "linear-gradient(90deg, #f3f3f3 25%, #e8e8e8 50%, #f3f3f3 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
      }}
    />
  );
}

export const Home = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user } = useRafiki();
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const userId = user?.userId;

  useEffect(() => {
    if (!userId) { setLocation("/"); return; }
    if (user?.stage && user.stage !== "complete") { setLocation("/"); return; }
  }, [userId, user?.stage]);

  const financialQ = useFinancialState(userId);
  const healthQ = useHealthScore(userId);
  const nudgeQ = useNudge(userId);

  const stackQ = useQuery<StackItem[]>({
    queryKey: ["/api/user", userId, "stack"],
    queryFn: () =>
      fetch(`/api/user/${userId}/stack`).then((r) => {
        if (!r.ok) throw new Error("Failed to load stack");
        return r.json();
      }),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const displayName = user?.displayName || "You";
  const financial = financialQ.data;
  const health = healthQ.data;
  const stack = stackQ.data ?? [];
  const isLoading = financialQ.isLoading;

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setLocation(`/chat?q=${encodeURIComponent(inputValue.trim())}`);
  };

  const quickActions = [
    { label: "Send money", intent: "Send money", testId: "pill-send-money" },
    { label: "How am I doing?", intent: "How am I doing?", testId: "pill-how-doing" },
    { label: "What's coming up", intent: "What's coming up", testId: "pill-whats-coming" },
  ];

  return (
    <AppLayout>
      <div style={{ maxWidth: 420, margin: "0 auto", paddingTop: 52, paddingBottom: 16, paddingLeft: 20, paddingRight: 20 }}>

        {/* Emergency brake strip — static off state */}
        <div
          data-testid="emergency-brake-strip"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f3f3f3",
            borderRadius: 10,
            padding: "6px 14px",
            marginBottom: 20,
            cursor: "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#bfc9c4" }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: "#3f4945", letterSpacing: "0.02em" }}>
              Emergency Brake
            </span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#bfc9c4", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Off
          </span>
        </div>

        {/* Greeting */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 22, fontWeight: 500, color: "#1a1c1c", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {greeting()}, {displayName.split(" ")[0]}
          </p>
        </div>

        {/* Available float card */}
        <div
          data-testid="card-float"
          style={{
            background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)",
            borderRadius: 24,
            padding: 24,
            position: "relative",
            overflow: "hidden",
            marginBottom: 16,
          }}
        >
          <div style={{ position: "absolute", width: 180, height: 180, right: -50, top: -50, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
          <div style={{ position: "absolute", width: 120, height: 120, right: 30, bottom: -60, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />

          <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.6)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
            Available to spend
          </p>

          {isLoading ? (
            <div style={{ marginBottom: 20 }}>
              <SkeletonBlock width="60%" height={40} radius={8} />
            </div>
          ) : financial ? (
            <p
              data-testid="text-available-float"
              style={{ fontSize: 38, fontWeight: 500, color: "#ffffff", letterSpacing: "-0.02em", marginBottom: 20, lineHeight: 1.1 }}
            >
              KSh {Math.round(financial.availableFloat).toLocaleString()}
            </p>
          ) : (
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.6)", marginBottom: 20 }}>
              Couldn't load your balance right now.
            </p>
          )}

          {/* Health score row — tapping opens Snapshot Sheet */}
          <button
            data-testid="button-open-snapshot"
            onClick={() => setSnapshotOpen(true)}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: 12,
              padding: "10px 14px",
              cursor: "pointer",
              width: "100%",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {healthQ.isLoading ? (
              <SkeletonBlock width="80%" height={14} radius={4} />
            ) : (
              <>
                <span
                  data-testid="dot-health-score"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: healthDot(health?.score),
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.85)", flex: 1 }}>
                  {health ? health.explanation : "Tap to see your financial health"}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
        </div>

        {/* RAFIKI nudge card */}
        <div
          data-testid="card-nudge"
          style={{
            background: "#ffffff",
            borderRadius: 20,
            padding: "16px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "rgba(0,52,43,0.08)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {nudgeQ.isLoading ? (
            <div style={{ flex: 1, paddingTop: 4 }}>
              <SkeletonBlock width="90%" height={14} radius={4} />
            </div>
          ) : (
            <p
              data-testid="text-nudge"
              style={{ fontSize: 13, fontWeight: 400, color: "#1a1c1c", lineHeight: 1.55, flex: 1 }}
            >
              {nudgeQ.data?.nudge ?? "Your finances are loading — check back in a moment."}
            </p>
          )}
        </div>

        {/* Quick action pills */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {quickActions.map((action) => (
            <button
              key={action.label}
              data-testid={action.testId}
              onClick={() => setLocation(`/chat?q=${encodeURIComponent(action.intent)}`)}
              style={{
                background: "#ffffff",
                border: "none",
                borderRadius: 999,
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 500,
                color: "#00342b",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Priority stack preview */}
        {stack.length > 0 && (
          <div
            data-testid="card-priority-stack"
            style={{ background: "#ffffff", borderRadius: 20, padding: 20, marginBottom: 16 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: "#1a1c1c" }}>Priority Stack</span>
              <button
                data-testid="link-edit-stack"
                onClick={() => setLocation("/priority-stack")}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500, color: "#00342b" }}
              >
                Edit
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {stack.filter((i) => i.isActive).slice(0, 4).map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: item.tier === "1" ? "rgba(175,239,221,0.5)" : item.tier === "2" ? "rgba(71,85,182,0.1)" : "#f3f3f3",
                      color: item.tier === "1" ? "#00342b" : item.tier === "2" ? "#4755b6" : "#3f4945",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                    data-testid={`badge-tier-${item.id}`}
                  >
                    {item.rank}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 400, color: "#1a1c1c", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#3f4945", flexShrink: 0 }}>
                    KSh {item.monthlyAmount.toLocaleString()}
                  </span>
                </div>
              ))}
              {stack.filter((i) => i.isActive).length > 4 && (
                <p style={{ fontSize: 11, color: "#bfc9c4", marginTop: 2 }}>
                  +{stack.filter((i) => i.isActive).length - 4} more
                </p>
              )}
            </div>
          </div>
        )}

        {/* Balance context */}
        {financial && (
          <div style={{ background: "#f3f3f3", borderRadius: 16, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase" }}>Balance</span>
              <span data-testid="text-current-balance" style={{ fontSize: 16, fontWeight: 500, color: "#1a1c1c" }}>
                KSh {Math.round(financial.currentBalance).toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase" }}>Safe buffer</span>
              <span style={{ fontSize: 16, fontWeight: 500, color: "#4755b6" }}>
                KSh {Math.round(financial.safeBuffer).toLocaleString()}
              </span>
            </div>
          </div>
        )}

      </div>

      {/* Input bar — above bottom nav, full width */}
      <div
        style={{
          position: "fixed",
          bottom: 72,
          left: 0,
          right: 0,
          padding: "10px 16px",
          background: "rgba(249,249,249,0.9)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          zIndex: 40,
        }}
      >
        <form onSubmit={handleInputSubmit} style={{ maxWidth: 420, margin: "0 auto" }}>
          <div style={{ position: "relative" }}>
            <input
              data-testid="input-chat-query"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask RAFIKI anything..."
              style={{
                width: "100%",
                height: 46,
                borderRadius: 999,
                background: "#ffffff",
                border: "none",
                paddingLeft: 20,
                paddingRight: 52,
                fontSize: 14,
                fontWeight: 400,
                color: "#1a1c1c",
                fontFamily: "Inter, sans-serif",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              data-testid="button-chat-submit"
              disabled={!inputValue.trim()}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: inputValue.trim() ? "linear-gradient(135deg, #00342b 0%, #004d40 100%)" : "#f3f3f3",
                border: "none",
                cursor: inputValue.trim() ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke={inputValue.trim() ? "#ffffff" : "#bfc9c4"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </form>
      </div>

      {/* Snapshot Sheet */}
      {snapshotOpen && userId && (
        <SnapshotSheet userId={userId} stack={stack} onClose={() => setSnapshotOpen(false)} />
      )}

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </AppLayout>
  );
};
