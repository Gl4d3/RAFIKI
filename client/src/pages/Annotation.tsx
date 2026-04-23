import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useRafiki } from "@/lib/rafiki-context";

export const Annotation = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const { user, initUser, persistUser, pendingUpload, setPendingUpload } = useRafiki();

  const [annotation, setAnnotation] = useState<string>(pendingUpload?.annotation ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If somebody lands here cold (e.g. refresh), bounce them back to upload —
  // we never silently invent files for them.
  useEffect(() => {
    if (!pendingUpload || (
      pendingUpload.mpesaFiles.length === 0 &&
      pendingUpload.bankFiles.length === 0 &&
      !pendingUpload.smsText.trim()
    )) {
      setLocation("/");
    }
  }, [pendingUpload, setLocation]);

  const totalFiles = (pendingUpload?.mpesaFiles.length ?? 0) + (pendingUpload?.bankFiles.length ?? 0);
  const hasSms = !!pendingUpload?.smsText.trim();

  const submit = async (skip: boolean) => {
    if (!pendingUpload) return;
    setIsUploading(true);
    setError(null);
    try {
      let currentUser = user;
      if (!currentUser?.userId) {
        currentUser = await initUser(pendingUpload.displayName || undefined);
      }
      if (!currentUser?.userId) throw new Error("Could not initialise user session.");

      const formData = new FormData();
      formData.append("userId", currentUser.userId);
      pendingUpload.mpesaFiles.forEach((f) => formData.append("mpesa[]", f));
      pendingUpload.bankFiles.forEach((f) => formData.append("bank[]", f));
      if (pendingUpload.smsText.trim()) formData.append("smsText", pendingUpload.smsText.trim());
      const noteToSend = skip ? "" : annotation.trim();
      if (noteToSend) formData.append("annotation", noteToSend);

      const resp = await fetch("/api/onboarding/upload", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await resp.json();

      persistUser({ ...currentUser, jobId: data.jobId, stage: "analyzing" });
      // Persist the annotation choice in the in-memory pending state so the
      // user can come back if they bail.
      setPendingUpload({ ...pendingUpload, annotation: skip ? "" : annotation });
      setLocation(`/analyzing?job=${data.jobId}`);
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
      <header className="flex max-w-[390px] w-full h-16 items-center justify-between px-6">
        <button
          onClick={() => setLocation("/")}
          className="text-[#3f4945] text-sm bg-transparent flex items-center gap-1"
          style={{ border: "none", cursor: "pointer" }}
          data-testid="button-back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="#3f4945" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span className="text-[#00342b] text-xl font-medium tracking-[-1px]">Rafiki</span>
        <div className="w-12" />
      </header>

      <main className="flex flex-col max-w-[390px] w-full px-5 pt-8 pb-16 gap-8">
        <section className="flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-[#afefdd] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#00342b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-[#1a1c1c] text-2xl font-medium tracking-[-0.5px] leading-8">
            Anything I should know before I start reading?
          </h1>
          <p className="text-[#3f4945] text-base leading-7">
            Optional. A line or two helps me read your statements more honestly.
          </p>
        </section>

        {/* Sources summary */}
        <div className="bg-white rounded-3xl p-5 flex flex-col gap-2">
          <span className="text-[#3f4945] text-[10px] font-medium tracking-[0.5px] uppercase">
            Reading from
          </span>
          <span className="text-[#1a1c1c] text-base font-medium" data-testid="text-source-summary">
            {totalFiles > 0 && `${totalFiles} ${totalFiles === 1 ? "file" : "files"}`}
            {totalFiles > 0 && hasSms && " · "}
            {hasSms && "pasted SMS text"}
          </span>
        </div>

        {/* Annotation textarea */}
        <div className="bg-white rounded-3xl p-5">
          <textarea
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            placeholder={`e.g. "I was between jobs in March, so income looks low. The Ksh 25,000 to MARY is rent — I split it with my brother. I send chama money on the 5th of every month."`}
            rows={8}
            className="w-full bg-transparent text-[#1a1c1c] text-base leading-7 outline-none resize-none"
            style={{ border: "none" }}
            data-testid="input-annotation"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-[#1a1c1c] text-sm text-center bg-[#FFA000] bg-opacity-15 rounded-2xl px-4 py-3" data-testid="text-annotation-error">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-4 items-center">
          <button
            onClick={() => submit(false)}
            disabled={isUploading}
            className="h-14 w-full rounded-full text-white text-base font-medium tracking-[0] leading-6 disabled:opacity-50"
            style={{
              background: "linear-gradient(179deg, #00342b 0%, #004d40 100%)",
              border: "none",
              cursor: isUploading ? "not-allowed" : "pointer",
            }}
            data-testid="button-continue-annotation"
          >
            {isUploading ? "Uploading…" : "Continue"}
          </button>
          <button
            onClick={() => submit(true)}
            disabled={isUploading}
            className="text-[#3f4945] text-sm tracking-[0.35px] leading-5 bg-transparent disabled:opacity-60"
            style={{ border: "none", cursor: isUploading ? "not-allowed" : "pointer" }}
            data-testid="button-skip-annotation"
          >
            Skip — nothing to add
          </button>
        </div>
      </main>
    </div>
  );
};
