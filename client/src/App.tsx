import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { RafikiProvider } from "@/lib/rafiki-context";

import { StatementUpload } from "@/pages/StatementUpload";
import { Annotation } from "@/pages/Annotation";
import { SilentAnalysis } from "@/pages/SilentAnalysis";
import { GapFilling } from "@/pages/GapFilling";
import { PriorityStackReview } from "@/pages/PriorityStackReview";
import { PriorityStack } from "@/pages/PriorityStack";
import { Home } from "@/pages/Home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={StatementUpload} />
      <Route path="/annotate" component={Annotation} />
      <Route path="/analyzing" component={SilentAnalysis} />
      <Route path="/reveal" component={PriorityStackReview} />
      <Route path="/gap-filling" component={GapFilling} />
      <Route path="/priority-stack-review" component={PriorityStackReview} />
      <Route path="/priority-stack" component={PriorityStack} />
      <Route path="/home" component={Home} />
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
