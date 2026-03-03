import { motion } from "framer-motion";
import { modules } from "@/lib/courseData";
import { ModuleCard } from "@/components/ModuleCard";
import { CONTENT_SCOPE, THEME_NAME } from "@/const";

export function Home() {
  const totalChapters = modules.reduce((acc, m) => acc + m.chapters.length, 0);

  return (
    <div className="min-h-screen">
      <section className="border-b border-[hsl(var(--border))] bg-gradient-to-b from-sky-500/5 to-transparent px-4 py-16">
        <div className="container mx-auto max-w-4xl">
          <motion.h1
            className="text-3xl font-bold tracking-tight text-[hsl(var(--foreground))] sm:text-4xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            Cloud-Native Engineering with Spring Boot
          </motion.h1>
          <motion.p
            className="mt-4 text-lg text-[hsl(var(--muted-foreground))]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            Production-grade curriculum for Java backend engineers. Build the
            Order Processing Platform capstone from REST API through Kubernetes,
            SQS, Terraform, and observability.
          </motion.p>
          <motion.div
            className="mt-8 flex flex-wrap gap-4 text-sm text-[hsl(var(--muted-foreground))]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <span>{modules.length} modules</span>
            <span>{totalChapters} chapters</span>
            <span>{THEME_NAME} theme</span>
          </motion.div>
        </div>
      </section>

      <section className="container mx-auto max-w-4xl px-4 py-12">
        <h2 className="mb-6 text-xl font-semibold text-[hsl(var(--foreground))]">
          Modules
        </h2>
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
          {modules.map((mod, i) => (
            <ModuleCard key={mod.id} module={mod} index={i} />
          ))}
        </div>
      </section>

      <footer className="border-t border-[hsl(var(--border))] px-4 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
        <p>{CONTENT_SCOPE}</p>
      </footer>
    </div>
  );
}
