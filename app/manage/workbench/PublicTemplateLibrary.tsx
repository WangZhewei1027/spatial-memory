"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import type { TemplateCard } from "@/lib/content-model/template-contracts";
import type { TemplateLibraryKind } from "../content/types";
import { ContentEmptyState, ContentErrorState } from "../content/ContentFeedback";
import { LIBRARY_GRID, LibraryGridSkeleton } from "../content/LibraryCard";
import { LibraryLayout } from "../content/LibraryLayout";
import { LibrarySearch } from "../content/WorkbenchToolbar";
import { newIdempotencyKey, templateApi } from "../lib/content-api";
import { teamCanWrite, teamHref, type TeamContext } from "../lib/content-context";
import { subscribeContentChanges } from "../lib/content-events";
import { ERROR_TEXTS, errorMessage } from "../lib/content-errors";
import { useIntegrationText } from "../lib/integration-text";
import { TemplateCover } from "./TemplateCover";
import { useLibraryPages, useLibrarySearch } from "./useLibraryPages";

type CopyState =
  | { status: "pending" | "failed"; key: string }
  | { status: "done"; id: string };

function PublicTemplateCard({ template, children }: { template: TemplateCard; children: ReactNode }) {
  const { t } = useTranslation();
  const name = template.name || t(`contentModel.library.${template.type}.untitled`);

  return (
    <li className="min-w-0 overflow-hidden rounded-lg border bg-background">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden border-b bg-muted"><TemplateCover template={template} name={name} /></div>
      <div className="space-y-2 p-2.5">
        <Text as="h2" variant="bodySm" fontWeight="medium" truncate title={name}>{name}</Text>
        {children}
      </div>
    </li>
  );
}

interface PublicTemplateLibraryProps {
  kind: TemplateLibraryKind;
  team: TeamContext;
  active: boolean;
  headingId: string;
  query: string;
  onQueryChange: (value: string) => void;
}

export function PublicTemplateLibrary({ kind, team, active, headingId, query, onQueryChange }: PublicTemplateLibraryProps) {
  const { t } = useTranslation();
  const tx = useIntegrationText(ERROR_TEXTS);
  const q = useLibrarySearch(query.trim());
  const load = useCallback((offset: number, limit: number, signal: AbortSignal) =>
    templateApi.list(kind, q, offset, limit, signal), [kind, q]);
  const list = useLibraryPages(active ? load : null);
  useEffect(() => active ? subscribeContentChanges(list.refresh) : undefined, [active, list.refresh]);
  const org = team.organization;
  const canCopy = org && !org.is_official_template_library && teamCanWrite({
    archivedAt: org.archived_at, orgRole: org.role, globalRole: team.currentUserRole,
  });
  // Keep the intent across searches and tab switches, including retries after a lost response.
  const [copies, setCopies] = useState<Record<string, CopyState>>({});

  async function copy(id: string) {
    const previous = copies[id];
    if (!canCopy || (previous && previous.status !== "failed")) return;
    const key = previous?.key ?? newIdempotencyKey();
    setCopies(current => ({ ...current, [id]: { status: "pending", key } }));
    try {
      const result = await templateApi.duplicate({
        sourceType: kind, sourceId: id, targetOrganizationId: org.id, idempotencyKey: key,
      });
      setCopies(current => ({ ...current, [id]: { status: "done", id: result.id } }));
      toast.success(t("contentModel.library.copiedTo", { team: org.name }));
    } catch (error) {
      setCopies(current => ({ ...current, [id]: { status: "failed", key } }));
      toast.error(errorMessage(error, tx));
    }
  }

  if (!active) return null;
  let results: ReactNode;
  if (list.status === "loading") {
    results = <LibraryGridSkeleton label={t("contentModel.state.loading")} />;
  } else if (list.status === "error") {
    results = <div className="my-auto"><ContentErrorState headingAs="h2" message={errorMessage(list.error, tx)} onRetry={list.reload} /></div>;
  } else if (!list.items.length) {
    results = <div className="my-auto">
      <ContentEmptyState headingAs="h2" title={t(q ? "contentModel.workbench.empty.filteredTitle" : `contentModel.library.${kind}.publicEmpty`)}
        actions={q && <Button size="sm" variant="outline" onClick={() => onQueryChange("")}>{t("contentModel.action.clearSearch")}</Button>} />
    </div>;
  } else {
    results = <ul className={LIBRARY_GRID} aria-label={t(`contentModel.library.${kind}.publicTab`)}>
      {list.items.map(template => {
        const state = copies[template.id];
        return <PublicTemplateCard key={template.id} template={template}>
          {state?.status === "done" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={kind === "scene"
                ? teamHref(`/manage/scenes/${state.id}`, team.organizationId)
                : teamHref("/manage/assets", team.organizationId, { assetId: state.id })}>
                {t("contentModel.library.openCopy")}
              </Link>
            </Button>
          ) : canCopy && (
            <Button size="sm" variant="outline" className="max-w-full px-2" disabled={state?.status === "pending"} onClick={() => void copy(template.id)}>
              <Copy aria-hidden />{t(state?.status === "pending" ? "contentModel.crossCopy.copying" : "contentModel.library.copyToTeam")}
            </Button>
          )}
        </PublicTemplateCard>;
      })}
    </ul>;
  }
  return (
    <LibraryLayout title={t(`contentModel.library.${kind}.title`)} headingId={headingId}
      toolbar={<div className="flex"><LibrarySearch value={query} onChange={onQueryChange} /></div>}
      pagination={{ ...list, moreError: list.moreError ? errorMessage(list.moreError, tx) : null }}>
      {results}
    </LibraryLayout>
  );
}
