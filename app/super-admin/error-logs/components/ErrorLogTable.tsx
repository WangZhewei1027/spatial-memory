"use client";

import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ErrorLogRow } from "../types";
import { Text } from "@/components/ui/typography";

interface Props {
  rows: ErrorLogRow[];
}

function statusVariant(status: number | null): {
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
} {
  if (status == null) return { variant: "outline" };
  if (status === 0) return { variant: "secondary" };
  if (status >= 500) return { variant: "destructive" };
  if (status >= 400)
    return {
      variant: "outline",
      className: "border-warning/50 text-warning",
    };
  return { variant: "secondary" };
}

function ScopeBadge({ scope }: { scope: string | null }) {
  const { t } = useTranslation();
  if (scope === "client")
    return (
      <Badge variant="outline" className="font-normal">
        {t("superAdmin.errorLogs.scope.client", "Client")}
      </Badge>
    );
  if (scope === "api")
    return (
      <Badge variant="secondary" className="font-normal">
        {t("superAdmin.errorLogs.scope.api", "API")}
      </Badge>
    );
  if (scope === "server")
    return (
      <Badge variant="secondary" className="font-normal">
        {t("superAdmin.errorLogs.scope.server", "Server")}
      </Badge>
    );
  return <span className="text-xs text-muted-foreground">{scope || "—"}</span>;
}

const PRE_CLASS =
  "text-xs bg-background border rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-words max-h-64";

function DetailBlock({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <pre className={PRE_CLASS}>{children}</pre>
    </div>
  );
}

/** Stacks read line by line; the rest of the context stays as JSON. */
function splitContext(context: ErrorLogRow["context"]) {
  if (!context) return { rest: null };
  const { stack, stack_original: stackOriginal, ...rest } = context;
  return {
    stack: typeof stack === "string" ? stack : undefined,
    stackOriginal: typeof stackOriginal === "string" ? stackOriginal : undefined,
    rest: {
      ...rest,
      ...(stack !== undefined && typeof stack !== "string" ? { stack } : {}),
      ...(stackOriginal !== undefined && typeof stackOriginal !== "string" ? { stack_original: stackOriginal } : {}),
    },
  };
}

function Row({ row }: { row: ErrorLogRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sv = statusVariant(row.status);
  const { stack, stackOriginal, rest } = splitContext(row.context);
  const hasDetail =
    (row.message && row.message.length > 80) ||
    row.context != null ||
    row.user_id;

  return (
    <Fragment>
      <tr
        className={cn(
          "border-b last:border-0 transition-colors align-top",
          hasDetail && "cursor-pointer hover:bg-muted/30",
        )}
        onClick={() => hasDetail && setOpen((o) => !o)}
      >
        <td className="px-2 py-2.5 w-6">
          {hasDetail && (
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          )}
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
          <span title={new Date(row.created_at).toLocaleString()}>
            {new Date(row.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <ScopeBadge scope={row.scope} />
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <Badge
            variant={sv.variant}
            className={cn("font-normal", sv.className)}
          >
            {row.status ?? "—"}
          </Badge>
        </td>
        <td className="px-3 py-2.5 hidden md:table-cell">
          <span
            className="font-mono text-xs truncate block max-w-[220px]"
            title={row.path || undefined}
          >
            {row.path || "—"}
          </span>
          {row.method && (
            <span className="text-xs text-muted-foreground">
              {row.method}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <span className="text-xs line-clamp-2 max-w-[420px]">
            {row.message || "—"}
          </span>
        </td>
      </tr>
      {open && hasDetail && (
        <tr className="border-b last:border-0 bg-muted/20">
          <td />
          <td colSpan={5} className="px-3 py-3 space-y-3">
            {row.user_id && (
              <div className="text-xs">
                <span className="text-muted-foreground">
                  {t("superAdmin.errorLogs.detail.userId", "User ID")}:{" "}
                </span>
                <span className="font-mono">{row.user_id}</span>
              </div>
            )}
            {row.message && (
              <DetailBlock label={t("superAdmin.errorLogs.detail.message", "Message")}>
                {row.message}
              </DetailBlock>
            )}
            {stackOriginal && (
              <DetailBlock label={t("superAdmin.errorLogs.detail.stackOriginal", "Source stack")}>
                {stackOriginal}
              </DetailBlock>
            )}
            {stack && (
              <DetailBlock label={t("superAdmin.errorLogs.detail.stack", "Reported stack")}>
                {stack}
              </DetailBlock>
            )}
            {rest && Object.keys(rest).length > 0 && (
              <DetailBlock label={t("superAdmin.errorLogs.detail.context", "Context")}>
                {JSON.stringify(rest, null, 2)}
              </DetailBlock>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function ErrorLogTable({ rows }: Props) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center rounded-lg border border-dashed py-16">
        <AlertCircle className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <Text as="h3" variant="bodySm" fontWeight="medium">
          {t("superAdmin.errorLogs.empty", "No error logs")}
        </Text>
        <p className="text-xs text-muted-foreground mt-1">
          {t("superAdmin.errorLogs.emptyHint", "No records match your filters")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="w-6 px-2 py-2.5" />
              <th className="text-left font-medium px-3 py-2.5">
                {t("superAdmin.errorLogs.columns.time", "Time")}
              </th>
              <th className="text-left font-medium px-3 py-2.5">
                {t("superAdmin.errorLogs.columns.scope", "Scope")}
              </th>
              <th className="text-left font-medium px-3 py-2.5">
                {t("superAdmin.errorLogs.columns.status", "Status")}
              </th>
              <th className="text-left font-medium px-3 py-2.5 hidden md:table-cell">
                {t("superAdmin.errorLogs.columns.path", "Path")}
              </th>
              <th className="text-left font-medium px-3 py-2.5">
                {t("superAdmin.errorLogs.columns.message", "Message")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
