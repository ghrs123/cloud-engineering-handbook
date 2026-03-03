import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Root>{children}</TooltipPrimitive.Root>;
}

export function TooltipTrigger({
  children,
  asChild,
}: {
  children: ReactNode;
  asChild?: boolean;
}) {
  return (
    <TooltipPrimitive.Trigger asChild={asChild}>
      {children}
    </TooltipPrimitive.Trigger>
  );
}

export function TooltipContent({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={4}
        className="z-50 rounded-md bg-[#161b22] border border-[#30363d] px-3 py-1.5 text-xs text-slate-200 shadow-md animate-in fade-in-0 zoom-in-95"
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-[#161b22]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
