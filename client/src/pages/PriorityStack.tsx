import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";
import { apiRequest } from "@/lib/queryClient";

interface StackItem {
  rank: number;
  label: string;
  monthlyAmount: number;
  tier: string;
}

const tierColors: Record<string, { bg: string; text: string; badge: string }> = {
  "1": { bg: "rgba(175,239,221,0.3)", text: "#00342b", badge: "#afefdd" },
  "2": { bg: "rgba(232,224,255,0.3)", text: "#4755b6", badge: "#e8e0ff" },
  "3": { bg: "rgba(232,240,254,0.3)", text: "#1a56db", badge: "#e8f0fe" },
  "4": { bg: "white", text: "#1a1c1c", badge: "#f3f3f3" },
  unknown: { bg: "white", text: "#1a1c1c", badge: "#f3f3f3" },
};

export const PriorityStack = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, setStage } = useRafiki();
  const [items, setItems] = useState<StackItem[]>([]);
  const [safeBuffer, setSafeBuffer] = useState(2000);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.jobId) { setLocation("/"); return; }
      try {
        const resp = await fetch(`/api/onboarding/job/${user.jobId}`);
        const job = await resp.json();
        const data = job.summaryData as any;
        const stack = (data?.priorityStack || []) as StackItem[];
        setItems(stack);
      } catch (err) { console.error(err); }
      finally { setIsLoading(false); }
    };
    fetchData();
  }, [user?.jobId]);

  const moveItem = (fromIdx: number, toIdx: number) => {
    const updated = [...items];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setItems(updated.map((item, i) => ({ ...item, rank: i + 1 })));
  };

  const handleSave = async () => {
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
        <p className="text-[#3f4945]">Loading...</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col min-h-screen bg-[#f9f9f9]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <main className="flex flex-col max-w-[390px] w-full mx-auto px-5 pt-16 pb-32">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.5px] leading-8">
            Priority Stack
          </h1>
          <p className="text-[#3f4945] text-sm mt-1">
            Drag to reorder. Your most important obligations go at the top.
          </p>
        </div>

        {/* Items */}
        <div className="flex flex-col gap-3 mb-8">
          {items.map((item, i) => {
            const colors = tierColors[item.tier] || tierColors["unknown"];
            return (
              <div
                key={`${item.label}-${i}`}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={() => {
                  if (dragIdx !== null && dragIdx !== i) {
                    moveItem(dragIdx, i);
                  }
                  setDragIdx(null);
                }}
                className="flex items-center gap-4 rounded-3xl p-5 cursor-grab active:cursor-grabbing transition-all"
                style={{
                  background: colors.bg,
                  opacity: dragIdx === i ? 0.5 : 1,
                  border: dragIdx === i ? "2px dashed #00342b" : "2px solid transparent",
                }}
                data-testid={`stack-item-${i}`}
              >
                {/* Rank */}
                <div
                  className="flex items-center justify-center shrink-0 w-8 h-8 rounded-full text-sm font-medium"
                  style={{ background: colors.badge, color: colors.text }}
                >
                  {i + 1}
                </div>

                {/* Label */}
                <div className="flex flex-col flex-1 min-w-0">
                  <span
                    className="text-base font-medium truncate"
                    style={{ color: colors.text }}
                  >
                    {item.label}
                  </span>
                  <span className="text-[#3f4945] text-xs">
                    KSh {item.monthlyAmount.toLocaleString()}/month
                  </span>
                </div>

                {/* Drag handle */}
                <div className="flex flex-col gap-[4px] shrink-0 opacity-30">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="w-4 h-[2px] rounded bg-current" style={{ color: colors.text }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add item */}
        <button
          className="flex items-center gap-3 px-5 py-4 rounded-3xl bg-white w-full text-left mb-8"
          style={{ border: "none", cursor: "pointer" }}
          data-testid="button-add-obligation"
          onClick={() => {
            const label = prompt("What obligation would you like to add?");
            if (!label) return;
            const amtStr = prompt("Estimated monthly amount (KSh)?");
            const amount = parseFloat(amtStr || "0") || 0;
            setItems((prev) => [
              ...prev,
              { rank: prev.length + 1, label, monthlyAmount: amount, tier: "unknown" },
            ]);
          }}
        >
          <div className="w-8 h-8 rounded-full bg-[#f3f3f3] flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[#3f4945] text-sm">Add an obligation</span>
        </button>

        {/* Safe buffer */}
        <div className="bg-white rounded-3xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#1a1c1c] text-base font-medium">Safe Buffer</span>
          </div>
          <p className="text-[#3f4945] text-xs mb-3">
            The minimum balance I'll always protect for you.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[#3f4945]">KSh</span>
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

        {/* Save */}
        <div className="flex flex-col gap-4 items-center">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="h-14 w-full rounded-full text-white text-base font-medium disabled:opacity-40"
            style={{
              background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
              border: "none",
              cursor: isSaving ? "not-allowed" : "pointer",
            }}
            data-testid="button-save-stack"
          >
            {isSaving ? "Saving..." : "Save my stack"}
          </button>
        </div>
      </main>
    </div>
  );
};
