"use client";

import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ContentLibraryKind, ContentLifecycle, WorkbenchFilters, WorkbenchTypeFilter } from "./types";

/** Basic asset types; scenes have their own library. */
export const WORKBENCH_TYPE_FILTERS: WorkbenchTypeFilter[] = ["all", "model", "image", "video", "audio", "text", "link", "document"];
const STATES: ContentLifecycle[] = ["active", "archived"];

export interface WorkbenchToolbarProps {
  kind: ContentLibraryKind;
  filters: WorkbenchFilters;
  onFiltersChange: (filters: WorkbenchFilters) => void;
}

/** Compact library tools; the asset type selector is omitted in the scene library. */
export function WorkbenchToolbar({ kind, filters, onFiltersChange }: WorkbenchToolbarProps) {
  const { t } = useTranslation();
  const set = <K extends keyof WorkbenchFilters>(key: K, value: WorkbenchFilters[K]) => onFiltersChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-36 sm:max-w-sm">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => set("query", event.target.value)}
          placeholder={t("contentModel.workbench.search")}
          aria-label={t("contentModel.workbench.search")}
          className="ps-8 pe-8"
        />
        {filters.query && (
          <Button variant="ghost" size="icon" className="absolute end-0.5 top-0.5 size-8" onClick={() => set("query", "")} aria-label={t("contentModel.action.clearSearch")}>
            <X aria-hidden />
          </Button>
        )}
      </div>
      {kind === "asset" && (
        <Select value={filters.type} onValueChange={(value) => set("type", value as WorkbenchTypeFilter)}>
          <SelectTrigger aria-label={t("contentModel.workbench.typeLabel")} className="w-auto sm:w-32 lg:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORKBENCH_TYPE_FILTERS.map((value) => <SelectItem key={value} value={value}>{t(value === "all" ? "contentModel.filter.allTypes" : `contentModel.workbench.types.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={filters.state} onValueChange={(value) => set("state", value as ContentLifecycle)}>
        <SelectTrigger aria-label={t("contentModel.workbench.stateLabel")} className="w-auto min-w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATES.map((value) => <SelectItem key={value} value={value}>{t(`contentModel.filter.states.${value}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function hasActiveWorkbenchFilters(filters: WorkbenchFilters) {
  return Boolean(filters.query.trim()) || filters.type !== "all" || filters.state !== "active";
}
