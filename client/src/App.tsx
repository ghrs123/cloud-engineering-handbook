import { Route, Switch } from "wouter";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ROUTES } from "@/const";
import { Home } from "@/pages/Home";
import { ModulePage } from "@/pages/ModulePage";
import { CurriculumPage } from "@/pages/CurriculumPage";
import { CapstonePage } from "@/pages/CapstonePage";
import { NotFound } from "@/pages/NotFound";

function Router() {
  return (
    <Switch>
      <Route path={ROUTES.HOME} component={Home} />
      <Route path={ROUTES.MODULE} component={ModulePage} />
      <Route path={ROUTES.CURRICULUM} component={CurriculumPage} />
      <Route path={ROUTES.CAPSTONE} component={CapstonePage} />
      <Route path={ROUTES.NOT_FOUND} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
