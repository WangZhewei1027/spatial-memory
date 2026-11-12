"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/client-report";
import { describeError } from "@/lib/errors/describe";

/**
 * Root error boundary — catches render crashes that bubble past all segment
 * boundaries (replaces the whole document when it renders). Reports to
 * /api/errors, then offers a reload.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // A server render failure arrives with only its digest; the matching
    // scope='server' row carries the original message and stack.
    const { message, ...details } = describeError(error);
    reportClientError({
      method: "react.global-error",
      status: 500,
      message: message || "render crash",
      context: details,
    });
  }, [error]);

  return (
    <html lang="zh">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            页面出错了
          </h1>
          <p style={{ color: "#666", marginBottom: "1.25rem" }}>
            我们已记录该错误，请重试。
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "8px",
              border: "1px solid #ccc",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
