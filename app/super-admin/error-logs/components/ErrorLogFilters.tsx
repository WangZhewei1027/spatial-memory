"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, RotateCcw, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMPTY_FILTERS } from "../hooks/useErrorLogs";
import type { ErrorLogFilters } from "../types";

interface Props {
  filters: ErrorLogFilters;
  onChange: (next: ErrorLogFilters) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function ErrorLogFiltersBar({
  filters,
  onChange,
  onRefresh,
  loading,
}: Props) {
  const { t } = useTranslation();
  // Debounce the free-text search so we don't refetch on every keystroke.
  const [q, setQ] = useState(filters.q);

  useEffect(() => {
    setQ(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (q === filters.q) return;
    const id = setTimeout(() => onChange({ ...filters, q }), 400);
    return () => clearTimeout(id);
  }, [q, filters, onChange]);

  const isDirty =
    filters.scope !== "all" ||
    filters.statusClass !== "all" ||
    filters.q !== "" ||
    filters.from !== "" ||
    filters.to !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(
            "superAdmin.errorLogs.filters.searchPlaceholder",
            "Search message or path",
          )}
          className="pl-8 h-9"
        />
      </div>

      <Select
        value={filters.scope}
        onValueChange={(v) =>
          onChange({ ...filters, scope: v as ErrorLogFilters["scope"] })
        }
      >
        <SelectTrigger className="h-9 w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {t("superAdmin.errorLogs.filters.allScopes", "All scopes")}
          </SelectItem>
          <SelectItem value="client">
            {t("superAdmin.errorLogs.scope.client", "Client")}
          </SelectItem>
          <SelectItem value="api">
            {t("superAdmin.errorLogs.scope.api", "API")}
          </SelectItem>
          <SelectItem value="server">
            {t("superAdmin.errorLogs.scope.server", "Server")}
          </SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.statusClass}
        onValueChange={(v) =>
          onChange({
            ...filters,
            statusClass: v as ErrorLogFilters["statusClass"],
          })
        }
      >
        <SelectTrigger className="h-9 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {t("superAdmin.errorLogs.filters.allStatus", "All status")}
          </SelectItem>
          <SelectItem value="zero">
            {t("superAdmin.errorLogs.filters.network", "Network / 0")}
          </SelectItem>
          <SelectItem value="4xx">4xx</SelectItem>
          <SelectItem value="5xx">5xx</SelectItem>
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={filters.from}
        max={filters.to || undefined}
        onChange={(e) => onChange({ ...filters, from: e.target.value })}
        className="h-9 w-[150px]"
        aria-label={t("superAdmin.errorLogs.filters.from", "From")}
      />
      <span className="text-muted-foreground text-sm">–</span>
      <Input
        type="date"
        value={filters.to}
        min={filters.from || undefined}
        onChange={(e) => onChange({ ...filters, to: e.target.value })}
        className="h-9 w-[150px]"
        aria-label={t("superAdmin.errorLogs.filters.to", "To")}
      />

      {isDirty && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          {t("superAdmin.errorLogs.filters.reset", "Reset")}
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-9 ml-auto"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
        {t("superAdmin.errorLogs.filters.refresh", "Refresh")}
      </Button>
    </div>
  );
}
