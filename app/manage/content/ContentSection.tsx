"use client";

import { useId, type ReactNode } from "react";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export interface ContentSectionProps {
  title: string;
  description?: string;
  /** Secondary actions for the section; the page keeps its single primary action. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  plain?: boolean;
}

/** Hairline-bounded detail section with a named heading region. */
export function ContentSection({ title, description, actions, children, className, plain }: ContentSectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn(plain ? "border-t" : "rounded-lg border bg-background", className)}>
      <div className={cn("flex flex-wrap items-start justify-between gap-2 py-3", !plain && "border-b px-4")}>
        <div className="min-w-0 space-y-0.5">
          <Text as={plain ? "h3" : "h2"} id={id} variant="bodyMd" fontWeight="semibold" tone="default">{title}</Text>
          {description && <Text as="p" variant="bodySm" tone="subdued">{description}</Text>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
