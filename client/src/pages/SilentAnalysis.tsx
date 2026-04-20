import { useEffect } from "react";
import { useLocation } from "wouter";

export const SilentAnalysis = (): JSX.Element => {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const timer = setTimeout(() => {
      setLocation("/reveal");
    }, 3000);
    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <div className="relative flex flex-col items-center min-h-screen bg-[#f9f9f9] overflow-hidden">
      {/* Decorative blurred elements */}
      <div
        className="absolute rounded-full"
        style={{
          width: 256,
          height: 256,
          top: 183,
          right: -80,
          background: "rgba(138,153,254,0.07)",
          filter: "blur(40px)",
        }}
      />
      <div
        className="absolute rounded-full"
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
      <div className="relative flex flex-col items-center justify-center w-full max-w-md px-5 min-h-screen">
        {/* Animated pulse ring */}
        <div className="relative flex items-center justify-center mb-12">
          <div className="absolute w-32 h-32 rounded-full bg-[rgba(0,52,43,0.06)] animate-ping" />
          <div className="absolute w-24 h-24 rounded-full bg-[rgba(0,52,43,0.08)] animate-pulse" />
          <div className="w-16 h-16 rounded-full bg-[#00342b] flex items-center justify-center shadow-lg">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"
                fill="white"
                opacity="0.9"
              />
            </svg>
          </div>
        </div>

        {/* Status messages */}
        <div className="flex flex-col items-center gap-3">
          <p
            className="text-[#3f4945] text-base text-center leading-6"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Reading your M-Pesa history...
          </p>
          <p
            className="text-[#3f4945] text-sm text-center leading-5 opacity-60"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Identifying spending patterns
          </p>
          <p
            className="text-[#3f4945] text-sm text-center leading-5 opacity-40"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Building your priority stack
          </p>
        </div>

        {/* Bottom brand */}
        <div className="absolute bottom-12 flex flex-col items-center gap-2">
          <span
            className="text-[#00342b] text-xl font-medium tracking-[-1px]"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Rafiki
          </span>
          <p
            className="text-[#3f4945] text-xs text-center opacity-50"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Analysing your finances...
          </p>
        </div>
      </div>
    </div>
  );
};
