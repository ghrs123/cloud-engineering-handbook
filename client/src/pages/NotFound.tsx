import { Link } from "wouter";
import { ROUTES } from "@/const";

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
        404 — Page not found
      </h1>
      <p className="mt-2 text-[hsl(var(--muted-foreground))]">
        The page you’re looking for doesn’t exist.
      </p>
      <Link href={ROUTES.HOME}>
        <a className="mt-6 text-sky-400 hover:underline">Back to Home</a>
      </Link>
    </div>
  );
}
