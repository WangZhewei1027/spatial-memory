export type ErrorScope = "client" | "api" | "server" | "unknown";
export type StatusClass = "zero" | "4xx" | "5xx";

export interface ErrorLogRow {
  id: string;
  created_at: string;
  user_id: string | null;
  scope: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  message: string | null;
  context: Record<string, unknown> | null;
}

export interface ErrorLogStats {
  byScope: Record<string, number>;
  byStatusClass: {
    zero: number;
    "4xx": number;
    "5xx": number;
    other: number;
  };
  topPaths: { path: string; count: number }[];
  daily: { day: string; count: number }[];
}

export interface ErrorLogResponse {
  total: number;
  rows: ErrorLogRow[];
  stats: ErrorLogStats;
}

export interface ErrorLogFilters {
  scope: "all" | "client" | "api" | "server";
  statusClass: "all" | StatusClass;
  q: string;
  from: string; // yyyy-mm-dd or ""
  to: string; // yyyy-mm-dd or ""
}
