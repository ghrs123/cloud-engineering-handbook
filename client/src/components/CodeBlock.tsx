import { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language: string;
  label?: string;
  className?: string;
}

export function CodeBlock({ code, language, label, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("not-prose my-4", className)}>
      {label && (
        <div className="rounded-t-lg border border-b-0 border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
          {label}
        </div>
      )}
      <div className="relative">
        <Highlight theme={themes.vsDark} code={code} language={language}>
          {({ className: preClassName, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={cn(
                "overflow-x-auto rounded-b-lg border border-[hsl(var(--border))] bg-[#0d1117] p-4 font-mono text-[0.875rem] leading-relaxed prism-code",
                label ? "rounded-t-none" : "rounded-lg",
                preClassName
              )}
              style={{ ...style, margin: 0 }}
            >
              <code>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </code>
            </pre>
          )}
        </Highlight>
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-2 top-2 h-8 w-8 p-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
