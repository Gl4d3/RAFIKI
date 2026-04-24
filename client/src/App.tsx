import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { RafikiProvider, useRafiki } from "@/lib/rafiki-context";

import { StatementUpload } from "@/pages/StatementUpload";
import { Annotation } from "@/pages/Annotation";
import { SilentAnalysis } from "@/pages/SilentAnalysis";
import { GapFilling } from "@/pages/GapFilling";
import { PriorityStackReview } from "@/pages/PriorityStackReview";
import { PriorityStack } from "@/pages/PriorityStack";
import { Home } from "@/pages/Home";
import { Chat } from "@/pages/Chat";
import { Goals } from "@/pages/Goals";
import { Activity } from "@/pages/Activity";
import { Instructions } from "@/pages/Instructions";

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useRafiki();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user?.stage === "complete") {
      setLocation("/home");
    }
  }, [isLoading, user?.stage]);

  if (isLoading) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => (
        <OnboardingGuard>
          <StatementUpload />
        </OnboardingGuard>
      )} />
      <Route path="/annotate" component={Annotation} />
      <Route path="/analyzing" component={SilentAnalysis} />
      <Route path="/reveal" component={GapFilling} />
      <Route path="/gap-filling" component={GapFilling} />
      <Route path="/priority-stack-review" component={PriorityStackReview} />
      <Route path="/priority-stack" component={PriorityStack} />
      <Route path="/home" component={Home} />
      <Route path="/chat" component={Chat} />
      <Route path="/goals" component={Goals} />
      <Route path="/activity" component={Activity} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RafikiProvider>
          <Toaster />
          <Router />
        </RafikiProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
