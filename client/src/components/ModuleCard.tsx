import { Link } from "wouter";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { Module } from "@/lib/courseData";
import { ROUTES } from "@/const";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ModuleCardProps {
  module: Module;
  index?: number;
}

const accentBorderClass: Record<string, string> = {
  sky: "border-sky-500/30 hover:border-sky-500/50",
  cyan: "border-cyan-500/30 hover:border-cyan-500/50",
  blue: "border-blue-500/30 hover:border-blue-500/50",
  violet: "border-violet-500/30 hover:border-violet-500/50",
  orange: "border-orange-500/30 hover:border-orange-500/50",
};

const accentTextClass: Record<string, string> = {
  sky: "text-sky-400",
  cyan: "text-cyan-400",
  blue: "text-blue-400",
  violet: "text-violet-400",
  orange: "text-orange-400",
};

export function ModuleCard({ module, index = 0 }: ModuleCardProps) {
  const href = ROUTES.MODULE_ID(module.id);
  const borderClass = accentBorderClass[module.accentColor] ?? accentBorderClass.sky;
  const textClass = accentTextClass[module.accentColor] ?? accentTextClass.sky;

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="group"
    >
      <Link href={href}>
        <a
          className={cn(
            "block rounded-lg border bg-[hsl(var(--card))] p-5 transition-all hover:shadow-lg hover:shadow-sky-500/5",
            borderClass
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="outline" className={textClass}>
                  MODULE {module.id}
                </Badge>
                <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  {module.subtitle}
                </span>
              </div>
              <h3 className="mb-2 font-semibold text-[hsl(var(--card-foreground))] group-hover:text-sky-400 transition-colors">
                {module.title}
              </h3>
              <p className="text-sm text-[hsl(var(--muted-foreground))] line-clamp-2">
                {module.description}
              </p>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                {module.chapters.length} chapters
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))] group-hover:text-sky-400 transition-colors" />
          </div>
        </a>
      </Link>
    </motion.article>
  );
}
