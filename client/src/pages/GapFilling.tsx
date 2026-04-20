import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";
import { apiRequest } from "@/lib/queryClient";

const CATEGORIES = [
  { value: "family", label: "Family or relative", icon: "👥" },
  { value: "chama", label: "Chama or savings group", icon: "🤝" },
  { value: "business", label: "Business expense", icon: "💼" },
  { value: "merchant", label: "Regular merchant", icon: "🏪" },
  { value: "savings", label: "Savings or investment", icon: "💰" },
  { value: "one_time", label: "One-time payment", icon: "📋" },
  { value: "unknown", label: "Something else", icon: "❓" },
];

interface Unknown {
  entityId: string;
  name: string;
  amount: number;
  occurrences: number;
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
          // No unknowns — go straight to priority stack
          setStage("priority_stack");
          setLocation("/priority-stack-review");
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
        <p className="text-[#3f4945]">Loading...</p>
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
      {/* Header */}
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
          <span className="text-[#3f4945] text-xs shrink-0">
            {resolved} of {total} resolved
          </span>
        </div>

        {/* RAFIKI label */}
        <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase mb-4">
          RAFIKI
        </span>

        {/* AI-generated question */}
        <div
          className="rounded-tl-3xl rounded-tr-3xl rounded-br-3xl rounded-bl-sm p-5 mb-6"
          style={{ background: "rgba(148,211,193,0.15)", borderLeft: "3px solid #00342b" }}
        >
          <p className="text-[#1a1c1c] text-base leading-7">
            {current.question}
          </p>
          <p className="text-[#3f4945] text-xs mt-2 opacity-70">
            {current.occurrences}× · ~KSh {current.amount.toLocaleString()}/month
          </p>
        </div>
      </div>

      {/* Category options */}
      <div className="flex flex-col max-w-[390px] w-full mx-auto px-6 gap-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setSelected(cat.value)}
            className="flex items-center gap-4 p-4 rounded-2xl text-left transition-all"
            style={{
              background: selected === cat.value ? "rgba(0,52,43,0.08)" : "white",
              border: selected === cat.value ? "1.5px solid #00342b" : "1.5px solid transparent",
              outline: "none",
              cursor: "pointer",
            }}
            data-testid={`button-category-${cat.value}`}
          >
            <span className="text-lg">{cat.icon}</span>
            <span
              className="text-[#1a1c1c] text-base"
              style={{ fontWeight: selected === cat.value ? 500 : 400 }}
            >
              {cat.label}
            </span>
            {selected === cat.value && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="ml-auto shrink-0">
                <path d="M20 6L9 17l-5-5" stroke="#00342b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        ))}

        {/* Free text for "Something else" */}
        {selected === "unknown" && (
          <input
            type="text"
            placeholder="Tell me more (optional)"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            className="h-12 px-4 rounded-2xl bg-white text-[#1a1c1c] text-sm outline-none"
            style={{ border: "1.5px solid #e8e8e8" }}
            data-testid="input-other-text"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col max-w-[390px] w-full mx-auto px-6 pt-6 pb-10 gap-4 mt-auto">
        <button
          onClick={() => handleSubmit(false)}
          disabled={!selected || isSubmitting}
          className="h-14 w-full rounded-full text-white text-base font-medium disabled:opacity-40"
          style={{
            background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
            border: "none",
            cursor: selected && !isSubmitting ? "pointer" : "not-allowed",
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
