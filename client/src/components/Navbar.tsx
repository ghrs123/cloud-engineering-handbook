import { Link } from "wouter";
import { useState } from "react";
import { Menu, X, Cloud, BookOpen, LayoutGrid, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { ROUTES } from "@/const";
import { cn } from "@/lib/utils";

const navItems = [
  { href: ROUTES.HOME, label: "Home", icon: Cloud },
  { href: ROUTES.CURRICULUM, label: "Curriculum", icon: BookOpen },
  { href: ROUTES.CAPSTONE, label: "Capstone", icon: Target },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[hsl(var(--border))] bg-[#0d1117]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0d1117]/80">
      <div className="container flex h-14 items-center justify-between px-4">
        <Link href={ROUTES.HOME} className="flex items-center gap-2 font-semibold text-[hsl(var(--foreground))]">
          <LayoutGrid className="h-6 w-6 text-sky-400" />
          <span className="hidden sm:inline">Cloud-Native Engineering</span>
        </Link>

        <nav className="hidden md:flex md:items-center md:gap-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}>
              <a
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </a>
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-[hsl(var(--border))] px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <a
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </a>
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
