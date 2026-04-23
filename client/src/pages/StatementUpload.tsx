import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const StatementUpload = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, initUser, persistUser, pendingUpload, setPendingUpload } = useRafiki();

  const [mpesaFiles, setMpesaFiles] = useState<File[]>(pendingUpload?.mpesaFiles ?? []);
  const [bankFiles, setBankFiles] = useState<File[]>(pendingUpload?.bankFiles ?? []);
  const [smsText, setSmsText] = useState<string>(pendingUpload?.smsText ?? "");
  const [smsExpanded, setSmsExpanded] = useState<boolean>(!!pendingUpload?.smsText);
  const [displayName, setDisplayName] = useState(pendingUpload?.displayName ?? "");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mpesaRef = useRef<HTMLInputElement>(null);
  const bankRef = useRef<HTMLInputElement>(null);

  const hasAnySource = mpesaFiles.length > 0 || bankFiles.length > 0 || smsText.trim().length > 0;

  const addFiles = (
    setter: (next: File[]) => void,
    current: File[],
    incoming: FileList | null
  ) => {
    if (!incoming) return;
    const merged = [...current];
    Array.from(incoming).forEach((f) => {
      if (!merged.find((m) => m.name === f.name && m.size === f.size)) {
        merged.push(f);
      }
    });
    setter(merged);
  };

  const removeAt = (setter: (next: File[]) => void, current: File[], idx: number) => {
    setter(current.filter((_, i) => i !== idx));
  };

  const goToAnnotation = () => {
    setError(null);
    if (!hasAnySource) {
      setError("Add at least one source so I have something honest to read.");
      return;
    }
    setPendingUpload({
      mpesaFiles,
      bankFiles,
      smsText,
      annotation: pendingUpload?.annotation ?? "",
      displayName,
    });
    setLocation("/annotate");
  };

  const handleDemo = async () => {
    setIsWorking(true);
    setError(null);
    try {
      let currentUser = user;
      if (!currentUser?.userId) {
        currentUser = await initUser(displayName || undefined);
      }
      if (!currentUser?.userId) throw new Error("Could not initialise user session.");

      const formData = new FormData();
      formData.append("userId", currentUser.userId);
      formData.append("demo", "true");

      const resp = await fetch("/api/onboarding/upload", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await resp.json();
      persistUser({ ...currentUser, jobId: data.jobId, stage: "analyzing" });
      setLocation(`/analyzing?job=${data.jobId}`);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center bg-[#f9f9f9] min-h-screen"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <header className="flex max-w-[390px] w-full h-16 items-center justify-between px-6">
        <span className="text-[#00342b] text-xl font-medium tracking-[-1px]">Rafiki</span>
        <div className="w-8 h-8 rounded-full bg-[#e8e8e8] flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="12" cy="7" r="4" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </header>

      <main className="flex flex-col max-w-[390px] w-full px-5 pt-8 pb-16 gap-8">
        {/* Hero */}
        <section className="flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-[#afefdd] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.5px] leading-8">
            Let me learn about your money first.
          </h1>
          <p className="text-[#3f4945] text-base leading-7">
            Add as many statements as you have — more months means a more accurate picture.
          </p>
        </section>

        {/* Name */}
        {!user && (
          <div className="flex flex-col gap-2">
            <label className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase">
              What should I call you?
            </label>
            <input
              type="text"
              placeholder="Your name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-12 px-4 rounded-2xl bg-[#f3f3f3] text-[#1a1c1c] text-base outline-none focus:bg-white"
              style={{ border: "none" }}
              data-testid="input-display-name"
            />
          </div>
        )}

        {/* M-Pesa zone */}
        <section className="flex flex-col gap-3 bg-white rounded-3xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[#1a1c1c] text-base font-medium">M-Pesa statements</span>
              <span className="text-[#3f4945] text-xs leading-5 mt-0.5">
                PDF or CSV exports. Add one per month if you can.
              </span>
            </div>
            <button
              type="button"
              onClick={() => mpesaRef.current?.click()}
              className="shrink-0 h-9 px-4 rounded-full bg-[#e8e8e8] text-[#00342b] text-sm font-medium"
              style={{ border: "none" }}
              data-testid="button-add-mpesa"
            >
              + Add
            </button>
          </div>
          <input
            ref={mpesaRef}
            type="file"
            accept=".csv,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(setMpesaFiles, mpesaFiles, e.target.files);
              if (mpesaRef.current) mpesaRef.current.value = "";
            }}
            data-testid="input-file-mpesa"
          />
          {mpesaFiles.length > 0 && (
            <ul className="flex flex-col gap-2 mt-1">
              {mpesaFiles.map((f, i) => (
                <li
                  key={`${f.name}-${f.size}-${i}`}
                  className="flex items-center gap-3 bg-[#f3f3f3] rounded-2xl px-4 py-3"
                  data-testid={`card-mpesa-${i}`}
                >
                  <div className="w-8 h-8 rounded-full bg-[#afefdd] flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[#1a1c1c] text-sm font-medium truncate">{f.name}</span>
                    <span className="text-[#3f4945] text-[10px] tracking-[0.5px] uppercase mt-0.5">
                      {formatSize(f.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAt(setMpesaFiles, mpesaFiles, i)}
                    className="w-8 h-8 rounded-full bg-[#e8e8e8] flex items-center justify-center shrink-0"
                    style={{ border: "none" }}
                    data-testid={`button-remove-mpesa-${i}`}
                    aria-label={`Remove ${f.name}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Bank zone */}
        <section className="flex flex-col gap-3 bg-white rounded-3xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[#1a1c1c] text-base font-medium">Bank statements</span>
              <span className="text-[#3f4945] text-xs leading-5 mt-0.5">
                Optional. Any major Kenyan bank, PDF or CSV.
              </span>
            </div>
            <button
              type="button"
              onClick={() => bankRef.current?.click()}
              className="shrink-0 h-9 px-4 rounded-full bg-[#e8e8e8] text-[#00342b] text-sm font-medium"
              style={{ border: "none" }}
              data-testid="button-add-bank"
            >
              + Add
            </button>
          </div>
          <input
            ref={bankRef}
            type="file"
            accept=".csv,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(setBankFiles, bankFiles, e.target.files);
              if (bankRef.current) bankRef.current.value = "";
            }}
            data-testid="input-file-bank"
          />
          {bankFiles.length > 0 && (
            <ul className="flex flex-col gap-2 mt-1">
              {bankFiles.map((f, i) => (
                <li
                  key={`${f.name}-${f.size}-${i}`}
                  className="flex items-center gap-3 bg-[#f3f3f3] rounded-2xl px-4 py-3"
                  data-testid={`card-bank-${i}`}
                >
                  <div className="w-8 h-8 rounded-full bg-[#afefdd] flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[#1a1c1c] text-sm font-medium truncate">{f.name}</span>
                    <span className="text-[#3f4945] text-[10px] tracking-[0.5px] uppercase mt-0.5">
                      {formatSize(f.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAt(setBankFiles, bankFiles, i)}
                    className="w-8 h-8 rounded-full bg-[#e8e8e8] flex items-center justify-center shrink-0"
                    style={{ border: "none" }}
                    data-testid={`button-remove-bank-${i}`}
                    aria-label={`Remove ${f.name}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* SMS paste card */}
        <section className="flex flex-col gap-3 bg-white rounded-3xl p-5">
          <button
            type="button"
            onClick={() => setSmsExpanded((v) => !v)}
            className="flex items-start justify-between gap-3 text-left bg-transparent"
            style={{ border: "none", padding: 0 }}
            data-testid="button-toggle-sms"
          >
            <div className="flex flex-col">
              <span className="text-[#1a1c1c] text-base font-medium">Paste M-Pesa SMS</span>
              <span className="text-[#3f4945] text-xs leading-5 mt-0.5">
                {smsText.trim() ? `${smsText.trim().split(/\s+/).length} words pasted` : "Optional. Helpful when a statement is missing."}
              </span>
            </div>
            <div className="shrink-0 w-8 h-8 rounded-full bg-[#e8e8e8] flex items-center justify-center">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                style={{ transform: smsExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
              >
                <path d="M6 9l6 6 6-6" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>
          {smsExpanded && (
            <textarea
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder={`Paste M-Pesa SMS messages here, e.g.:\n\nQAB1234567 Confirmed. Ksh500.00 sent to JOHN DOE 0712345678 on 5/4/26 at 2:14 PM. New M-PESA balance is Ksh3,200.00...`}
              rows={6}
              className="w-full bg-[#f3f3f3] rounded-2xl p-4 text-[#1a1c1c] text-sm leading-6 outline-none focus:bg-white resize-none"
              style={{ border: "none" }}
              data-testid="input-sms-text"
            />
          )}
        </section>

        {error && (
          <p className="text-[#1a1c1c] text-sm text-center bg-[#FFA000] bg-opacity-15 rounded-2xl px-4 py-3" data-testid="text-upload-error">
            {error}
          </p>
        )}

        {/* Continue */}
        <div className="flex flex-col gap-4 items-center">
          <button
            onClick={goToAnnotation}
            disabled={!hasAnySource || isWorking}
            className="h-14 w-full rounded-full text-white text-base font-medium tracking-[0] leading-6 disabled:opacity-50"
            style={{
              background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
              border: "none",
              cursor: !hasAnySource || isWorking ? "not-allowed" : "pointer",
            }}
            data-testid="button-continue"
          >
            Continue
          </button>
          <p className="text-[#3f4945] text-xs leading-5 text-center">
            {hasAnySource
              ? "Next: a quick note about anything I should know."
              : "Add at least one statement or paste some M-Pesa SMS to continue."}
          </p>

          <button
            onClick={handleDemo}
            disabled={isWorking}
            className="text-[#3f4945] text-sm tracking-[0.35px] leading-5 bg-transparent disabled:opacity-60"
            style={{ border: "none", cursor: isWorking ? "not-allowed" : "pointer" }}
            data-testid="button-demo"
          >
            Try with sample data instead
          </button>
        </div>

        {/* Privacy */}
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
