import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";

interface HomeData {
  user: {
    id: string;
    displayName: string;
    estimatedBalance: number | null;
    financialHealthScore: number | null;
    safeBuffer: number | null;
  };
  priorityStack: {
    id: string;
    rank: number;
    label: string;
    monthlyAmount: number;
    tier: string;
  }[];
  summaryData: any;
}

const tierColors: Record<string, string> = {
  "1": "#afefdd",
  "2": "#e8e0ff",
  "3": "#e8f0fe",
  "4": "#f3f3f3",
  unknown: "#f3f3f3",
};

const tierTextColors: Record<string, string> = {
  "1": "#00342b",
  "2": "#4755b6",
  "3": "#1a56db",
  "4": "#3f4945",
  unknown: "#3f4945",
};

function getHealthLabel(score: number | null): { label: string; color: string } {
  if (score === null) return { label: "Unknown", color: "#3f4945" };
  if (score >= 75) return { label: "Healthy", color: "#00342b" };
  if (score >= 50) return { label: "Fair", color: "#4755b6" };
  if (score >= 25) return { label: "Needs attention", color: "#f59e0b" };
  return { label: "At risk", color: "#ef4444" };
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0]?.toUpperCase() || "")
    .slice(0, 2)
    .join("");
}

export const Home = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user } = useRafiki();
  const [data, setData] = useState<HomeData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchHome = async () => {
      if (!user?.userId) {
        setLocation("/");
        return;
      }
      try {
        const resp = await fetch(`/api/home/${user.userId}`);
        if (!resp.ok) throw new Error("Failed to load home data");
        const d = await resp.json();
        setData(d);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchHome();
  }, [user?.userId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f9f9f9]">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-full animate-pulse"
            style={{ background: "rgba(0,52,43,0.1)" }}
          />
          <p className="text-[#3f4945] text-sm">Loading your finances...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f9f9f9] px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-[#1a1c1c] text-lg font-medium">Something went wrong</p>
          <button
            onClick={() => setLocation("/")}
            className="h-12 px-8 rounded-full text-white text-sm font-medium"
            style={{ background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)", border: "none" }}
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  const { user: userData, priorityStack, summaryData } = data;
  const healthInfo = getHealthLabel(userData.financialHealthScore);
  const displayName = user?.displayName || userData.displayName || "You";
  const initials = getInitials(displayName);

  const topThreeStack = priorityStack.slice(0, 3);
  const balance = userData.estimatedBalance;

  return (
    <div
      className="flex flex-col min-h-screen bg-[#f9f9f9]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between max-w-[390px] w-full mx-auto px-6 pt-12 pb-2">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)" }}
          >
            {initials || "?"}
          </div>
          <div className="flex flex-col">
            <span className="text-[#1a1c1c] text-base font-medium leading-5">
              {displayName}
            </span>
            <span className="text-[#3f4945] text-xs">Good to have you back</span>
          </div>
        </div>
        <span className="text-[#00342b] text-xl font-medium tracking-[-1px]">
          Rafiki
        </span>
      </header>

      {/* Main */}
      <main className="flex flex-col max-w-[390px] w-full mx-auto px-5 pt-6 pb-20 gap-5">
        {/* Balance card */}
        <div
          className="rounded-3xl p-6 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #00342b 0%, #004d40 100%)" }}
        >
          <div
            className="absolute rounded-full"
            style={{ width: 160, height: 160, right: -40, top: -40, background: "rgba(255,255,255,0.04)" }}
          />
          <div
            className="absolute rounded-full"
            style={{ width: 120, height: 120, right: 20, bottom: -50, background: "rgba(255,255,255,0.03)" }}
          />

          <p className="text-[rgba(255,255,255,0.6)] text-xs font-medium tracking-[0.5px] uppercase mb-2">
            Estimated Balance
          </p>
          <p className="text-white text-4xl font-medium tracking-[-1px] mb-4">
            KSh {balance !== null && balance !== undefined ? balance.toLocaleString() : "—"}
          </p>

          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[rgba(255,255,255,0.5)] text-[10px] uppercase tracking-[0.5px]">
                Health Score
              </span>
              <span className="text-white text-sm font-medium">
                {userData.financialHealthScore ?? "—"}/100 · {healthInfo.label}
              </span>
            </div>
            <div className="ml-auto">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Send me money",
              icon: (
                <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              ),
              comingSoon: true,
            },
            {
              label: "How am I doing",
              icon: (
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              ),
              comingSoon: true,
            },
            {
              label: "What's coming up",
              icon: (
                <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="#00342b" strokeWidth="1.5"/><path d="M16 2v4M8 2v4M3 10h18" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round"/></>
              ),
              comingSoon: true,
            },
          ].map((action) => (
            <button
              key={action.label}
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl text-center"
              style={{ border: "none", cursor: "pointer", position: "relative" }}
              data-testid={`button-action-${action.label.replace(/\s/g, "-").toLowerCase()}`}
            >
              <div className="w-10 h-10 rounded-full bg-[#f3f3f3] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  {action.icon}
                </svg>
              </div>
              <span className="text-[#1a1c1c] text-xs leading-4">{action.label}</span>
              {action.comingSoon && (
                <span className="text-[#3f4945] text-[9px] opacity-50">Coming soon</span>
              )}
            </button>
          ))}
        </div>

        {/* Priority stack summary */}
        {priorityStack.length > 0 && (
          <div className="bg-white rounded-3xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[#1a1c1c] text-base font-medium">Priority Stack</h3>
              <button
                onClick={() => setLocation("/priority-stack")}
                className="text-[#00342b] text-xs font-medium bg-transparent border-0 cursor-pointer"
              >
                Edit
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {topThreeStack.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0"
                    style={{
                      background: tierColors[item.tier] || "#f3f3f3",
                      color: tierTextColors[item.tier] || "#3f4945",
                    }}
                  >
                    {item.rank}
                  </div>
                  <span className="text-[#1a1c1c] text-sm flex-1 truncate">{item.label}</span>
                  <span className="text-[#3f4945] text-sm shrink-0">
                    KSh {item.monthlyAmount.toLocaleString()}
                  </span>
                </div>
              ))}
              {priorityStack.length > 3 && (
                <p className="text-[#3f4945] text-xs mt-1 opacity-60">
                  +{priorityStack.length - 3} more obligations
                </p>
              )}
            </div>
          </div>
        )}

        {/* Financial summary */}
        {summaryData && (
          <div className="bg-white rounded-3xl p-5">
            <h3 className="text-[#1a1c1c] text-base font-medium mb-4">Monthly Overview</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="text-[#3f4945] text-xs mb-1">Income</span>
                <span className="text-[#00342b] text-lg font-medium">
                  KSh {(summaryData.estimatedSalary || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[#3f4945] text-xs mb-1">Spending</span>
                <span className="text-[#1a1c1c] text-lg font-medium">
                  KSh {(summaryData.totalDebits || 0).toLocaleString()}
                </span>
              </div>
            </div>

            {summaryData.topCategories && summaryData.topCategories.length > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid #f3f3f3" }}>
                <p className="text-[#3f4945] text-xs mb-3">Top categories</p>
                <div className="flex flex-col gap-2">
                  {summaryData.topCategories.slice(0, 3).map((cat: any) => (
                    <div key={cat.category} className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#f3f3f3] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (cat.total / summaryData.totalDebits) * 100)}%`,
                            background: "linear-gradient(90deg, #00342b 0%, #4755b6 100%)",
                          }}
                        />
                      </div>
                      <span className="text-[#3f4945] text-xs w-24 text-right truncate">{cat.label}</span>
                      <span className="text-[#1a1c1c] text-xs font-medium w-20 text-right">
                        KSh {cat.total.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Safe buffer */}
        {userData.safeBuffer !== null && (
          <div
            className="rounded-3xl p-5 flex items-center gap-4"
            style={{ background: "rgba(71,85,182,0.06)" }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(71,85,182,0.12)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#4755b6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-[#4755b6] text-sm font-medium">Safe Buffer</span>
              <span className="text-[#3f4945] text-xs">
                KSh {userData.safeBuffer.toLocaleString()} always protected
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
