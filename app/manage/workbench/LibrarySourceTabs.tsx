"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Text } from "@/components/ui/typography";
import { ASSET_INSPECTOR_PARAM } from "../lib/asset-inspector";
import type { TemplateLibraryKind } from "../content/types";
import type { TeamContext } from "../lib/content-context";
import { PublicSceneStrip } from "./PublicSceneStrip";
import { PublicTemplateLibrary } from "./PublicTemplateLibrary";
import { WorkbenchRoute } from "./WorkbenchRoute";

export function LibrarySourceTabs({ kind, team, teamState }: { kind: TemplateLibraryKind; team: TeamContext; teamState: ReactNode }) {
  const { t } = useTranslation();
  const headingId = useId();
  const publicTab = useSearchParams().get("tab") === "public";
  const publicTrigger = useRef<HTMLButtonElement>(null);
  const [publicQuery, setPublicQuery] = useState("");
  const title = t(`contentModel.library.${kind}.title`);

  function selectTab(value: string) {
    const url = new URL(window.location.href);
    if (value === (url.searchParams.get("tab") === "public" ? "public" : "team")) return;
    if (value === "public") url.searchParams.set("tab", "public");
    else url.searchParams.delete("tab");
    if (kind === "asset") url.searchParams.delete(ASSET_INSPECTOR_PARAM);
    window.history.pushState(null, "", url);
  }

  function browsePublicScenes() {
    setPublicQuery("");
    selectTab("public");
    publicTrigger.current?.focus({ preventScroll: true });
  }

  return (
    <Tabs value={publicTab ? "public" : "team"} onValueChange={selectTab} className="min-h-0 flex-1 gap-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 pt-3 sm:px-4 sm:pt-4 lg:px-5 lg:pt-5">
        <Text as="h1" id={headingId} variant="headingLg">{title}</Text>
        <TabsList aria-labelledby={headingId}>
          <TabsTrigger value="team">{t("contentModel.library.teamTab")}</TabsTrigger>
          <TabsTrigger ref={publicTrigger} value="public">{t(`contentModel.library.${kind}.publicTab`)}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="team" forceMount className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        {kind === "scene" && !publicTab && <PublicSceneStrip onBrowse={browsePublicScenes} />}
        {teamState ? <div className="p-3 sm:p-4 lg:p-5">{teamState}</div> : <WorkbenchRoute kind={kind} team={team} active={!publicTab} headingId={headingId} />}
      </TabsContent>
      <TabsContent value="public" forceMount className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <PublicTemplateLibrary kind={kind} team={team} active={publicTab} headingId={headingId} query={publicQuery} onQueryChange={setPublicQuery} />
      </TabsContent>
    </Tabs>
  );
}
