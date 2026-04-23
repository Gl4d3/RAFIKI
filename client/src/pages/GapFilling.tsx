import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";
import { apiRequest } from "@/lib/queryClient";

// Kenyan-context answer chips. The order is the order shown.
const CATEGORIES: { value: string; label: string }[] = [
  { value: "family", label: "Family or relative" },
  { value: "chama", label: "Chama or savings group" },
  { value: "domestic_worker", label: "Domestic worker" },
  { value: "debt", label: "Debt repayment" },
  { value: "business", label: "Business" },
  { value: "friend", label: "Friend (one-off)" },
  { value: "unknown", label: "Something else" },
];

interface Unknown {
  entityId: string;
  name: string;
  identifier: string;
  resolvedName: string | null;
  amount: number;
  totalAmount: number;
  occurrences: number;
  frequency: string;
  frequencyPhrase: string;
  lastSeen: string;
  question: string;
}

export const GapFilling = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, setStage } = useRafiki();
  const [unknowns, setUnknowns] = useState<Unknown[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const fetchUnknowns = async () => {
      if (!user?.jobId) {
        setLocation("/");
        return;
      }
      try {
        const resp = await fetch(`/api/onboarding/job/${user.jobId}`);
        const job = await resp.json();
        const data = job.summaryData as any;
        const unknownList = (data?.unknownEntities || []) as Unknown[];
        setUnknowns(unknownList);
        if (unknownList.length === 0) {
          // Empty / done state — pause briefly so the user sees the
          // confirmation, then advance to the priority stack review.
          setEmpty(true);
          setTimeout(() => {
            setStage("priority_stack");
            setLocation("/priority-stack-review");
          }, 1400);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUnknowns();
  }, [user?.jobId]);

  const current = unknowns[currentIdx];
  const total = unknowns.length;
  const resolved = currentIdx;

  const handleSubmit = async (skipOnly = false) => {
    if (!current) return;
    setIsSubmitting(true);

    if (!skipOnly && selected) {
      try {
        await apiRequest("POST", "/api/onboarding/gap-fill", {
          entityId: current.entityId,
          category: selected,
          notes: selected === "unknown" ? otherText : undefined,
        });
      } catch (err) {
        console.error(err);
      }
    }

    setSelected(null);
    setOtherText("");
    setIsSubmitting(false);

    const next = currentIdx + 1;
    if (next >= total) {
      setStage("priority_stack");
      setLocation("/priority-stack-review");
    } else {
      setCurrentIdx(next);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f9f9f9]">
        <p className="text-[#3f4945]" data-testid="text-loading">Loading...</p>
      </div>
    );
  }

  if (empty) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen bg-[#f9f9f9] px-6"
        style={{ fontFamily: "'Inter', sans-serif" }}
        data-testid="state-no-unknowns"
      >
        <div
          className="w-full max-w-[390px] rounded-3xl p-6 bg-[#ffffff] text-center"
          style={{ boxShadow: "0 12px 32px rgba(0, 52, 43, 0.04)" }}
        >
          <p className="text-[#1a1c1c] text-base leading-7" data-testid="text-no-unknowns">
            Nothing to clarify — every recurring counterparty is already
            recognised.
          </p>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f9f9f9]">
        <p className="text-[#3f4945]">All done!</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-screen bg-[#f9f9f9]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <div className="flex flex-col max-w-[390px] w-full mx-auto px-6 pt-12">
        {/* Progress */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 h-1 bg-[#e8e8e8] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(resolved / total) * 100}%`,
                background: "linear-gradient(90deg, #00342b 0%, #4755b6 100%)",
              }}
            />
          </div>
          <span className="text-[#3f4945] text-xs shrink-0" data-testid="text-progress">
            {resolved} of {total} resolved
          </span>
        </div>

        {/* Counterparty fact card — surface-container-lowest on surface */}
        <div
          className="rounded-3xl p-5 mb-5 bg-[#ffffff]"
          style={{ boxShadow: "0 12px 32px rgba(0, 52, 43, 0.04)" }}
          data-testid={`card-unknown-${current.entityId}`}
        >
          <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase">
            Unknown counterparty
          </span>
          <p
            className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.5px] mt-2"
            data-testid="text-identifier"
          >
            {current.identifier}
          </p>
          {current.resolvedName && (
            <p
              className="text-[#3f4945] text-sm mt-1"
              data-testid="text-resolved-name"
            >
              Saved in your phone as “{current.resolvedName}”
            </p>
          )}

          {/* Nested surface-container-low row for the numeric facts */}
          <div className="mt-4 rounded-2xl p-4 bg-[#f3f3f3]">
            <div className="flex items-baseline justify-between">
              <span className="text-[#3f4945] text-xs">Total so far</span>
              <span
                className="text-[#1a1c1c] text-base font-medium"
                data-testid="text-total-amount"
              >
                KSh {current.totalAmount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-[#3f4945] text-xs">~ Monthly</span>
              <span className="text-[#1a1c1c] text-sm">
                KSh {current.amount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-[#3f4945] text-xs">Pattern</span>
              <span
                className="text-[#1a1c1c] text-sm"
                data-testid="text-frequency"
              >
                {current.frequencyPhrase}
              </span>
            </div>
          </div>
        </div>

        {/* RAFIKI question bubble */}
        <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase mb-3">
          RAFIKI
        </span>
        <div
          className="rounded-tl-3xl rounded-tr-3xl rounded-br-3xl rounded-bl-lg p-5 mb-6"
          style={{ background: "rgba(148,211,193,0.15)" }}
        >
          <p
            className="text-[#1a1c1c] text-base leading-7"
            data-testid="text-question"
          >
            {current.question}
          </p>
        </div>
      </div>

      {/* Answer chips — pills, full radius */}
      <div className="flex flex-col max-w-[390px] w-full mx-auto px-6 gap-3">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const active = selected === cat.value;
            return (
              <button
                key={cat.value}
                onClick={() => setSelected(cat.value)}
                className="h-12 px-5 rounded-full text-sm transition-colors"
                style={{
                  background: active ? "#8a99fe" : "#ffffff",
                  color: active ? "#00342b" : "#1a1c1c",
                  fontWeight: active ? 500 : 400,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: active
                    ? "none"
                    : "0 12px 32px rgba(0, 52, 43, 0.04)",
                }}
                data-testid={`button-category-${cat.value}`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Free text textarea reveals only when "Something else" is picked */}
        {selected === "unknown" && (
          <textarea
            placeholder="Tell me more (optional)"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            rows={3}
            className="px-4 py-3 rounded-2xl bg-[#f3f3f3] text-[#1a1c1c] text-sm outline-none resize-none mt-2"
            style={{ border: "none" }}
            data-testid="input-other-text"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col max-w-[390px] w-full mx-auto px-6 pt-6 pb-10 gap-4 mt-auto">
        <button
          key={`submit-${current.entityId}`}
          onClick={() => handleSubmit(false)}
          disabled={selected === null || isSubmitting === true}
          className="h-14 w-full rounded-full text-white text-base font-medium disabled:opacity-40"
          style={{
            background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
            border: "none",
            cursor:
              selected !== null && !isSubmitting ? "pointer" : "not-allowed",
          }}
          data-testid="button-submit-answer"
        >
          {isSubmitting ? "Saving..." : "That's right"}
        </button>
        <button
          onClick={() => handleSubmit(true)}
          disabled={isSubmitting}
          className="text-[#3f4945] text-sm tracking-[0.35px] bg-transparent border-0 cursor-pointer"
          data-testid="button-skip"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
};
