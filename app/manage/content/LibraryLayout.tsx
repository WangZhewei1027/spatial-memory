"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { ContentNotice } from "./ContentFeedback";

export interface LibraryPagination {
  hasMore: boolean;
  nextOffset: number;
  loadingMore: boolean;
  moreError: unknown;
  loadMore: () => void;
}

interface LibraryLayoutProps {
  title: string;
  actions?: ReactNode;
  readOnlyReason?: string;
  toolbar: ReactNode;
  pagination: LibraryPagination;
  children: ReactNode;
}

/** All team libraries share the stationary heading, scroll boundary and paging controls. */
export function LibraryLayout({ title, actions, readOnlyReason, toolbar, pagination, children }: LibraryLayoutProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const results = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const { hasMore, nextOffset, loadingMore, moreError, loadMore } = pagination;

  useEffect(() => {
    if (nextOffset === 0) results.current?.scrollTo({ top: 0 });
  }, [nextOffset]);

  useEffect(() => {
    if (!hasMore || loadingMore || moreError || !results.current || !end.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore();
    }, { root: results.current, rootMargin: "0px 0px 160px" });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [hasMore, nextOffset, loadingMore, moreError, loadMore]);

  return (
    <section aria-labelledby={headingId} className="team-library flex min-h-0 flex-1 flex-col">
      <header data-scrolled={scrolled} className="relative z-10 flex shrink-0 flex-col gap-4 border-b border-transparent bg-background px-3 pb-4 pt-3 data-[scrolled=true]:border-border data-[scrolled=true]:shadow-sm sm:px-4 sm:pt-4 lg:px-5 lg:pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="h1" id={headingId} variant="headingLg" breakWord>{title}</Text>
          {actions}
          {readOnlyReason && <p className="flex max-w-sm items-start gap-1.5 text-sm text-muted-foreground"><Eye className="mt-0.5 size-4 shrink-0" aria-hidden />{readOnlyReason}</p>}
        </div>
        {toolbar}
      </header>

      <div ref={results} role="region" aria-labelledby={headingId} tabIndex={0}
        onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}
        className="min-h-24 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
        <div className="flex min-h-full flex-col gap-4 px-3 pb-3 pt-px sm:px-4 sm:pb-4 lg:px-5 lg:pb-5">
          {children}
          {hasMore && <div ref={end} className="min-h-px">
            {moreError ? <ContentNotice tone="critical" title={t("contentModel.state.loadFailed")}
              description={moreError instanceof Error ? moreError.message : typeof moreError === "string" ? moreError : undefined}
              action={<Button size="sm" variant="outline" onClick={loadMore}>{t("contentModel.action.retry")}</Button>} />
              : loadingMore && <Text as="p" role="status" variant="bodySm" tone="subdued" alignment="center">{t("contentModel.state.loading")}</Text>}
          </div>}
        </div>
      </div>
    </section>
  );
}
