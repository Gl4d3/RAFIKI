import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const stackItems = [
  {
    rank: 1,
    label: "Rent",
    sublabel: "Non-negotiable",
    amount: "KSh 15,000",
    highlight: true,
  },
  {
    rank: 2,
    label: "Food & groceries",
    sublabel: "Essential",
    amount: "KSh 8,500",
    highlight: false,
  },
  {
    rank: 3,
    label: "Transport",
    sublabel: "Essential",
    amount: "KSh 8,000",
    highlight: false,
  },
  {
    rank: 4,
    label: "Savings",
    sublabel: "Goal",
    amount: "KSh 5,000",
    highlight: false,
  },
  {
    rank: 5,
    label: "Utilities",
    sublabel: "Essential",
    amount: "KSh 3,500",
    highlight: false,
  },
  {
    rank: 6,
    label: "Entertainment",
    sublabel: "Flexible",
    amount: "KSh 2,000",
    highlight: false,
  },
];

export const PriorityStack = (): JSX.Element => {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col min-h-screen bg-[#f9f9f9]">
      {/* Main */}
      <main className="flex flex-col gap-10 items-start max-w-[448px] w-full px-5 pt-24 pb-32 min-h-[989px]">
        {/* Page header */}
        <div className="flex flex-col gap-[3px] items-start w-full">
          <h1
            className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.6px] leading-8 w-full"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Priority Stack
          </h1>
          <p
            className="text-[#3f4945] text-[13px] leading-[21px] w-full"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            The order in which I handle your obligations.
          </p>
        </div>

        {/* Ranked list */}
        <div className="flex flex-col gap-4 items-start w-full">
          {stackItems.map((item) => (
            <div
              key={item.rank}
              className={`flex gap-4 items-center p-5 w-full rounded-3xl ${
                item.highlight
                  ? "bg-[rgba(175,239,221,0.3)] border border-[#afefdd]"
                  : "bg-white"
              }`}
            >
              {/* Rank badge */}
              <div className="flex items-center justify-center shrink-0 w-8 h-8 rounded-full bg-[#e8e8e8]">
                <span
                  className="text-sm font-medium text-[#1a1c1c]"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {item.rank}
                </span>
              </div>

              {/* Label */}
              <div className="flex flex-col flex-1 min-w-0">
                <span
                  className={`text-base font-medium leading-6 ${
                    item.highlight ? "text-[#00342b]" : "text-[#1a1c1c]"
                  }`}
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {item.label}
                </span>
                <span
                  className="text-[#3f4945] text-xs tracking-[0.3px] leading-[18px]"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {item.sublabel}
                </span>
              </div>

              {/* Amount */}
              <span
                className={`text-base font-medium leading-6 shrink-0 ${
                  item.highlight ? "text-[#00342b]" : "text-[#1a1c1c]"
                }`}
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                {item.amount}
              </span>

              {/* Drag handle */}
              <div className="flex flex-col gap-[3px] shrink-0 opacity-30">
                <div className="w-4 h-[2px] rounded bg-[#1a1c1c]" />
                <div className="w-4 h-[2px] rounded bg-[#1a1c1c]" />
                <div className="w-4 h-[2px] rounded bg-[#1a1c1c]" />
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-6 items-center w-full pt-2">
          <Button
            onClick={() => setLocation("/")}
            className="h-14 w-full rounded-full bg-[linear-gradient(179deg,rgba(0,52,43,1)_0%,rgba(0,77,64,1)_100%)] text-white text-base font-medium tracking-[0] leading-6 hover:opacity-90 border-0 shadow-[0px_1px_2px_#0000000d]"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Save my stack
          </Button>
          <button
            className="text-[#3f4945] text-sm tracking-[0.35px] leading-5 bg-transparent border-0 cursor-pointer"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Add an obligation
          </button>
        </div>
      </main>
    </div>
  );
};
