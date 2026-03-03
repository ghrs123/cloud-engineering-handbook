import { Link } from "wouter";
import { ChevronRight, BookOpen } from "lucide-react";
import type { Module } from "@/lib/courseData";
import { ROUTES } from "@/const";
import { cn } from "@/lib/utils";

interface ModuleCardProps {
  module: Module;
  index?: number;
}

const accentConfig: Record<
  string,
  { gradient: string; badge: string; text: string; border: string; glow: string }
> = {
  sky: {
    gradient: "from-sky-500/20 via-sky-500/5 to-transparent",
    badge: "bg-sky-500/15 text-sky-400 border-sky-500/25",
    text: "text-sky-400",
    border: "border-sky-500/20 hover:border-sky-500/40",
    glow: "group-hover:shadow-sky-500/10",
  },
  cyan: {
    gradient: "from-cyan-500/20 via-cyan-500/5 to-transparent",
    badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
    text: "text-cyan-400",
    border: "border-cyan-500/20 hover:border-cyan-500/40",
    glow: "group-hover:shadow-cyan-500/10",
  },
  blue: {
    gradient: "from-blue-500/20 via-blue-500/5 to-transparent",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    text: "text-blue-400",
    border: "border-blue-500/20 hover:border-blue-500/40",
    glow: "group-hover:shadow-blue-500/10",
  },
  violet: {
    gradient: "from-violet-500/20 via-violet-500/5 to-transparent",
    badge: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    text: "text-violet-400",
    border: "border-violet-500/20 hover:border-violet-500/40",
    glow: "group-hover:shadow-violet-500/10",
  },
  orange: {
    gradient: "from-orange-500/20 via-orange-500/5 to-transparent",
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/25",
    text: "text-orange-400",
    border: "border-orange-500/20 hover:border-orange-500/40",
    glow: "group-hover:shadow-orange-500/10",
  },
};

export function ModuleCard({ module, index = 0 }: ModuleCardProps) {
  const href = ROUTES.MODULE_ID(module.id);
  const accent = accentConfig[module.accentColor] ?? accentConfig.sky;
  const num = String(module.id).padStart(2, "0");

  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-xl border bg-[#0d1117] overflow-hidden transition-all duration-300",
        "hover:shadow-xl hover:-translate-y-0.5",
        accent.border,
        accent.glow
      )}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Gradient header */}
      <div
        className={cn(
          "relative h-24 bg-gradient-to-br",
          accent.gradient
        )}
      >
        {/* Module badge */}
        <span
          className={cn(
            "absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] font-[JetBrains_Mono] font-semibold border tracking-widest",
            accent.badge
          )}
        >
          MODULE {num}
        </span>

        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px)," +
              "linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        <ChevronRight
          className={cn(
            "absolute bottom-3 right-3 w-4 h-4 transition-transform group-hover:translate-x-1",
            accent.text
          )}
        />
      </div>

      {/* Body */}
      <div className="p-5">
        <p className={cn("text-xs font-[JetBrains_Mono] mb-1.5", accent.text)}>
          {module.subtitle}
        </p>
        <h3 className="font-semibold text-white mb-2 group-hover:text-sky-100 transition-colors font-[IBM_Plex_Sans] leading-snug">
          {module.title}
        </h3>
        <p className="text-sm text-slate-500 line-clamp-2 mb-4 leading-relaxed">
          {module.description}
        </p>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-[JetBrains_Mono]">
          <BookOpen className="w-3 h-3" />
          {module.chapters.length} capítulos
        </div>
      </div>
    </Link>
  );
}
