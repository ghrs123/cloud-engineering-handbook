import { useParams } from "wouter";
import { useRef, useEffect, useState } from "react";
import { getModuleById } from "@/lib/courseData";
import { ChapterCard } from "@/components/ChapterCard";
import { ProgressTracker } from "@/components/ProgressTracker";
import { NotFound } from "./NotFound";

export function ModulePage() {
  const params = useParams();
  const id = Number(params?.id);
  const module = getModuleById(id);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | undefined>(
    module?.chapters[0]?.id
  );

  useEffect(() => {
    if (!module || !containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          const chapterId = el.getAttribute("data-chapter-id");
          if (chapterId) setActiveChapterId(chapterId);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    const sections = containerRef.current.querySelectorAll("[data-chapter-id]");
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [module]);

  if (id == null || Number.isNaN(id) || !module) {
    return <NotFound />;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 md:w-64 md:border-b-0 md:border-r">
        <div className="sticky top-20">
          <ProgressTracker
            module={module}
            currentChapterId={activeChapterId}
          />
        </div>
      </aside>
      <main
        ref={containerRef}
        className="flex-1 px-4 py-8 md:px-8"
      >
        <div className="mx-auto max-w-3xl space-y-12">
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
            {module.title}
          </h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {module.description}
          </p>
          {module.chapters.map((ch) => (
            <div key={ch.id} data-chapter-id={ch.id}>
              <ChapterCard
                chapter={ch}
                moduleAccent={module.accentColor}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
