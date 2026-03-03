import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { cn } from "@/lib/utils";

interface MermaidDiagramProps {
  chart: string;
  title?: string;
  className?: string;
}

export function MermaidDiagram({ chart, title, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !chart.trim()) return;

    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: "inherit",
    });

    const el = containerRef.current;
    el.textContent = chart;

    mermaid
      .run({
        nodes: [el],
        suppressErrors: false,
      })
      .then(() => {
        const svg = el.querySelector("svg");
        if (svg) {
          svg.classList.add("max-w-full", "h-auto");
        }
        setError(null);
      })
      .catch((err) => {
        setError(err.message ?? "Failed to render diagram");
      });
  }, [chart]);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive",
          className
        )}
      >
        <p className="font-medium">Diagram could not be rendered</p>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("mermaid-container my-4", className)}>
      {title && (
        <p className="mb-2 text-sm font-medium text-[hsl(var(--muted-foreground))]">
          {title}
        </p>
      )}
      <div ref={containerRef} className="mermaid">
        {chart}
      </div>
    </div>
  );
}
