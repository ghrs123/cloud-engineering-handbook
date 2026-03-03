import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/CodeBlock";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import type { Chapter } from "@/lib/courseData";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Dumbbell,
  GitBranch,
  AlertTriangle,
  Target,
  MessageSquare,
  BookOpen,
  Link as LinkIcon,
  XOctagon,
  Cpu,
} from "lucide-react";

interface ChapterCardProps {
  readonly chapter: Chapter;
  readonly moduleAccent?: string;
  readonly className?: string;
}

// ── Accent config ─────────────────────────────────────────────────────────────
const accentMap: Record<
  string,
  { badge: string; border: string; chip: string; dot: string; ring: string }
> = {
  sky: {
    badge: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    border: "border-sky-500/20",
    chip: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    dot: "bg-sky-400",
    ring: "ring-sky-500/30",
  },
  cyan: {
    badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    border: "border-cyan-500/20",
    chip: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    dot: "bg-cyan-400",
    ring: "ring-cyan-500/30",
  },
  blue: {
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    border: "border-blue-500/20",
    chip: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dot: "bg-blue-400",
    ring: "ring-blue-500/30",
  },
  violet: {
    badge: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    border: "border-violet-500/20",
    chip: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    dot: "bg-violet-400",
    ring: "ring-violet-500/30",
  },
  orange: {
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    border: "border-orange-500/20",
    chip: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dot: "bg-orange-400",
    ring: "ring-orange-500/30",
  },
};

// ── Content renderer ──────────────────────────────────────────────────────────
function renderContent(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-[#161b22] px-1.5 py-0.5 font-[JetBrains_Mono] text-[0.8em] text-sky-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Difficulty badge variant ──────────────────────────────────────────────────
function difficultyBadge(level: string) {
  if (level === "advanced") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (level === "intermediate") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
}

// ── Main component ────────────────────────────────────────────────────────────
export function ChapterCard({ chapter, moduleAccent = "sky", className }: ChapterCardProps) {
  const [expanded, setExpanded] = useState(false);
  const accent = accentMap[moduleAccent] ?? accentMap.sky;

  const hasCode = chapter.codeExamples.length > 0;
  const hasExercises = chapter.exercises.length > 0;
  const hasDiagrams = chapter.diagrams.length > 0;
  const hasWarnings = chapter.warnings.length > 0;
  const hasOutcomes = chapter.outcomes.length > 0;
  const hasAntiPatterns = chapter.antiPatterns.length > 0;
  const hasInterview = Boolean(chapter.interviewMode);
  const hasReferences = chapter.references.length > 0;
  const hasConcepts = chapter.concepts.length > 0;

  const hasExpandableContent =
    chapter.content ||
    hasConcepts ||
    hasCode ||
    hasDiagrams ||
    hasWarnings ||
    hasOutcomes ||
    hasAntiPatterns ||
    hasExercises ||
    hasInterview ||
    hasReferences;

  return (
    <section
      id={`chapter-${chapter.id}`}
      data-chapter-id={chapter.id}
      className={cn(
        "scroll-mt-24 rounded-xl border bg-[#0d1117] transition-all duration-200",
        accent.border,
        expanded && `ring-1 ${accent.ring}`,
        className
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="p-5">
        {/* Top row: chapter id badge + expand toggle */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span
                className={cn(
                  "inline-flex items-center rounded border px-2 py-0.5 font-[JetBrains_Mono] text-[10px] font-semibold tracking-widest",
                  accent.badge
                )}
              >
                {chapter.id}
              </span>

              {/* Feature chips */}
              {hasCode && (
                <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px]", accent.chip)}>
                  <Code2 className="h-2.5 w-2.5" />
                  {chapter.codeExamples.length} code
                </span>
              )}
              {hasExercises && (
                <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px]", accent.chip)}>
                  <Dumbbell className="h-2.5 w-2.5" />
                  {chapter.exercises.length} ex
                </span>
              )}
              {hasDiagrams && (
                <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px]", accent.chip)}>
                  <GitBranch className="h-2.5 w-2.5" />
                  {chapter.diagrams.length} diag
                </span>
              )}
              {hasInterview && (
                <span className="inline-flex items-center gap-1 rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
                  <MessageSquare className="h-2.5 w-2.5" />
                  interview
                </span>
              )}
            </div>

            <h2 className="text-base font-semibold leading-snug text-white font-[IBM_Plex_Sans]">
              {chapter.title}
            </h2>

            {chapter.description && (
              <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                {chapter.description}
              </p>
            )}
          </div>

          {/* Expand/collapse button */}
          {hasExpandableContent && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                "flex-shrink-0 rounded-lg border p-2 transition-colors",
                "border-[#21262d] bg-[#161b22] text-slate-400 hover:text-white hover:border-[#30363d]"
              )}
              aria-label={expanded ? "Collapse chapter" : "Expand chapter"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Capstone connection — always visible */}
        {chapter.capstoneConnection && (
          <blockquote
            className={cn(
              "mt-3 flex items-start gap-2 rounded-lg border border-l-4 p-3 text-sm",
              accent.border,
              "bg-[#161b22]"
            )}
          >
            <Cpu className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <span className="italic text-slate-400">
              <span className="not-italic font-medium text-slate-300">Capstone: </span>
              {chapter.capstoneConnection}
            </span>
          </blockquote>
        )}
      </div>

      {/* ── Expandable body ──────────────────────────────────────────────────── */}
      {hasExpandableContent && expanded && (
        <div className="border-t border-[#21262d] px-5 pb-6 pt-5 space-y-6">

          {/* Content */}
          {chapter.content && (
            <div className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">
              {chapter.content.split("\n").map((line, i) => (
                <p key={i} className={line === "" ? "mt-3" : ""}>
                  {renderContent(line)}
                </p>
              ))}
            </div>
          )}

          {/* Concepts */}
          {hasConcepts && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <BookOpen className="h-3.5 w-3.5" />
                Concepts
              </h3>
              <div className="flex flex-wrap gap-2">
                {chapter.concepts.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-[#30363d] bg-[#161b22] px-3 py-1 font-[JetBrains_Mono] text-xs text-slate-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Outcomes */}
          {hasOutcomes && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Target className="h-3.5 w-3.5" />
                What you need to know
              </h3>
              <ol className="space-y-1.5">
                {chapter.outcomes.map((o, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <span
                      className={cn(
                        "flex-shrink-0 mt-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold",
                        accent.dot,
                        "text-[#0d1117]"
                      )}
                    >
                      {i + 1}
                    </span>
                    <span>{renderContent(o)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Code Examples */}
          {hasCode && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Code2 className="h-3.5 w-3.5" />
                Code examples
              </h3>
              {chapter.codeExamples.map((ex, i) => (
                <CodeBlock
                  key={i}
                  code={ex.code}
                  language={ex.language}
                  label={ex.label}
                  explanation={ex.explanation}
                />
              ))}
            </div>
          )}

          {/* Diagrams */}
          {hasDiagrams && (
            <div className="space-y-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <GitBranch className="h-3.5 w-3.5" />
                Diagrams
              </h3>
              {chapter.diagrams.map((d, i) => (
                <MermaidDiagram key={i} chart={d.mermaid} title={d.title} />
              ))}
            </div>
          )}

          {/* Warnings */}
          {hasWarnings && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-500/80">
                <AlertTriangle className="h-3.5 w-3.5" />
                Warnings
              </h3>
              <div className="space-y-2">
                {chapter.warnings.map((w, i) => {
                  const colonIdx = w.indexOf(":");
                  const hasTitle = colonIdx > 0 && colonIdx < 40;
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3 text-sm"
                    >
                      {hasTitle ? (
                        <>
                          <span className="font-semibold text-amber-300">
                            {w.slice(0, colonIdx)}
                          </span>
                          <span className="text-amber-200/80">{w.slice(colonIdx)}</span>
                        </>
                      ) : (
                        <span className="text-amber-200/80">{w}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Anti-Patterns */}
          {hasAntiPatterns && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <XOctagon className="h-3.5 w-3.5" />
                Common mistakes
              </h3>
              <div className="space-y-2">
                {chapter.antiPatterns.map((a, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-red-500/20 bg-[#161b22] p-3 text-sm"
                  >
                    <p className="font-semibold text-red-400">{a.title}</p>
                    <p className="mt-0.5 text-slate-400">{a.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exercises */}
          {hasExercises && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Dumbbell className="h-3.5 w-3.5" />
                Exercises
              </h3>
              <Accordion type="single" collapsible>
                {chapter.exercises.map((ex, i) => (
                  <AccordionItem
                    key={i}
                    value={`ex-${i}`}
                    className="border-[#21262d]"
                  >
                    <AccordionTrigger className="text-left hover:no-underline py-3">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="text-slate-200">{ex.title}</span>
                        <span
                          className={cn(
                            "rounded border px-2 py-0.5 text-[10px] font-semibold",
                            difficultyBadge(ex.difficulty)
                          )}
                        >
                          {ex.difficulty}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-1 pb-2 space-y-3">
                        <p className="text-sm text-slate-400">{ex.description}</p>
                        {ex.hint && (
                          <div className={cn("rounded-lg border p-3 text-sm", accent.chip)}>
                            <span className="font-semibold">Hint: </span>
                            {ex.hint}
                          </div>
                        )}
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-slate-500">Solution</p>
                          <CodeBlock code={ex.solution} language={ex.solutionLanguage} />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}

          {/* Interview Mode */}
          {hasInterview && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/8 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-sky-400">
                <MessageSquare className="h-4 w-4" />
                Interview Mode
              </h3>
              <div className="text-sm leading-relaxed text-slate-300">
                {chapter.interviewMode.split("\n").map((line, i) => (
                  <p key={i} className={cn(line === "" ? "mt-3" : "")}>
                    {renderContent(line)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* References */}
          {hasReferences && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <LinkIcon className="h-3.5 w-3.5" />
                References
              </h3>
              <ul className="space-y-1.5">
                {chapter.references.map((ref, i) => (
                  <li key={i} className="text-sm">
                    {ref.url ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-sky-300 hover:underline transition-colors"
                      >
                        {ref.title}
                      </a>
                    ) : (
                      <span className="text-slate-400">{ref.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Collapsed hint */}
      {hasExpandableContent && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full border-t border-[#21262d] px-5 py-2.5 text-center text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          Click to expand chapter content
        </button>
      )}
    </section>
  );
}
