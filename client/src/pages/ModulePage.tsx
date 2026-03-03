import { useParams } from "wouter";
import { useRef, useEffect, useState } from "react";
import { getModuleById } from "@/lib/courseData";
import { ChapterCard } from "@/components/ChapterCard";
import { ProgressTracker } from "@/components/ProgressTracker";
import { Navbar } from "@/components/Navbar";
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

  const activeIndex = module.chapters.findIndex((ch) => ch.id === activeChapterId);

  return (
    <div className="min-h-screen bg-[#0d1117]">
      <Navbar />
      <div className="flex pt-14">
        {/* Sidebar */}
        <aside className="hidden lg:block w-16 border-r border-[#21262d] flex-shrink-0">
          <ProgressTracker
            chapters={module.chapters}
            activeIndex={Math.max(0, activeIndex)}
            accentColor={module.accentColor}
          />
        </aside>

        {/* Main content */}
        <main ref={containerRef} className="flex-1 px-6 py-8 md:px-10">
          <div className="mx-auto max-w-3xl">
            {/* Module header */}
            <div className="mb-10">
              <p className="mb-1 font-[JetBrains_Mono] text-xs tracking-widest text-slate-500 uppercase">
                Module {String(module.id).padStart(2, "0")}
              </p>
              <h1 className="text-3xl font-bold text-white font-[IBM_Plex_Sans] leading-tight">
                {module.title}
              </h1>
              <p className="mt-3 text-slate-400 leading-relaxed">
                {module.description}
              </p>
            </div>

            {/* Chapters */}
            <div className="space-y-5">
              {module.chapters.map((ch) => (
                <ChapterCard
                  key={ch.id}
                  chapter={ch}
                  moduleAccent={module.accentColor}
                />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
