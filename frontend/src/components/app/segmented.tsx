"use client";

import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("neu-inset inline-flex rounded-xl! p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
            value === o.value && "bg-card text-brand-700 shadow-[2px_2px_6px_var(--neu-shadow)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
