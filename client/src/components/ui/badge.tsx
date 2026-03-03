import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "accent";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium",
        {
          default: "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          secondary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          outline: "border border-[hsl(var(--border))]",
          accent: "bg-sky-500/20 text-sky-400 border border-sky-500/30",
        }[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
