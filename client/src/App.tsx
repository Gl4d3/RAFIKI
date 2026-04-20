import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { StatementUpload } from "@/pages/StatementUpload";
import { SilentAnalysis } from "@/pages/SilentAnalysis";
import { GapFilling } from "@/pages/GapFilling";
import { PriorityStackReview } from "@/pages/PriorityStackReview";
import { PriorityStack } from "@/pages/PriorityStack";

function Router() {
  return (
    <Switch>
      <Route path="/" component={StatementUpload} />
      <Route path="/analyzing" component={SilentAnalysis} />
      <Route path="/reveal" component={GapFilling} />
      <Route path="/priority-stack-review" component={PriorityStackReview} />
      <Route path="/priority-stack" component={PriorityStack} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
