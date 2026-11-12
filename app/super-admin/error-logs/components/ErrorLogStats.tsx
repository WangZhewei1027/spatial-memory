"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ErrorLogStats } from "../types";

interface Props {
  total: number;
  stats: ErrorLogStats;
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "default" | "warn" | "danger";
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "warn" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

// Minimal inline bar sparkline for the daily error trend.
function DailyTrend({ daily }: { daily: ErrorLogStats["daily"] }) {
  const { t } = useTranslation();
  if (daily.length === 0) return null;
  const max = Math.max(...daily.map((d) => d.count), 1);

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground mb-2">
        {t("superAdmin.errorLogs.stats.dailyTrend", "Daily trend")}
      </div>
      <div className="flex items-end gap-1 h-16">
        {daily.map((d) => (
          <div
            key={d.day}
            className="flex-1 min-w-[3px] rounded-sm bg-primary/70 hover:bg-primary transition-colors"
            style={{ height: `${Math.max((d.count / max) * 100, 4)}%` }}
            title={`${d.day}: ${d.count}`}
          />
        ))}
      </div>
    </div>
  );
}

function TopPaths({ paths }: { paths: ErrorLogStats["topPaths"] }) {
  const { t } = useTranslation();
  if (paths.length === 0) return null;
  const max = Math.max(...paths.map((p) => p.count), 1);

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground mb-2">
        {t("superAdmin.errorLogs.stats.topPaths", "Top paths")}
      </div>
      <div className="space-y-1.5">
        {paths.map((p) => (
          <div key={p.path} className="flex items-center gap-2 text-xs">
            <span
              className="font-mono truncate max-w-[55%] shrink-0"
              title={p.path}
            >
              {p.path}
            </span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${(p.count / max) * 100}%` }}
              />
            </div>
            <span className="tabular-nums text-muted-foreground w-8 text-right">
              {p.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorLogStatsPanel({ total, stats }: Props) {
  const { t } = useTranslation();
  const sc = stats.byStatusClass;

  return (
    <div className="space-y-3 mb-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatTile
          label={t("superAdmin.errorLogs.stats.total", "Total")}
          value={total}
        />
        <StatTile
          label={t("superAdmin.errorLogs.stats.client", "Client")}
          value={stats.byScope.client ?? 0}
        />
        <StatTile
          label={t("superAdmin.errorLogs.stats.api", "API")}
          value={stats.byScope.api ?? 0}
        />
        <StatTile
          label={t("superAdmin.errorLogs.stats.server", "Server")}
          value={stats.byScope.server ?? 0}
        />
        <StatTile
          label={t("superAdmin.errorLogs.stats.client4xx", "4xx")}
          value={sc["4xx"]}
          tone="warn"
        />
        <StatTile
          label={t("superAdmin.errorLogs.stats.client5xx", "5xx")}
          value={sc["5xx"]}
          tone="danger"
        />
        <StatTile
          label={t("superAdmin.errorLogs.stats.network", "Network / 0")}
          value={sc.zero}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TopPaths paths={stats.topPaths} />
        <DailyTrend daily={stats.daily} />
      </div>
    </div>
  );
}
