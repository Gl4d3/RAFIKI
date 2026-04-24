import { useQuery } from "@tanstack/react-query";

export interface FinancialState {
  availableFloat: number;
  currentBalance: number;
  committedAmount: number;
  safeBuffer: number;
  daysToNextSalary: number | null;
  nextSalaryDate: string | null;
  salarySource: string;
  estimatedMonthlySalary: number;
}

export interface HealthScore {
  score: number;
  explanation: string;
}

export function useFinancialState(userId: string | undefined) {
  return useQuery<FinancialState>({
    queryKey: ["/api/user", userId, "financial-state"],
    queryFn: () =>
      fetch(`/api/user/${userId}/financial-state`).then((r) => {
        if (!r.ok) throw new Error("Failed to load financial state");
        return r.json();
      }),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

export function useHealthScore(userId: string | undefined) {
  return useQuery<HealthScore>({
    queryKey: ["/api/user", userId, "health-score"],
    queryFn: () =>
      fetch(`/api/user/${userId}/health-score`).then((r) => {
        if (!r.ok) throw new Error("Failed to load health score");
        return r.json();
      }),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

export function useNudge(userId: string | undefined) {
  return useQuery<{ nudge: string }>({
    queryKey: ["/api/user", userId, "nudge"],
    queryFn: () =>
      fetch(`/api/user/${userId}/nudge`, { method: "POST" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load nudge");
        return r.json();
      }),
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useGoals(userId: string | undefined) {
  return useQuery<
    Array<{
      id: string;
      name: string;
      targetAmount: number;
      currentAmount: number | null;
      weeklyContribution: number | null;
      deadline: string | null;
      status: "on_track" | "at_risk" | "paused";
    }>
  >({
    queryKey: ["/api/user", userId, "goals"],
    queryFn: () =>
      fetch(`/api/user/${userId}/goals`).then((r) => {
        if (!r.ok) throw new Error("Failed to load goals");
        return r.json();
      }),
    enabled: !!userId,
    staleTime: 60_000,
  });
}
