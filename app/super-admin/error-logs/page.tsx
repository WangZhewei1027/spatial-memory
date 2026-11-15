"use client";

import { useTranslation } from "react-i18next";
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorLogFiltersBar } from "./components/ErrorLogFilters";
import { ErrorLogStatsPanel } from "./components/ErrorLogStats";
import { ErrorLogTable } from "./components/ErrorLogTable";
import { useErrorLogs } from "./hooks/useErrorLogs";
import { Text } from "@/components/ui/typography";

export default function ErrorLogsPage() {
  const { t } = useTranslation();
  const {
    filters,
    setFilters,
    page,
    setPage,
    pageSize,
    data,
    loading,
    error,
    refetch,
  } = useErrorLogs();

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min((page + 1) * pageSize, total);

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <AlertTriangle className="h-6 w-6" />
        <div>
          <Text as="h1" variant="headingMd" fontWeight="bold">
            {t("superAdmin.errorLogs.title", "Error Logs")}
          </Text>
          <p className="text-sm text-muted-foreground">
            {t(
              "superAdmin.errorLogs.description",
              "Analyze and filter client, API and server errors",
            )}
          </p>
        </div>
      </div>

      <ErrorLogFiltersBar
        filters={filters}
        onChange={setFilters}
        onRefresh={refetch}
        loading={loading}
      />

      {error ? (
        <div className="flex flex-col items-center justify-center text-center rounded-lg border border-dashed py-16">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <Text as="h3" variant="bodySm" fontWeight="medium">
            {t("superAdmin.errorLogs.loadError", "Failed to load error logs")}
          </Text>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={refetch}
          >
            {t("superAdmin.errorLogs.filters.refresh", "Refresh")}
          </Button>
        </div>
      ) : loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <>
          <ErrorLogStatsPanel total={data.total} stats={data.stats} />
          <ErrorLogTable rows={data.rows} />

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("superAdmin.errorLogs.pagination.range", {
                start: rangeStart,
                end: rangeEnd,
                total,
                defaultValue: "{{start}}–{{end}} of {{total}}",
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page === 0 || loading}
                onClick={() => setPage(Math.max(0, page - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("superAdmin.errorLogs.pagination.prev", "Prev")}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page + 1 >= totalPages || loading}
                onClick={() => setPage(page + 1)}
              >
                {t("superAdmin.errorLogs.pagination.next", "Next")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
