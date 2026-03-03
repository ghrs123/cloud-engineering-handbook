import { Link } from "wouter";
import { getAllChapters } from "@/lib/courseData";
import { ROUTES } from "@/const";

export function CurriculumPage() {
  const chapters = getAllChapters();

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="container mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-[hsl(var(--foreground))]">
          Full Curriculum
        </h1>
        <p className="mb-8 text-[hsl(var(--muted-foreground))]">
          All modules and chapters in order. Click a chapter to go to its module.
        </p>
        <div className="space-y-6">
          {chapters.map(({ module: mod, chapter }) => (
            <div
              key={`${mod.id}-${chapter.id}`}
              className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
            >
              <div>
                <span className="text-xs font-medium text-sky-400">
                  MODULE {mod.id} — {mod.title}
                </span>
                <p className="font-medium text-[hsl(var(--card-foreground))]">
                  {chapter.id} — {chapter.title}
                </p>
              </div>
              <Link href={ROUTES.MODULE_ID(mod.id)}>
                <a className="text-sm text-sky-400 hover:underline">
                  Open module →
                </a>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
