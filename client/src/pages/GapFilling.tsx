import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export const GapFilling = (): JSX.Element => {
  const [, setLocation] = useLocation();

  return (
    <div className="relative flex flex-col items-start min-h-screen bg-[#f9f9f9] overflow-hidden pb-[77px]">
      {/* Decorative blurred elements */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 256,
          height: 256,
          top: 183.5,
          right: -80,
          background: "rgba(138,153,254,0.05)",
          filter: "blur(40px)",
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 288,
          height: 288,
          bottom: 333,
          left: -80,
          background: "rgba(0,52,43,0.05)",
          filter: "blur(50px)",
        }}
      />

      {/* Main content */}
      <div className="relative flex flex-col items-start w-full max-w-[672px] min-h-[734px] px-8 pt-24 pb-12">
        {/* Progress indicator */}
        <div className="mb-16 w-full flex justify-center">
          <div className="flex gap-2 items-center">
            <div className="w-2 h-2 rounded-full bg-[#00342b]" />
            <div className="w-2 h-2 rounded-full bg-[#e2e2e2]" />
            <div className="w-2 h-2 rounded-full bg-[#e2e2e2]" />
          </div>
        </div>

        {/* Conversational flow */}
        <div className="flex flex-col gap-10 items-start w-full">
          {/* AI label + heading */}
          <div className="flex flex-col gap-4 items-start w-full">
            <span
              className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              RAFIKI
            </span>
            <div className="flex flex-col items-start w-full">
              <h1
                className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.6px] leading-[30px]"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Here's what I found in{" "}
                <span className="text-[#00342b]">your money.</span>
              </h1>
            </div>
          </div>

          {/* Insight cards */}
          <div className="flex flex-col gap-4 w-full">
            {/* Income card */}
            <div className="bg-white rounded-3xl p-5 w-full shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-[#afefdd] flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="#00342b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span
                  className="text-[#1a1c1c] text-base font-medium"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Monthly income
                </span>
              </div>
              <p
                className="text-[#00342b] text-2xl font-medium tracking-[-0.6px]"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                KSh 45,000
              </p>
              <p
                className="text-[#3f4945] text-sm mt-1"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Average over last 3 months
              </p>
            </div>

            {/* Top expense card */}
            <div className="bg-white rounded-3xl p-5 w-full shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-[#e8e8e8] flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="#1a1c1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span
                  className="text-[#1a1c1c] text-base font-medium"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Top expense
                </span>
              </div>
              <p
                className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.6px]"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Transport
              </p>
              <p
                className="text-[#3f4945] text-sm mt-1"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                ~KSh 8,000/month
              </p>
            </div>

            {/* Savings gap card */}
            <div className="bg-[rgba(175,239,221,0.2)] border border-[#afefdd] rounded-3xl p-5 w-full">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-[#afefdd] flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="#00342b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span
                  className="text-[#00342b] text-base font-medium"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Savings gap
                </span>
              </div>
              <p
                className="text-[#00342b] text-2xl font-medium tracking-[-0.6px]"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                KSh 5,000
              </p>
              <p
                className="text-[#3f4945] text-sm mt-1"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                You could save this each month
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="w-full pt-2">
            <Button
              onClick={() => setLocation("/priority-stack-review")}
              className="h-14 w-full rounded-full bg-[linear-gradient(179deg,rgba(0,52,43,1)_0%,rgba(0,77,64,1)_100%)] text-white text-base font-medium tracking-[0] leading-6 hover:opacity-90 border-0 shadow-[0px_1px_2px_#0000000d]"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              See my priority stack
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
