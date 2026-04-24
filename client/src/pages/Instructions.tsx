import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AppLayout } from "@/components/AppLayout";
import { useRafiki } from "@/lib/rafiki-context";
import type { StandingInstruction } from "@shared/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        background: checked ? "#4755b6" : "#e8e8e8",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#ffffff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          transition: "left 0.2s",
        }}
      />
    </div>
  );
}

// ── Instruction card ──────────────────────────────────────────────────────────

function InstructionCard({
  instr,
  userId,
}: {
  instr: StandingInstruction;
  userId: string;
}) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [optimisticActive, setOptimisticActive] = useState<boolean | null>(null);

  const isActive = optimisticActive !== null ? optimisticActive : (instr.isActive ?? true);

  const toggleMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const res = await fetch(`/api/instruction/${instr.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, isActive: active }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onMutate: (active) => {
      setOptimisticActive(active);
    },
    onSuccess: () => {
      setOptimisticActive(null);
      queryClient.invalidateQueries({ queryKey: ["/api/user", userId, "instructions"] });
    },
    onError: () => {
      setOptimisticActive(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/instruction/${instr.id}?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user", userId, "instructions"] });
    },
  });

  return (
    <div
      data-testid={`card-instruction-${instr.id}`}
      style={{
        background: "#ffffff",
        borderRadius: 20,
        padding: 20,
        marginBottom: 12,
        opacity: isActive ? 1 : 0.55,
        transition: "opacity 0.25s",
      }}
    >
      {/* Main row */}
      <div
        style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}
        onClick={() => setExpanded((p) => !p)}
      >
        {/* Text block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            data-testid={`text-trigger-${instr.id}`}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#1a1c1c",
              lineHeight: 1.4,
              marginBottom: 4,
              wordBreak: "break-word",
            }}
          >
            {instr.triggerDescription}
          </p>
          <p
            data-testid={`text-action-${instr.id}`}
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: "#3f4945",
              lineHeight: 1.45,
              marginBottom: isActive && instr.lastFiredAt ? 8 : 0,
              wordBreak: "break-word",
            }}
          >
            {instr.actionDescription}
          </p>

          {/* Last triggered micro-label — active only */}
          {isActive && instr.lastFiredAt && (
            <p
              data-testid={`text-last-fired-${instr.id}`}
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "#bfc9c4",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Last triggered: {fmtDate(instr.lastFiredAt)}
            </p>
          )}

          {/* Paused state: label + resume pill */}
          {!isActive && (
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}
            >
              <span
                data-testid={`text-paused-${instr.id}`}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#3f4945",
                  letterSpacing: "0.02em",
                }}
              >
                Paused
                {instr.pausedReason && instr.pausedReason !== "Removed by user"
                  ? ` · ${instr.pausedReason}`
                  : ""}
              </span>
              <button
                data-testid={`button-resume-${instr.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMutation.mutate(true);
                }}
                style={{
                  background: "#f3f3f3",
                  border: "none",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#4755b6",
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                Resume
              </button>
            </div>
          )}
        </div>

        {/* Toggle + chevron */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, paddingTop: 2 }}
        >
          <Toggle
            checked={isActive}
            onChange={(v) => toggleMutation.mutate(v)}
            testId={`toggle-active-${instr.id}`}
          />
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
              flexShrink: 0,
            }}
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="#bfc9c4"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Expanded panel — max-height CSS transition */}
      <div
        style={{
          maxHeight: expanded ? 200 : 0,
          overflow: "hidden",
          transition: "max-height 0.3s ease",
        }}
      >
        <div
          style={{
            paddingTop: 16,
            borderTop: "none",
            marginTop: 16,
            background: "#f9f9f9",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: "#bfc9c4",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Logic type
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#3f4945" }}>
                {instr.logicType ?? "recurring"}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: "#bfc9c4",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Last triggered
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#3f4945" }}>
                {fmtDate(instr.lastFiredAt)}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: "#bfc9c4",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Created
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#3f4945" }}>
                {fmtDate(instr.createdAt)}
              </span>
            </div>
          </div>

          <button
            data-testid={`button-remove-${instr.id}`}
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            style={{
              marginTop: 14,
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 12,
              fontWeight: 500,
              color: removeMutation.isPending ? "#bfc9c4" : "#B00020",
              cursor: removeMutation.isPending ? "default" : "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {removeMutation.isPending ? "Removing…" : "Remove instruction"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      data-testid="empty-instructions"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 64,
        paddingBottom: 40,
        gap: 16,
      }}
    >
      {/* Icon mark */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(0,52,43,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"
            stroke="#00342b"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="9" y="3" width="6" height="4" rx="1" stroke="#00342b" strokeWidth="1.5" />
          <path
            d="M9 12h6M9 16h4"
            stroke="#00342b"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: "#1a1c1c", marginBottom: 6 }}>
          No standing instructions yet
        </p>
        <p style={{ fontSize: 13, fontWeight: 400, color: "#3f4945", lineHeight: 1.5, maxWidth: 240 }}>
          Tell RAFIKI what to watch for — like saving when your balance crosses a threshold.
        </p>
      </div>

      <button
        data-testid="button-add-first-instruction"
        onClick={onAdd}
        style={{
          background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)",
          border: "none",
          borderRadius: 999,
          padding: "12px 24px",
          fontSize: 13,
          fontWeight: 500,
          color: "#ffffff",
          cursor: "pointer",
          letterSpacing: "0.01em",
        }}
      >
        Set up an instruction
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Instructions() {
  const [, setLocation] = useLocation();
  const { user } = useRafiki();
  const userId = user?.userId ?? "";

  const instructionsQ = useQuery<StandingInstruction[]>({
    queryKey: ["/api/user", userId, "instructions"],
    queryFn: () =>
      fetch(`/api/user/${userId}/instructions`).then((r) => {
        if (!r.ok) throw new Error("Failed to load instructions");
        return r.json();
      }),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const handleAdd = () => {
    setLocation(
      `/chat?q=${encodeURIComponent("Set up a standing instruction for me — I want RAFIKI to watch for something automatically.")}`
    );
  };

  const instructions = instructionsQ.data ?? [];

  // Filter out soft-deleted (pausedReason === "Removed by user" AND !isActive)
  const visible = instructions.filter(
    (i) => !(i.pausedReason === "Removed by user" && !i.isActive)
  );

  return (
    <AppLayout>
      <div
        style={{
          maxWidth: 420,
          margin: "0 auto",
          paddingTop: 52,
          paddingBottom: 100,
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          <button
            data-testid="button-back"
            onClick={() => setLocation("/home")}
            style={{
              background: "#f3f3f3",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M19 12H5M12 5l-7 7 7 7"
                stroke="#1a1c1c"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 500,
                color: "#1a1c1c",
                letterSpacing: "-0.01em",
                lineHeight: 1.2,
              }}
            >
              Standing Instructions
            </h1>
            <p
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: "#3f4945",
                marginTop: 2,
                letterSpacing: "0.01em",
              }}
            >
              Automations RAFIKI watches for you
            </p>
          </div>
        </div>

        {/* Loading skeleton */}
        {instructionsQ.isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[1, 2, 3].map((k) => (
              <div
                key={k}
                style={{
                  background: "#ffffff",
                  borderRadius: 20,
                  padding: 20,
                  height: 90,
                  background:
                    "linear-gradient(90deg, #f3f3f3 25%, #e8e8e8 50%, #f3f3f3 75%)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 1.5s infinite",
                }}
              />
            ))}
          </div>
        )}

        {/* Error */}
        {instructionsQ.isError && (
          <div
            data-testid="error-instructions"
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: "16px 20px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 13, color: "#3f4945" }}>
              Couldn't load your instructions. Try again later.
            </p>
          </div>
        )}

        {/* Empty state */}
        {!instructionsQ.isLoading && !instructionsQ.isError && visible.length === 0 && (
          <EmptyState onAdd={handleAdd} />
        )}

        {/* Instruction cards */}
        {!instructionsQ.isLoading && visible.length > 0 && (
          <div data-testid="list-instructions">
            {visible.map((instr) => (
              <InstructionCard key={instr.id} instr={instr} userId={userId} />
            ))}
          </div>
        )}
      </div>

      {/* Floating CTA */}
      {!instructionsQ.isLoading && visible.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 84,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 45,
          }}
        >
          <button
            data-testid="button-add-instruction"
            onClick={handleAdd}
            style={{
              background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)",
              border: "none",
              borderRadius: 999,
              padding: "14px 28px",
              fontSize: 14,
              fontWeight: 500,
              color: "#ffffff",
              cursor: "pointer",
              pointerEvents: "auto",
              boxShadow: "0 12px 32px rgba(0, 52, 43, 0.22)",
              letterSpacing: "0.01em",
            }}
          >
            + Add instruction
          </button>
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </AppLayout>
  );
}
