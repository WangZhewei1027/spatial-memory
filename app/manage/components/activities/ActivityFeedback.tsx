"use client";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ContentNotice } from "../../content/ContentFeedback";
import { isLockConflict } from "../../lib/content-api";

export function ActivityFailure({ error, onReload }: { error: unknown; onReload?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const conflict = isLockConflict(error);
  return <ContentNotice tone={conflict ? "warning" : "critical"} title={t(conflict ? "activities.conflict" : "activities.failed")} description={error instanceof Error ? error.message : t("activities.failedHint")} action={conflict && onReload ? <Button type="button" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal" onClick={onReload}>{t("activities.reload")}</Button> : undefined} />;
}
