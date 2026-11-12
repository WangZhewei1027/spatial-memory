import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { APP_RELEASE } from "@/lib/errors/describe";
import { parseClientErrorReport } from "@/lib/errors/ingest";
import { symbolicateClientStack } from "@/lib/errors/source-maps.server";

/**
 * Client error sink. Captures uncaught errors / rejections / fetch failures
 * from the browser (including on logged-out pages), whitelists + truncates
 * fields, and writes scope='client' rows to error_log. Logs `user_id` when a
 * session exists, null otherwise. Always returns 200-ish so the reporter never
 * cascades into another error.
 *
 * Minified stacks from this build are mapped back to source positions into
 * `context.stack_original`; stacks from an older release stay as reported.
 *
 * NOTE: intentionally does not gate on auth so public-page crashes are still
 * captured; this trades a small spam surface for coverage. Add rate-limiting
 * here if abuse becomes a concern.
 */
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    const record = parseClientErrorReport(await request.json().catch(() => ({})), APP_RELEASE);

    const { stack } = record.context;
    if (typeof stack === "string" && record.context.release === APP_RELEASE) {
      const original = await symbolicateClientStack(stack).catch(() => null);
      if (original) record.context.stack_original = original;
    }

    await db
      .insertInto("error_log")
      .values({
        user_id: user?.id ?? null,
        scope: "client",
        method: record.method,
        path: record.path,
        status: record.status,
        message: record.message,
        context: JSON.stringify(record.context),
      })
      .execute();

    return NextResponse.json({ ok: true });
  } catch {
    // never let the error sink itself error out loudly
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
