import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Menu, X, Cloud, BookOpen, Target } from "lucide-react";
import { modules } from "@/lib/courseData";
import { ROUTES } from "@/const";
import { cn } from "@/lib/utils";

const staticLinks = [
  { href: ROUTES.CURRICULUM, label: "Currículo", icon: BookOpen },
  { href: ROUTES.CAPSTONE, label: "Capstone", icon: Target },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  const isActive = (href: string) => location === href;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#21262d] bg-[#0d1117]/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-6">

        {/* Logo */}
        <Link
          href={ROUTES.HOME}
          className="flex items-center gap-2 group"
        >
          <Cloud className="h-5 w-5 text-sky-400 group-hover:text-sky-300 transition-colors" />
          <span className="font-[JetBrains_Mono] text-sm font-semibold text-white tracking-wider">
            CLOUD ENGINEERING
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {/* Dynamic module number links */}
          {modules.map((mod) => (
            <Link
              key={mod.id}
              href={ROUTES.MODULE_ID(mod.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-[JetBrains_Mono] font-medium transition-colors",
                isActive(ROUTES.MODULE_ID(mod.id))
                  ? "bg-sky-500/15 text-sky-400"
                  : "text-slate-400 hover:text-sky-300 hover:bg-sky-500/8"
              )}
            >
              {String(mod.id).padStart(2, "0")}
            </Link>
          ))}

          <div className="w-px h-5 bg-[#30363d] mx-2" />

          {/* Static links */}
          {staticLinks.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                isActive(href)
                  ? "bg-sky-500/15 text-sky-400"
                  : "text-slate-400 hover:text-sky-300 hover:bg-sky-500/8"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Mobile burger */}
        <button
          className="lg:hidden p-2 rounded-md text-slate-400 hover:text-white hover:bg-[#161b22] transition-colors"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-[#21262d] bg-[#0d1117] px-6 py-4">
          <p className="text-slate-600 text-[10px] font-[JetBrains_Mono] uppercase tracking-widest mb-2">
            Módulos
          </p>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {modules.map((mod) => (
              <Link
                key={mod.id}
                href={ROUTES.MODULE_ID(mod.id)}
                className="text-center py-2 rounded-md text-xs font-[JetBrains_Mono] font-medium text-slate-400 hover:text-sky-400 hover:bg-sky-500/8 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {String(mod.id).padStart(2, "0")}
              </Link>
            ))}
          </div>

          <div className="w-full h-px bg-[#21262d] mb-3" />

          <div className="flex flex-col gap-1">
            {staticLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-300 hover:text-sky-400 hover:bg-sky-500/8 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
