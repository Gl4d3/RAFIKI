import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";
import { apiRequest } from "@/lib/queryClient";

export const StatementUpload = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, initUser, setJobId, setStage } = useRafiki();

  const [mpesaFile, setMpesaFile] = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  const mpesaRef = useRef<HTMLInputElement>(null);
  const bankRef = useRef<HTMLInputElement>(null);

  const handleMpesaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setMpesaFile(f);
  };

  const handleBankChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setBankFile(f);
  };

  const handleContinue = async (isDemo = false) => {
    setIsUploading(true);
    setError(null);

    try {
      // Init user if not already done
      let userId = user?.userId;
      if (!userId) {
        await initUser(displayName || undefined);
        // Re-read from context after async update — but context updates async
        // so we fetch it from localStorage directly
        const stored = localStorage.getItem("rafiki_user");
        const parsed = stored ? JSON.parse(stored) : null;
        userId = parsed?.userId;
      }

      if (!userId) throw new Error("Could not initialise user session.");

      const formData = new FormData();
      formData.append("userId", userId);
      if (isDemo) {
        formData.append("demo", "true");
      } else if (mpesaFile) {
        formData.append("mpesa", mpesaFile);
      } else {
        formData.append("demo", "true");
      }
      if (bankFile) {
        formData.append("bank", bankFile);
      }

      const resp = await fetch("/api/onboarding/upload", {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Upload failed");
      }

      const data = await resp.json();
      setJobId(data.jobId);
      setStage("analyzing");
      setLocation("/analyzing");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center bg-[#f9f9f9] min-h-screen"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header className="flex max-w-[390px] w-full h-16 items-center justify-between px-6">
        <span className="text-[#00342b] text-xl font-medium tracking-[-1px]">
          Rafiki
        </span>
        <div className="w-8 h-8 rounded-full bg-[#e8e8e8] flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12" cy="7" r="4" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-col max-w-[390px] w-full px-5 pt-10 pb-16 gap-10">
        {/* Hero */}
        <section className="flex flex-col items-center gap-5 text-center">
          <div className="w-14 h-14 rounded-full bg-[#afefdd] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.5px] leading-8">
            Let me learn about your money first.
          </h1>
          <p className="text-[#3f4945] text-base leading-7">
            Upload your latest M-Pesa statement so I can help you budget and save smarter.
          </p>
        </section>

        {/* Name field */}
        {!user && (
          <div className="flex flex-col gap-2">
            <label className="text-[#3f4945] text-xs font-medium tracking-[0.5px] uppercase">
              What should I call you?
            </label>
            <input
              type="text"
              placeholder="Your name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-12 px-4 rounded-2xl bg-white text-[#1a1c1c] text-base outline-none"
              style={{ border: "none" }}
              data-testid="input-display-name"
            />
          </div>
        )}

        {/* Upload cards */}
        <div className="flex flex-col gap-4">
          {/* M-Pesa */}
          <button
            onClick={() => mpesaRef.current?.click()}
            className="relative bg-white rounded-3xl p-5 w-full text-left overflow-hidden"
            style={{ minHeight: 80 }}
            data-testid="button-upload-mpesa"
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${mpesaFile ? "bg-[#afefdd]" : "bg-[#f3f3f3]"}`}>
                {mpesaFile ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[#1a1c1c] text-base font-medium truncate">
                  {mpesaFile ? mpesaFile.name : "M-Pesa statement"}
                </span>
                <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase mt-0.5">
                  {mpesaFile ? `${(mpesaFile.size / 1024).toFixed(0)} KB` : "PDF or CSV format"}
                </span>
              </div>
            </div>
          </button>
          <input
            ref={mpesaRef}
            type="file"
            accept=".csv,.pdf"
            className="hidden"
            onChange={handleMpesaChange}
            data-testid="input-file-mpesa"
          />

          {/* Bank (optional) */}
          <button
            onClick={() => bankRef.current?.click()}
            className="relative bg-white rounded-3xl p-5 w-full text-left opacity-60"
            style={{ minHeight: 80 }}
            data-testid="button-upload-bank"
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${bankFile ? "bg-[#afefdd]" : "bg-[#f3f3f3]"}`}>
                {bankFile ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-[#1a1c1c] text-base font-medium">
                  {bankFile ? bankFile.name : "Bank statement"}
                </span>
                <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase mt-0.5">
                  Optional · All major banks
                </span>
              </div>
            </div>
          </button>
          <input
            ref={bankRef}
            type="file"
            accept=".csv,.pdf"
            className="hidden"
            onChange={handleBankChange}
            data-testid="input-file-bank"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-600 text-sm text-center">{error}</p>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-6 items-center">
          <button
            onClick={() => handleContinue(false)}
            disabled={isUploading}
            className="h-14 w-full rounded-full text-white text-base font-medium tracking-[0] leading-6 disabled:opacity-60"
            style={{
              background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
              border: "none",
              cursor: isUploading ? "not-allowed" : "pointer",
            }}
            data-testid="button-continue"
          >
            {isUploading ? "Uploading..." : mpesaFile ? "Analyse my statement" : "Continue"}
          </button>

          <button
            onClick={() => handleContinue(true)}
            disabled={isUploading}
            className="text-[#3f4945] text-sm tracking-[0.35px] leading-5 bg-transparent border-0 cursor-pointer disabled:opacity-60"
            data-testid="button-demo"
          >
            Try with sample data instead
          </button>
        </div>

        {/* Privacy notice */}
        <div className="flex items-start gap-4 p-4 bg-[#f3f3f3] rounded-2xl">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 mt-0.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-[#3f4945] text-xs leading-[19px]">
            Your data is encrypted and private. Rafiki never shares your financial information with third parties.
          </p>
        </div>
      </main>
    </div>
  );
};
