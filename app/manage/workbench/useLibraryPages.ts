"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiPage, LibraryPage } from "@/lib/content-model/contracts";
import type { ContentLoadStatus } from "../content/types";

const PAGE_SIZE = 30;
type PageLoader<T> = (offset: number, limit: number, signal: AbortSignal) => Promise<ApiPage<T> | LibraryPage<T>>;

export function useLibrarySearch(text: string) {
  const [value, setValue] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setValue(text), 300);
    return () => clearTimeout(timer);
  }, [text]);
  return value;
}

interface PageState<T> {
  items: T[];
  status: ContentLoadStatus;
  error: unknown;
  nextOffset: number;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: unknown;
}

/** One request at a time per filter set. Changing the loader cancels its entire paging session. */
export function useLibraryPages<T extends { id: string }>(load: PageLoader<T> | null) {
  const [version, setVersion] = useState(0);
  const session = useMemo(() => ({ load, version }), [load, version]);
  const [result, setResult] = useState<(PageState<T> & { session: typeof session }) | null>(null);
  const next = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    let offset = 0;
    let busy = false;
    let hasMore = true;
    const read = async () => {
      if (busy || !hasMore || controller.signal.aborted) return;
      busy = true;
      const first = offset === 0;
      if (!first) setResult(prev => prev?.session === session ? { ...prev, loadingMore: true, moreError: null } : prev);
      try {
        const { data, page } = await load(offset, PAGE_SIZE, controller.signal);
        if (controller.signal.aborted) return;
        const nextOffset = offset + data.length;
        const morePages = data.length > 0 && ("total" in page ? nextOffset < page.total : page.hasMore);
        offset = nextOffset;
        hasMore = morePages;
        setResult(prev => {
          const existing = prev?.session === session ? prev.items : [];
          const ids = new Set(existing.map(item => item.id));
          return {
            session, items: [...existing, ...data.filter(item => !ids.has(item.id))], status: "ready",
            error: null, nextOffset, hasMore: morePages, loadingMore: false, moreError: null,
          };
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (first) setResult({ session, items: [], status: "error", error, nextOffset: 0, hasMore: false, loadingMore: false, moreError: null });
        else setResult(prev => prev?.session === session ? { ...prev, loadingMore: false, moreError: error } : prev);
      } finally {
        busy = false;
      }
    };
    next.current = read;
    void read();
    return () => { controller.abort(); next.current = null; };
  }, [load, session]);

  const reload = useCallback(() => setVersion(value => value + 1), []);
  const loadMore = useCallback(() => next.current?.(), []);
  const current = result?.session === session ? result : null;
  return {
    items: current?.items ?? [],
    status: current?.status ?? ("loading" as const),
    error: current?.error,
    nextOffset: current?.nextOffset ?? 0,
    hasMore: current?.hasMore ?? false,
    loadingMore: current?.loadingMore ?? false,
    moreError: current?.moreError,
    loadMore, reload,
  };
}
