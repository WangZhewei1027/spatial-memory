"use client";

import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ASSET_INSPECTOR_PARAM, closeAssetInspector } from "../../lib/asset-inspector";
import { AssetDetailView } from "./AssetDetailRoute";

const query = "(min-width: 1024px)";
function subscribe(resize: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", resize);
  return () => media.removeEventListener("change", resize);
}
const desktopSnapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => true;

/** Independent island next to the library; narrow screens use the same single column in a sheet. */
export function AssetInspector() {
  const { t } = useTranslation();
  const assetId = useSearchParams().get(ASSET_INSPECTOR_PARAM);
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  if (!assetId) return null;
  const body = <div key={assetId} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"><AssetDetailView id={assetId} inspector /></div>;
  if (!desktop) return <Sheet open onOpenChange={(open) => { if (!open) closeAssetInspector(); }}>
    <SheetContent aria-describedby={undefined} closeLabel={t("common.close")} className="inset-2 h-auto w-auto gap-0 rounded-[var(--navigation-radius)] border-0 sm:max-w-none">
      <SheetHeader className="border-b pe-12"><SheetTitle>{t("assetInspector.title")}</SheetTitle></SheetHeader>
      {body}
    </SheetContent>
  </Sheet>;
  return <aside aria-label={t("assetInspector.title")} className="asset-inspector navigation-island flex min-h-0 w-80 shrink-0 flex-col overflow-hidden xl:w-96">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
      <Text as="h2" variant="bodyMd" fontWeight="semibold">{t("assetInspector.title")}</Text>
      <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={closeAssetInspector}><X className="size-4" aria-hidden /></Button>
    </div>
    {body}
  </aside>;
}
