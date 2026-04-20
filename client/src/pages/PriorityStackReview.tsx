import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";
import { apiRequest } from "@/lib/queryClient";

interface StackItem {
  rank: number;
  label: string;
  monthlyAmount: number;
  tier: string;
  category?: string;
}

const tierColors: Record<string, { bg: string; text: string; label: string }> = {
  "1": { bg: "#afefdd", text: "#00342b", label: "Non-negotiable" },
  "2": { bg: "#e8e0ff", text: "#4755b6", label: "Social Obligation" },
  "3": { bg: "#e8f0fe", text: "#1a56db", label: "Growth" },
  "4": { bg: "#f3f3f3", text: "#3f4945", label: "Lifestyle" },
  unknown: { bg: "#f3f3f3", text: "#3f4945", label: "Uncategorised" },
};

export const PriorityStackReview = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, setStage } = useRafiki();
  const [revealMessage, setRevealMessage] = useState<string>("");
  const [items, setItems] = useState<StackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [safeBuffer, setSafeBuffer] = useState(2000);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.jobId) {
        setLocation("/");
        return;
      }
      try {
        const resp = await fetch(`/api/onboarding/job/${user.jobId}`);
        const job = await resp.json();
        const data = job.summaryData as any;
        setRevealMessage(job.revealMessage || "");
        const stack = (data?.priorityStack || []) as StackItem[];
        setItems(stack);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [user?.jobId]);

  const handleConfirm = async () => {
    if (!user?.userId) return;
    setIsSaving(true);
    try {
      await apiRequest("POST", "/api/onboarding/save-stack", {
        userId: user.userId,
        items: items.map((item, i) => ({
          rank: i + 1,
          label: item.label,
          monthlyAmount: item.monthlyAmount,
          tier: item.tier,
        })),
        safeBuffer,
      });
      setStage("complete");
      setLocation("/home");
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f9f9f9]">
        <p className="text-[#3f4945]">Loading your results...</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-screen bg-[#f9f9f9]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <main className="flex flex-col max-w-[390px] w-full mx-auto px-6 pt-12 pb-32">
        {/* RAFIKI label */}
        <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase mb-4">
          RAFIKI
        </span>

        {/* AI Reveal message */}
        <h2 className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.5px] leading-8 mb-6">
          Here's what I found in your money.
        </h2>

        {revealMessage && (
          <div
            className="rounded-tl-3xl rounded-tr-3xl rounded-br-3xl rounded-bl-sm p-5 mb-8"
            style={{ background: "rgba(148,211,193,0.2)", borderLeft: "4px solid #00342b" }}
          >
            <p className="text-[#1a1c1c] text-base leading-7">{revealMessage}</p>
          </div>
        )}

        {/* Priority Stack heading */}
        <div className="mb-5">
          <h3 className="text-[#00342b] text-xl font-medium tracking-[-0.5px]">
            Priority Stack
          </h3>
          <p className="text-[#3f4945] text-sm mt-1">
            The order in which I'll handle your obligations.
          </p>
        </div>

        {/* Stack items */}
        <div className="flex flex-col gap-3 mb-8">
          {items.length === 0 ? (
            <div className="bg-white rounded-3xl p-5">
              <p className="text-[#3f4945] text-sm">
                No recurring obligations were detected. This is normal if the statement only covers a short period.
              </p>
            </div>
          ) : (
            items.map((item, i) => {
              const colors = tierColors[item.tier] || tierColors["unknown"];
              return (
                <div
                  key={`${item.label}-${i}`}
                  className="flex items-center gap-4 bg-white rounded-3xl p-5"
                  data-testid={`stack-item-${i}`}
                >
                  <div
                    className="flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-sm font-medium"
                    style={{ background: colors.bg, color: colors.text }}
                  >
                    {item.rank}
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[#1a1c1c] text-base font-medium truncate">
                      {item.label}
                    </span>
                    <span className="text-[#3f4945] text-xs tracking-[0.3px]">
                      {colors.label}
                    </span>
                  </div>
                  <span className="text-[#1a1c1c] text-base font-medium shrink-0">
                    KSh {item.monthlyAmount.toLocaleString()}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Safe buffer */}
        <div className="bg-white rounded-3xl p-5 mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[#1a1c1c] text-base font-medium">Safe Buffer</span>
            <span className="text-[#3f4945] text-xs">Minimum balance to always keep</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#3f4945] text-base">KSh</span>
            <input
              type="number"
              value={safeBuffer}
              onChange={(e) => setSafeBuffer(Number(e.target.value))}
              className="flex-1 h-10 px-3 rounded-xl bg-[#f9f9f9] text-[#1a1c1c] text-base font-medium outline-none"
              style={{ border: "none" }}
              min={0}
              step={500}
              data-testid="input-safe-buffer"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-4 items-center">
          <button
            onClick={handleConfirm}
            disabled={isSaving}
            className="h-14 w-full rounded-full text-white text-base font-medium disabled:opacity-40"
            style={{
              background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
              border: "none",
              cursor: isSaving ? "not-allowed" : "pointer",
            }}
            data-testid="button-confirm-stack"
          >
            {isSaving ? "Saving..." : "This looks right"}
          </button>
          <button
            onClick={() => setLocation("/priority-stack")}
            className="text-[#3f4945] text-sm tracking-[0.35px] bg-transparent border-0 cursor-pointer"
            data-testid="button-adjust"
          >
            Let me adjust this
          </button>
        </div>
      </main>
    </div>
  );
};
