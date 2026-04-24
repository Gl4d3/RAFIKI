import { useState, useEffect, useRef, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useRafiki } from "@/lib/rafiki-context";

// ── Types ───────────────────────────────────────────────────────────────────

interface CascadeAllocation {
  label: string;
  tier: string;
  amount: number;
  rank?: number;
}

interface ProposalData {
  amount: number;
  recipient: string;
  context?: string;
}

interface CascadeData {
  waterfall: CascadeAllocation[];
  leftover: number;
  income?: number;
}

interface RedAlertFields {
  shortfall?: string;
  obligation?: string;
  daysUntilDue?: string;
  harvest?: string;
  harvestSource?: string;
  rawText: string;
}

type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  kind: "text" | "proposal" | "cascade";
  proposal?: ProposalData;
  cascade?: CascadeData;
  proposalState?: "pending" | "sent" | "error";
  redAlert?: RedAlertFields;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function parseRedAlert(text: string): RedAlertFields | null {
  if (!text.includes("more than your float allows")) {
    return null;
  }

  const fields: RedAlertFields = { rawText: text };

  // Server format: "Name, KSh [spend] is KSh [shortfall] more than your float allows right now."
  // Group 1 = spend amount (display context), Group 2 = shortfall delta
  const shortfallMatch = text.match(/KSh\s+([\d,]+)\s+is\s+KSh\s+([\d,]+)\s+more than your float/);
  if (shortfallMatch) {
    fields.shortfall = shortfallMatch[2]; // the gap amount
  }

  // Server format: "This would put your [label] at risk — that obligation is due in [N] days."
  // or "...due in this month." when daysUntilDue is null
  const obligationMatch = text.match(/put your (.+?) at risk[^.]*?due in (\d+ days?|this month)/i);
  if (obligationMatch) {
    fields.obligation = obligationMatch[1].trim();
    const duePart = obligationMatch[2];
    const dNum = duePart.match(/\d+/);
    fields.daysUntilDue = dNum ? dNum[0] : duePart;
  }

  // Server format: "One option: defer KSh [amount] from [sourceName] — that would cover the gap."
  const harvestMatch = text.match(/defer\s+KSh\s+([\d,]+)\s+from\s+(.+?)\s+(?:—|–)/);
  if (harvestMatch) {
    fields.harvest = harvestMatch[1];
    fields.harvestSource = harvestMatch[2].trim();
  }

  return fields;
}

const tierColor: Record<string, string> = {
  "1": "#00342b",
  "2": "#4755b6",
  "3": "#FFA000",
  "4": "#3f4945",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ProposalCard({
  msg,
  userId,
  onChangeAmount,
  onSent,
  onError,
}: {
  msg: ThreadMessage;
  userId: string;
  onChangeAmount: () => void;
  onSent: (msgId: string) => void;
  onError: (msgId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const { proposal, proposalState, id } = msg;
  if (!proposal) return null;

  const handleSend = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/user/${userId}/transfer-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: proposal.amount, recipient: proposal.recipient }),
      });
      if (res.ok) {
        onSent(id);
      } else {
        onError(id);
      }
    } catch {
      onError(id);
    } finally {
      setLoading(false);
    }
  };

  if (proposalState === "sent") {
    return (
      <div
        data-testid={`card-proposal-sent-${id}`}
        style={{
          background: "rgba(0,52,43,0.06)",
          borderRadius: 16,
          padding: "14px 16px",
          marginTop: 10,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 500, color: "#00342b", letterSpacing: "0.02em" }}>
          Transfer queued
        </p>
        <p style={{ fontSize: 13, color: "#3f4945", marginTop: 2 }}>
          KSh {proposal.amount.toLocaleString()} to {proposal.recipient}
        </p>
      </div>
    );
  }

  if (proposalState === "error") {
    return (
      <div
        data-testid={`card-proposal-error-${id}`}
        style={{
          background: "rgba(192,57,43,0.06)",
          borderRadius: 16,
          padding: "14px 16px",
          marginTop: 10,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 500, color: "#c0392b" }}>Transfer failed</p>
        <p style={{ fontSize: 13, color: "#3f4945", marginTop: 2 }}>
          Could not queue KSh {proposal.amount.toLocaleString()} to {proposal.recipient}. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid={`card-proposal-${id}`}
      style={{
        background: "#ffffff",
        borderRadius: 20,
        padding: 18,
        marginTop: 10,
        boxShadow: "0 12px 32px rgba(0,52,43,0.04)",
      }}
    >
      <p style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
        Transfer Proposal
      </p>
      <p style={{ fontSize: 26, fontWeight: 500, color: "#1a1c1c", letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: 2 }}>
        KSh {proposal.amount.toLocaleString()}
      </p>
      <p style={{ fontSize: 13, color: "#3f4945", marginBottom: proposal.context ? 10 : 16 }}>
        to {proposal.recipient}
      </p>
      {proposal.context && (
        <div style={{ background: "#f3f3f3", borderRadius: 10, padding: "8px 12px", marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: "#3f4945", lineHeight: 1.5 }}>{proposal.context}</p>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          data-testid={`button-proposal-change-${id}`}
          onClick={onChangeAmount}
          style={{
            flex: 1,
            height: 40,
            borderRadius: 999,
            background: "#f3f3f3",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            color: "#1a1c1c",
            cursor: "pointer",
          }}
        >
          Change amount
        </button>
        <button
          data-testid={`button-proposal-send-${id}`}
          onClick={handleSend}
          disabled={loading}
          style={{
            flex: 1,
            height: 40,
            borderRadius: 999,
            background: loading ? "#f3f3f3" : "linear-gradient(135deg, #00342b 0%, #004d40 100%)",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            color: loading ? "#3f4945" : "#ffffff",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Sending..." : "Send now"}
        </button>
      </div>
    </div>
  );
}

function CascadeCard({ msg, onConfirm }: { msg: ThreadMessage; onConfirm: (id: string) => void }) {
  const { cascade, id, proposalState } = msg;
  if (!cascade) return null;

  const income = cascade.income ?? cascade.waterfall.reduce((s, a) => s + a.amount, 0) + (cascade.leftover ?? 0);

  if (proposalState === "sent") {
    return (
      <div
        data-testid={`card-cascade-confirmed-${id}`}
        style={{
          background: "rgba(0,52,43,0.06)",
          borderRadius: 16,
          padding: "14px 16px",
          marginTop: 10,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 500, color: "#00342b" }}>Allocation confirmed</p>
      </div>
    );
  }

  return (
    <div
      data-testid={`card-cascade-${id}`}
      style={{
        background: "#ffffff",
        borderRadius: 20,
        padding: 18,
        marginTop: 10,
        boxShadow: "0 12px 32px rgba(0,52,43,0.04)",
      }}
    >
      <p style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 12 }}>
        Salary Allocation
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {cascade.waterfall.map((alloc, i) => {
          const pct = income > 0 ? Math.round((alloc.amount / income) * 100) : 0;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#1a1c1c" }}>{alloc.label}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#3f4945" }}>
                  KSh {alloc.amount.toLocaleString()}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: "#f3f3f3", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: 2,
                    background: tierColor[alloc.tier] ?? "#bfc9c4",
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
        {cascade.leftover > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            <span style={{ fontSize: 12, color: "#3f4945" }}>Float (yours to spend)</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#00342b" }}>
              KSh {cascade.leftover.toLocaleString()}
            </span>
          </div>
        )}
      </div>
      <button
        data-testid={`button-cascade-confirm-${id}`}
        onClick={() => onConfirm(id)}
        style={{
          width: "100%",
          height: 40,
          borderRadius: 999,
          background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)",
          border: "none",
          fontSize: 13,
          fontWeight: 500,
          color: "#ffffff",
          cursor: "pointer",
        }}
      >
        Looks good
      </button>
    </div>
  );
}

function RedAlertInset({ fields }: { fields: RedAlertFields }) {
  return (
    <div
      data-testid="card-red-alert"
      style={{
        background: "#e8e8e8",
        borderRadius: 14,
        padding: "14px 16px",
        marginTop: 4,
      }}
    >
      {fields.shortfall && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
            Shortfall
          </p>
          <p style={{ fontSize: 20, fontWeight: 500, color: "#1a1c1c", letterSpacing: "-0.02em" }}>
            KSh {fields.shortfall}
          </p>
        </div>
      )}
      {fields.obligation && (
        <div style={{ marginBottom: 6 }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 2 }}>
            Obligation at risk
          </p>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#1a1c1c" }}>{fields.obligation}</p>
          {fields.daysUntilDue && (
            <p style={{ fontSize: 12, color: "#3f4945", marginTop: 2 }}>
              Due in {fields.daysUntilDue} {parseInt(fields.daysUntilDue) === 1 ? "day" : "days"}
            </p>
          )}
        </div>
      )}
      {fields.harvest && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "none" }}>
          <p style={{ fontSize: 10, fontWeight: 500, color: "#3f4945", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
            One option
          </p>
          <p style={{ fontSize: 13, color: "#1a1c1c" }}>
            Defer KSh {fields.harvest}
            {fields.harvestSource ? ` from ${fields.harvestSource}` : ""}
            {" "}— that would cover the gap.
          </p>
        </div>
      )}
      {!fields.shortfall && !fields.obligation && !fields.harvest && (
        <p style={{ fontSize: 13, color: "#1a1c1c", lineHeight: 1.6 }}>{fields.rawText}</p>
      )}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 2,
        height: 14,
        background: "#00342b",
        borderRadius: 1,
        marginLeft: 2,
        animation: "blink 1s step-end infinite",
        verticalAlign: "middle",
      }}
    />
  );
}

// ── Main Chat component ───────────────────────────────────────────────────────

export const Chat = (): JSX.Element => {
  const { user } = useRafiki();
  const userId = user?.userId ?? "";

  // Parse ?q= from URL
  const initialMessage = (() => {
    try {
      return new URLSearchParams(window.location.search).get("q") ?? "";
    } catch {
      return "";
    }
  })();

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [brakeActive, setBrakeActive] = useState(false);
  const [brakeLoading, setBrakeLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSubmittedRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
  }, []);

  // Load conversation history + brake state on mount
  useEffect(() => {
    if (!userId) { setHistoryLoaded(true); return; }

    const load = async () => {
      try {
        const [convRes, brakeRes] = await Promise.all([
          fetch(`/api/user/${userId}/conversation`),
          fetch(`/api/user/${userId}/brake`),
        ]);

        if (brakeRes.ok) {
          const brakeData: { emergencyBrakeActive: boolean } = await brakeRes.json();
          setBrakeActive(brakeData.emergencyBrakeActive);
        }

        if (!convRes.ok) { setHistoryLoaded(true); return; }
        const conv: { id: string } = await convRes.json();
        setConversationId(conv.id);

        const msgRes = await fetch(`/api/chat/${conv.id}/messages?userId=${encodeURIComponent(userId)}`);
        if (!msgRes.ok) { setHistoryLoaded(true); return; }
        const raw: Array<{ id: string; role: string; content: string }> = await msgRes.json();

        const loaded: ThreadMessage[] = raw
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            const ra = m.role === "assistant" ? parseRedAlert(m.content) : null;
            return {
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              kind: "text",
              redAlert: ra ?? undefined,
            };
          });

        setMessages(loaded);
        setHistoryLoaded(true);
      } catch {
        setHistoryLoaded(true);
      }
    };

    load();
  }, [userId]);

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-submit initialMessage after history loads
  useEffect(() => {
    if (!historyLoaded || !initialMessage || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    setTimeout(() => {
      sendMessage(initialMessage);
    }, 80);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, initialMessage]);

  // ── SSE stream sender ───────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming || !userId) return;

      const userMsg: ThreadMessage = {
        id: uid(),
        role: "user",
        content: text.trim(),
        kind: "text",
      };

      const aiMsgId = uid();
      const aiMsg: ThreadMessage = {
        id: aiMsgId,
        role: "assistant",
        content: "",
        kind: "text",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setIsStreaming(true);
      scrollToBottom();

      try {
        const body: Record<string, unknown> = { userId, message: text.trim() };
        if (conversationId) body.conversationId = conversationId;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? { ...m, content: "Something went wrong. Please try again.", streaming: false }
                : m
            )
          );
          setIsStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let event: Record<string, unknown>;
            try { event = JSON.parse(raw); } catch { continue; }

            const type = event.type as string;

            if (type === "token") {
              // Server sends { type:"token", text:"..." }
              const chunk = (event.text as string) ?? (event.token as string) ?? "";
              if (chunk) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
                  )
                );
                scrollToBottom();
              }
            } else if (type === "proposal") {
              // Server sends { type:"proposal", amount, recipient }
              const proposal: ProposalData = {
                amount: event.amount as number,
                recipient: event.recipient as string,
                context: event.context as string | undefined,
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, kind: "proposal", proposal, proposalState: "pending", streaming: false }
                    : m
                )
              );
            } else if (type === "cascade") {
              // Server sends { type:"cascade", allocation: CascadeAllocation[] }
              const waterfall = (event.allocation as CascadeAllocation[]) ?? [];
              const cascade: CascadeData = {
                waterfall,
                leftover: (event.leftover as number) ?? 0,
                income: (event.income as number) ?? undefined,
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, kind: "cascade", cascade, proposalState: "pending", streaming: false }
                    : m
                )
              );
            } else if (type === "done") {
              const convId = event.conversationId as string | undefined;
              if (convId) setConversationId(convId);
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== aiMsgId) return m;
                  const ra = parseRedAlert(m.content);
                  return { ...m, streaming: false, redAlert: ra ?? undefined };
                })
              );
              setIsStreaming(false);
            } else if (type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: (event.message as string) || "Something went wrong.", streaming: false }
                    : m
                )
              );
              setIsStreaming(false);
            }
          }
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: "Connection lost. Please try again.", streaming: false }
              : m
          )
        );
        setIsStreaming(false);
      }
    },
    [userId, conversationId, isStreaming, scrollToBottom]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = inputValue.trim();
    if (!val) return;
    setInputValue("");
    sendMessage(val);
  };

  const handleProposalSent = (msgId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: "sent" } : m)));
  };

  const handleProposalError = (msgId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: "error" } : m)));
  };

  const handleProposalChangeAmount = () => {
    inputRef.current?.focus();
  };

  const handleCascadeConfirm = (msgId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, proposalState: "sent" } : m)));
  };

  const handleBrakeToggle = async () => {
    if (!userId || brakeLoading) return;
    const next = !brakeActive;
    setBrakeLoading(true);
    try {
      const res = await fetch(`/api/user/${userId}/brake`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (res.ok) {
        setBrakeActive(next);
        const ackMsg: ThreadMessage = {
          id: uid(),
          role: "assistant",
          content: next
            ? "Emergency brake is now on. All standing instructions are paused — nothing moves automatically until you switch it off."
            : "Emergency brake is off. Your standing instructions will resume as normal.",
          kind: "text",
        };
        setMessages((prev) => [...prev, ackMsg]);
        scrollToBottom();
      }
    } catch {
      // silent — brake toggle failed, UI unchanged
    } finally {
      setBrakeLoading(false);
    }
  };

  // ── Layout constants ───────────────────────────────────────────────────────
  const inputBarHeight = 56;
  const brakeStripHeight = 44;
  const bottomNavHeight = 72;
  const bottomOffset = bottomNavHeight + inputBarHeight + brakeStripHeight + 4;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Message thread */}
      <div
        ref={threadRef}
        data-testid="chat-thread"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: bottomOffset,
          overflowY: "auto",
          paddingTop: 20,
          paddingBottom: 16,
          paddingLeft: 16,
          paddingRight: 16,
          fontFamily: "Inter, sans-serif",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div style={{ maxWidth: 420, margin: "0 auto" }}>

          {/* Empty state */}
          {historyLoaded && messages.length === 0 && !isStreaming && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                paddingTop: "28vh",
                gap: 12,
                animation: "fadeIn 0.3s ease",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "rgba(0,52,43,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                    stroke="#00342b"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p style={{ fontSize: 15, fontWeight: 500, color: "#1a1c1c" }}>Ask RAFIKI anything</p>
              <p style={{ fontSize: 13, color: "#3f4945", textAlign: "center", lineHeight: 1.5, maxWidth: 240 }}>
                Send money, check your health, or ask what's coming up this month.
              </p>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              data-testid={`message-${msg.role}-${msg.id}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                marginBottom: 20,
                animation: "fadeIn 0.25s ease",
              }}
            >
              {msg.role === "assistant" && (
                <p
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: "#3f4945",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  RAFIKI
                </p>
              )}

              {msg.role === "user" ? (
                <div
                  style={{
                    background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)",
                    borderRadius: "24px 24px 4px 24px",
                    padding: "12px 16px",
                    maxWidth: "80%",
                  }}
                >
                  <p style={{ fontSize: 14, fontWeight: 400, color: "#ffffff", lineHeight: 1.55 }}>
                    {msg.content}
                  </p>
                </div>
              ) : msg.kind === "text" ? (
                <div style={{ maxWidth: "92%" }}>
                  {msg.redAlert ? (
                    <>
                      {msg.content && (
                        <p style={{ fontSize: 14, fontWeight: 400, color: "#1a1c1c", lineHeight: 1.65, marginBottom: 6, whiteSpace: "pre-wrap" }}>
                          {msg.content.split(".")[0]}.
                        </p>
                      )}
                      <RedAlertInset fields={msg.redAlert} />
                    </>
                  ) : (
                    <p
                      style={{
                        fontSize: 14,
                        fontWeight: 400,
                        color: "#1a1c1c",
                        lineHeight: 1.65,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {msg.content}
                      {msg.streaming && <StreamingCursor />}
                    </p>
                  )}
                </div>
              ) : msg.kind === "proposal" ? (
                <div style={{ maxWidth: "92%" }}>
                  {msg.content && (
                    <p style={{ fontSize: 14, fontWeight: 400, color: "#1a1c1c", lineHeight: 1.65, marginBottom: 4, whiteSpace: "pre-wrap" }}>
                      {msg.content}
                    </p>
                  )}
                  <ProposalCard
                    msg={msg}
                    userId={userId}
                    onChangeAmount={handleProposalChangeAmount}
                    onSent={handleProposalSent}
                    onError={handleProposalError}
                  />
                </div>
              ) : msg.kind === "cascade" ? (
                <div style={{ maxWidth: "92%" }}>
                  {msg.content && (
                    <p style={{ fontSize: 14, fontWeight: 400, color: "#1a1c1c", lineHeight: 1.65, marginBottom: 4, whiteSpace: "pre-wrap" }}>
                      {msg.content}
                    </p>
                  )}
                  <CascadeCard msg={msg} onConfirm={handleCascadeConfirm} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Emergency brake strip */}
      <div
        style={{
          position: "fixed",
          bottom: bottomNavHeight + inputBarHeight + 2,
          left: 0,
          right: 0,
          zIndex: 40,
          padding: "2px 16px",
        }}
      >
        <div
          data-testid="emergency-brake-strip"
          style={{
            maxWidth: 420,
            margin: "0 auto",
            background: brakeActive ? "rgba(192,57,43,0.08)" : "#f3f3f3",
            borderRadius: 10,
            padding: "7px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            transition: "background 0.25s",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: brakeActive ? "#c0392b" : "#bfc9c4",
                transition: "background 0.25s",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: brakeActive ? "#c0392b" : "#3f4945",
                letterSpacing: "0.02em",
              }}
            >
              Emergency Brake
            </span>
          </div>
          <button
            data-testid="button-brake-toggle"
            onClick={handleBrakeToggle}
            disabled={brakeLoading}
            style={{
              background: "none",
              border: "none",
              cursor: brakeLoading ? "default" : "pointer",
              padding: "4px 0",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 34,
                height: 18,
                borderRadius: 9,
                background: brakeActive ? "#c0392b" : "#bfc9c4",
                position: "relative",
                transition: "background 0.25s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: brakeActive ? 18 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#ffffff",
                  transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: brakeActive ? "#c0392b" : "#bfc9c4",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                minWidth: 20,
              }}
            >
              {brakeActive ? "On" : "Off"}
            </span>
          </button>
        </div>
      </div>

      {/* Input bar */}
      <div
        style={{
          position: "fixed",
          bottom: bottomNavHeight,
          left: 0,
          right: 0,
          padding: "6px 16px 6px",
          background: "rgba(249,249,249,0.92)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          zIndex: 41,
        }}
      >
        <form onSubmit={handleSubmit} style={{ maxWidth: 420, margin: "0 auto" }}>
          <div style={{ position: "relative" }}>
            <input
              ref={inputRef}
              data-testid="input-chat-message"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isStreaming ? "RAFIKI is thinking..." : "Ask RAFIKI anything..."}
              disabled={isStreaming}
              style={{
                width: "100%",
                height: 44,
                borderRadius: 999,
                background: "#ffffff",
                border: "none",
                paddingLeft: 20,
                paddingRight: 100,
                fontSize: 14,
                fontWeight: 400,
                color: "#1a1c1c",
                fontFamily: "Inter, sans-serif",
                outline: "none",
                boxSizing: "border-box",
                opacity: isStreaming ? 0.6 : 1,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                gap: 4,
                alignItems: "center",
              }}
            >
              {/* Mic button — non-functional, rendered per spec */}
              <button
                type="button"
                data-testid="button-mic"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "#f3f3f3",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "default",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2a3 3 0 013 3v7a3 3 0 01-6 0V5a3 3 0 013-3z"
                    stroke="#bfc9c4"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"
                    stroke="#bfc9c4"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {/* Send button */}
              <button
                type="submit"
                data-testid="button-chat-send"
                disabled={!inputValue.trim() || isStreaming}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background:
                    inputValue.trim() && !isStreaming
                      ? "linear-gradient(135deg, #00342b 0%, #004d40 100%)"
                      : "#f3f3f3",
                  border: "none",
                  cursor: inputValue.trim() && !isStreaming ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.2s",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                    stroke={inputValue.trim() && !isStreaming ? "#ffffff" : "#bfc9c4"}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </form>
      </div>
    </AppLayout>
  );
};
