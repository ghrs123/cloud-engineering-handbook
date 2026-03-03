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

interface ChapterCardProps {
  chapter: Chapter;
  moduleAccent?: string;
  className?: string;
}

export function ChapterCard({ chapter, moduleAccent = "sky", className }: ChapterCardProps) {
  const hasContent =
    chapter.content ||
    chapter.codeExamples.length > 0 ||
    chapter.diagrams.length > 0 ||
    chapter.exercises.length > 0 ||
    chapter.outcomes.length > 0 ||
    chapter.warnings.length > 0 ||
    chapter.antiPatterns.length > 0 ||
    chapter.interviewMode;

  if (!hasContent) {
    return (
      <section
        id={`chapter-${chapter.id}`}
        data-chapter-id={chapter.id}
        className={cn("scroll-mt-24 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5", className)}
      >
        <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">
          {chapter.id} — {chapter.title}
        </h2>
        {chapter.capstoneConnection ? (
          <blockquote className="mt-2 border-l-2 border-sky-500/50 pl-4 text-sm italic text-[hsl(var(--muted-foreground))]">
            {chapter.capstoneConnection}
          </blockquote>
        ) : null}
      </section>
    );
  }

  return (
    <section
      id={`chapter-${chapter.id}`}
      data-chapter-id={chapter.id}
      className={cn("scroll-mt-24 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5", className)}
    >
      <h2 className="text-lg font-semibold text-[hsl(var(--card-foreground))]">
        {chapter.id} — {chapter.title}
      </h2>

      {chapter.capstoneConnection && (
        <blockquote className="mt-2 border-l-2 border-sky-500/50 pl-4 text-sm italic text-[hsl(var(--muted-foreground))]">
          Capstone connection: {chapter.capstoneConnection}
        </blockquote>
      )}

      {chapter.content && (
        <div className="prose prose-invert mt-4 max-w-none">
          <p className="whitespace-pre-line text-sm leading-relaxed text-[hsl(var(--foreground))]">
            {chapter.content}
          </p>
        </div>
      )}

      {chapter.concepts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-[hsl(var(--card-foreground))]">Concepts</h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[hsl(var(--muted-foreground))]">
            {chapter.concepts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {chapter.codeExamples.map((ex, i) => (
        <CodeBlock
          key={i}
          code={ex.code}
          language={ex.language}
          label={ex.label}
        />
      ))}

      {chapter.diagrams.map((d, i) => (
        <MermaidDiagram key={i} chart={d.mermaid} title={d.title} />
      ))}

      {chapter.warnings.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <h3 className="text-sm font-medium text-amber-400">Warnings</h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-200/90">
            {chapter.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {chapter.outcomes.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-[hsl(var(--card-foreground))]">What you need to know</h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[hsl(var(--muted-foreground))]">
            {chapter.outcomes.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {chapter.antiPatterns.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-[hsl(var(--card-foreground))]">Common mistakes</h3>
          <ul className="mt-2 space-y-2">
            {chapter.antiPatterns.map((a, i) => (
              <li key={i} className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 p-2 text-sm">
                <span className="font-medium text-destructive/90">{a.title}.</span>{" "}
                <span className="text-[hsl(var(--muted-foreground))]">{a.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {chapter.exercises.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-[hsl(var(--card-foreground))]">Exercises</h3>
          <Accordion type="single" collapsible className="mt-2">
            {chapter.exercises.map((ex, i) => (
              <AccordionItem key={i} value={`ex-${i}`}>
                <AccordionTrigger className="text-left">
                  <span className="flex items-center gap-2">
                    {ex.title}
                    <Badge variant="secondary" className="text-xs">
                      {ex.difficulty}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{ex.description}</p>
                  {ex.hint && (
                    <p className="mt-2 text-xs text-sky-400/90">Hint: {ex.hint}</p>
                  )}
                  <div className="mt-3">
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Solution</p>
                    <CodeBlock
                      code={ex.solution}
                      language={ex.solutionLanguage}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}

      {chapter.interviewMode && (
        <div className="mt-6 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
          <h3 className="text-sm font-medium text-sky-400">Interview Mode</h3>
          <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--foreground))]">
            {chapter.interviewMode}
          </p>
        </div>
      )}
    </section>
  );
}
