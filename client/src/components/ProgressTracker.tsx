import { cn } from "@/lib/utils";

interface Chapter {
  readonly id: string;
  readonly title: string;
}

interface ProgressTrackerProps {
  readonly chapters: Chapter[];
  readonly activeIndex: number;
  readonly accentColor?: string;
}

const dotActiveClass: Record<string, string> = {
  sky: "bg-sky-400 ring-sky-400/30",
  cyan: "bg-cyan-400 ring-cyan-400/30",
  blue: "bg-blue-400 ring-blue-400/30",
  violet: "bg-violet-400 ring-violet-400/30",
  orange: "bg-orange-400 ring-orange-400/30",
};

const lineActiveClass: Record<string, string> = {
  sky: "bg-sky-400/50",
  cyan: "bg-cyan-400/50",
  blue: "bg-blue-400/50",
  violet: "bg-violet-400/50",
  orange: "bg-orange-400/50",
};

function dotClass(
  isNow: boolean,
  isPast: boolean,
  dotActive: string
): string {
  if (isNow)
    return cn(
      "border-0 ring-4 ring-offset-2 ring-offset-[#0d1117] scale-125",
      dotActive
    );
  if (isPast) return cn("border-0 opacity-70", dotActive);
  return "border-[#30363d] bg-[#161b22]";
}

export function ProgressTracker({
  chapters,
  activeIndex,
  accentColor = "sky",
}: ProgressTrackerProps) {
  const dotActive = dotActiveClass[accentColor] ?? dotActiveClass.sky;
  const lineActive = lineActiveClass[accentColor] ?? lineActiveClass.sky;

  return (
    <nav
      className="hidden lg:flex flex-col items-center sticky top-24 py-4"
      aria-label="Chapter progress"
    >
      {chapters.map((ch, i) => {
        const isPast = i < activeIndex;
        const isNow = i === activeIndex;

        return (
          <div key={ch.id} className="flex flex-col items-center">
            {/* Dot */}
            <a
              href={`#chapter-${ch.id}`}
              title={ch.title}
              className="group/dot flex items-center justify-center relative"
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full border-2 transition-all duration-300 z-10",
                  dotClass(isNow, isPast, dotActive)
                )}
              />
              {/* Tooltip label */}
              <span className="absolute left-6 w-48 text-xs text-slate-400 opacity-0 group-hover/dot:opacity-100 transition-opacity pointer-events-none font-[JetBrains_Mono] truncate">
                {ch.id} {ch.title}
              </span>
            </a>

            {/* Connector line (skip after last) */}
            {i < chapters.length - 1 && (
              <div
                className={cn(
                  "w-0.5 h-8 transition-colors duration-300",
                  isPast || isNow ? lineActive : "bg-[#21262d]"
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
