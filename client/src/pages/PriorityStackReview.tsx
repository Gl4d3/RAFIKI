import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const aiSummary =
  "I can see you spend around KSh 8,000 a month on transport. Based on your statements, here's how I'll prioritize your money.";

const priorityItems = [
  {
    rank: 1,
    label: "Rent",
    amount: "KSh 15,000",
    frequency: "Monthly",
    color: "#afefdd",
    textColor: "#00342b",
  },
  {
    rank: 2,
    label: "Food & groceries",
    amount: "KSh 8,500",
    frequency: "Monthly",
    color: "#e8e8e8",
    textColor: "#1a1c1c",
  },
  {
    rank: 3,
    label: "Transport",
    amount: "KSh 8,000",
    frequency: "Monthly",
    color: "#e8e8e8",
    textColor: "#1a1c1c",
  },
  {
    rank: 4,
    label: "Savings",
    amount: "KSh 5,000",
    frequency: "Monthly",
    color: "#e8e8e8",
    textColor: "#1a1c1c",
  },
  {
    rank: 5,
    label: "Utilities",
    amount: "KSh 3,500",
    frequency: "Monthly",
    color: "#e8e8e8",
    textColor: "#1a1c1c",
  },
];

export const PriorityStackReview = (): JSX.Element => {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col min-h-screen bg-[#f9f9f9]">
      {/* Main */}
      <main className="flex flex-col gap-10 items-start max-w-[512px] w-full px-6 pt-12 pb-32">
        {/* Header */}
        <div className="flex flex-col gap-6 items-start w-full">
          <div className="flex flex-col items-start w-full">
            <h1
              className="text-[#00342b] text-2xl font-medium tracking-[-0.6px] leading-8 w-full"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              Priority Stack
            </h1>
          </div>

          {/* AI conversational summary */}
          <div
            className="flex flex-col items-start pl-6 pr-5 py-5 w-full rounded-tl-3xl rounded-tr-3xl rounded-bl-[2px] rounded-br-3xl border-l-4 border-[#00342b]"
            style={{ background: "rgba(148,211,193,0.2)" }}
          >
            <p
              className="text-[#1a1c1c] text-base leading-[26px] w-full"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              {aiSummary}
            </p>
          </div>
        </div>

        {/* Priority items */}
        <div className="flex flex-col gap-4 items-start w-full">
          {priorityItems.map((item) => (
            <div
              key={item.rank}
              className="flex gap-4 items-center p-5 w-full bg-white rounded-3xl"
            >
              {/* Rank badge */}
              <div
                className="flex items-center justify-center shrink-0 w-8 h-8 rounded-full"
                style={{ background: item.color }}
              >
                <span
                  className="text-sm font-medium"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    color: item.textColor,
                  }}
                >
                  {item.rank}
                </span>
              </div>

              {/* Label + frequency */}
              <div className="flex flex-col flex-1 min-w-0">
                <span
                  className="text-[#1a1c1c] text-base font-medium leading-6"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {item.label}
                </span>
                <span
                  className="text-[#3f4945] text-xs tracking-[0.3px] leading-[18px]"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {item.frequency}
                </span>
              </div>

              {/* Amount */}
              <span
                className="text-[#1a1c1c] text-base font-medium leading-6 shrink-0"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                {item.amount}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-6 items-center w-full pt-2">
          <Button
            onClick={() => setLocation("/priority-stack")}
            className="h-14 w-full rounded-full bg-[linear-gradient(179deg,rgba(0,52,43,1)_0%,rgba(0,77,64,1)_100%)] text-white text-base font-medium tracking-[0] leading-6 hover:opacity-90 border-0 shadow-[0px_1px_2px_#0000000d]"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            This looks right
          </Button>
          <button
            className="text-[#3f4945] text-sm tracking-[0.35px] leading-5 bg-transparent border-0 cursor-pointer"
            style={{ fontFamily: "'Inter', sans-serif" }}
            onClick={() => setLocation("/priority-stack")}
          >
            Let me adjust this
          </button>
        </div>
      </main>
    </div>
  );
};
