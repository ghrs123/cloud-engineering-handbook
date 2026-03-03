import { Route, Switch } from "wouter";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Navbar } from "@/components/Navbar";
import { ROUTES } from "@/const";
import { Home } from "@/pages/Home";
import { ModulePage } from "@/pages/ModulePage";
import { CurriculumPage } from "@/pages/CurriculumPage";
import { CapstonePage } from "@/pages/CapstonePage";
import { NotFound } from "@/pages/NotFound";

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <div className="min-h-screen bg-[#0d1117] text-[hsl(var(--foreground))]">
        <Navbar />
        <Switch>
          <Route path={ROUTES.HOME} component={Home} />
          <Route path={ROUTES.MODULE} component={ModulePage} />
          <Route path={ROUTES.CURRICULUM} component={CurriculumPage} />
          <Route path={ROUTES.CAPSTONE} component={CapstonePage} />
          <Route path={ROUTES.NOT_FOUND} component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </ThemeProvider>
  );
}

export default App;
