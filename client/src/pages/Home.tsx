import { useEffect, useRef } from "react";
import { Cloud, Layers, BookOpen, Code2, Server } from "lucide-react";
import { modules } from "@/lib/courseData";
import { ModuleCard } from "@/components/ModuleCard";
import { Navbar } from "@/components/Navbar";

const stats = [
  { icon: Layers, label: "Módulos", value: "8" },
  { icon: BookOpen, label: "Capítulos", value: "42+" },
  { icon: Code2, label: "Linguagem", value: "Java 21" },
  { icon: Server, label: "Framework", value: "Spring Boot 3.x" },
];

export function Home() {
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).style.opacity = "1";
            (entry.target as HTMLElement).style.transform = "translateY(0)";
          }
        });
      },
      { threshold: 0.08 }
    );

    const cards = cardsRef.current?.querySelectorAll(".module-card-wrapper");
    cards?.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[#0d1117]">
      <Navbar />

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-24 pb-16">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(56,189,248,1) 1px, transparent 1px)," +
              "linear-gradient(90deg, rgba(56,189,248,1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {/* Top glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[280px] bg-sky-500/8 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Cloud className="w-5 h-5 text-sky-400" />
            <span className="text-sky-400 font-[JetBrains_Mono] text-xs tracking-[0.25em] uppercase">
              Cloud Engineering Handbook
            </span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight font-[IBM_Plex_Sans]">
            Cloud-Native Engineering
            <br />
            <span className="text-sky-400 cloud-glow">with Spring Boot</span>
          </h1>

          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-3 font-[IBM_Plex_Sans]">
            Currículo de engenharia de produção para desenvolvedores Java.
            Build, deploy e operar sistemas cloud-native de verdade.
          </p>
          <p className="text-slate-500 text-sm font-[JetBrains_Mono] mb-14">
            Cada módulo entrega uma parte do Capstone. Sem lacunas.
          </p>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {stats.map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className="glass-card rounded-xl p-4 border border-sky-500/10 hover:border-sky-500/25 transition-colors"
              >
                <Icon className="w-4 h-4 text-sky-400 mx-auto mb-2" />
                <div className="text-white font-bold text-xl font-[JetBrains_Mono]">
                  {value}
                </div>
                <div className="text-slate-500 text-xs mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules grid ─────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div ref={cardsRef} className="relative">
          {/* Timeline vertical line — desktop */}
          <div className="hidden md:block absolute left-1/2 -translate-x-px top-8 bottom-8 w-px bg-gradient-to-b from-sky-500/30 via-sky-500/10 to-transparent pointer-events-none" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {modules.map((mod, index) => (
              <div
                key={mod.id}
                className="module-card-wrapper"
                style={{
                  opacity: 0,
                  transform: "translateY(20px)",
                  transition: `opacity 0.5s ease ${index * 70}ms, transform 0.5s ease ${index * 70}ms`,
                }}
              >
                <ModuleCard module={mod} index={index} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-[#21262d] py-8 text-center">
        <p className="text-slate-600 text-xs font-[JetBrains_Mono]">
          Production-driven · Capstone-oriented · No generic system design
        </p>
      </footer>
    </div>
  );
}
