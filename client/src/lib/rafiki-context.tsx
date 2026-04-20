import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";

interface RafikiUser {
  userId: string;
  displayName: string;
  stage: string;
  jobId?: string;
}

interface RafikiContextType {
  user: RafikiUser | null;
  initUser: (displayName?: string) => Promise<void>;
  setStage: (stage: string) => void;
  setJobId: (jobId: string) => void;
  isLoading: boolean;
}

const RafikiContext = createContext<RafikiContextType | null>(null);

const STORAGE_KEY = "rafiki_user";

export function RafikiProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<RafikiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try to restore from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
      } catch {}
    }
    setIsLoading(false);
  }, []);

  const persist = (u: RafikiUser) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  };

  const initUser = async (displayName?: string) => {
    const resp = await apiRequest("POST", "/api/user/init", {
      username: `rafiki_${Date.now()}`,
      displayName: displayName || null,
    });
    const data = await resp.json();
    persist({
      userId: data.userId,
      displayName: displayName || "You",
      stage: data.stage || "upload",
    });
  };

  const setStage = (stage: string) => {
    if (!user) return;
    persist({ ...user, stage });
  };

  const setJobId = (jobId: string) => {
    if (!user) return;
    persist({ ...user, jobId });
  };

  return (
    <RafikiContext.Provider value={{ user, initUser, setStage, setJobId, isLoading }}>
      {children}
    </RafikiContext.Provider>
  );
}

export function useRafiki() {
  const ctx = useContext(RafikiContext);
  if (!ctx) throw new Error("useRafiki must be used within RafikiProvider");
  return ctx;
}
