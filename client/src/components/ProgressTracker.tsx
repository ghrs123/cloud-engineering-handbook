import { Link } from "wouter";
import type { Module } from "@/lib/courseData";
import { ROUTES } from "@/const";
import { cn } from "@/lib/utils";

interface ProgressTrackerProps {
  module: Module;
  currentChapterId?: string;
  className?: string;
}

export function ProgressTracker({
  module,
  currentChapterId,
  className,
}: ProgressTrackerProps) {
  return (
    <nav
      className={cn("flex flex-col gap-1", className)}
      aria-label="Chapter navigation"
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Chapters
      </h3>
      {module.chapters.map((ch) => {
        const isActive = ch.id === currentChapterId;
        return (
          <a
            key={ch.id}
            href={`#chapter-${ch.id}`}
            className={cn(
              "rounded-md px-3 py-2 text-left text-sm transition-colors",
              isActive
                ? "sidebar-active bg-sky-500/10 font-medium text-sky-400"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            {ch.id} — {ch.title}
          </a>
        );
      })}
    </nav>
  );
}
