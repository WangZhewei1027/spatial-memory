"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { LibraryLayout, type LibraryPagination } from "./LibraryLayout";
import { CollectionArchiveDialog } from "./CollectionArchiveDialog";
import { CollectionFormDialog } from "./CollectionFormDialog";
import { CollectionCard } from "./CollectionCard";
import { ContentEmptyState, ContentErrorState, ContentFailureNotice } from "./ContentFeedback";
import { LIBRARY_GRID, LibraryGridSkeleton } from "./LibraryCard";
import type { ContentActionFailure } from "./useContentAction";
import type { CollectionInput, CollectionItem, ContentAction, ContentLifecycle, ContentLoadStatus } from "./types";

export interface CollectionListProps {
  pagination: LibraryPagination;
  state: ContentLifecycle;
  onStateChange: (state: ContentLifecycle) => void;
  status: ContentLoadStatus;
  errorMessage?: string;
  onRetry?: () => void;
  collections: CollectionItem[];
  getHref: (collectionId: string) => string;
  /** Team-level write access for creating collections; per-card rights come from each item. */
  canCreate: boolean;
  readOnlyReason?: string;
  onCreate: ContentAction<[input: CollectionInput]>;
  onEdit: ContentAction<[collectionId: string, input: CollectionInput]>;
  onArchive: ContentAction<[collectionId: string]>;
  onRestore: ContentAction<[collectionId: string]>;
  notice?: ReactNode;
}

/** Map collections of the team. The first release has one collection type: maps. */
export function CollectionList(props: CollectionListProps) {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CollectionItem | null>(null);
  const [archiving, setArchiving] = useState<CollectionItem | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [failure, setFailure] = useState<ContentActionFailure | null>(null);
  const { status, collections, state } = props;

  const restore = async (collection: CollectionItem) => {
    setRestoring(collection.id);
    setFailure(null);
    try {
      const result = await props.onRestore(collection.id);
      if (result && !result.ok) setFailure(result);
    } catch (error) {
      setFailure({ ok: false, kind: "error", message: error instanceof Error ? error.message : undefined });
    } finally {
      setRestoring(null);
    }
  };
  const openForm = (collection: CollectionItem | null) => { setEditing(collection); setFormOpen(true); };

  return (
    <>
      <LibraryLayout
        title={t("contentModel.collections.title")}
        actions={props.canCreate && <Button onClick={() => openForm(null)}><Plus aria-hidden />{t("contentModel.collections.create")}</Button>}
        readOnlyReason={props.canCreate ? undefined : props.readOnlyReason}
        pagination={props.pagination}
        toolbar={<div className="flex items-center justify-between gap-2">
          <Text as="p" variant="bodySm" tone="subdued" aria-live="polite">
            {status === "ready" ? t("contentModel.collections.count", { count: collections.length }) : " "}
          </Text>
          <Select value={state} onValueChange={(value) => props.onStateChange(value as ContentLifecycle)}>
            <SelectTrigger aria-label={t("contentModel.workbench.stateLabel")} className="w-auto min-w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["active", "archived"] as const).map((value) => <SelectItem key={value} value={value}>{t(`contentModel.filter.states.${value}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>}
      >
        {props.notice}
        {failure && <ContentFailureNotice failure={failure} />}

        {status === "loading" ? (
          <LibraryGridSkeleton count={6} label={t("contentModel.state.loading")} />
        ) : status === "error" ? (
          <div className="my-auto">
            <ContentErrorState headingAs="h2" message={props.errorMessage} onRetry={props.onRetry} />
          </div>
        ) : collections.length === 0 ? (
          <div className="my-auto">
            {state === "archived" ? (
              <ContentEmptyState headingAs="h2" title={t("contentModel.collections.empty.archivedTitle")} description={t("contentModel.collections.empty.archivedBody")} />
            ) : (
              <ContentEmptyState
                headingAs="h2"
                title={t("contentModel.collections.empty.title")}
                description={t(props.canCreate ? "contentModel.collections.empty.body" : "contentModel.collections.empty.viewerBody")}
                actions={props.canCreate && <Button size="sm" onClick={() => openForm(null)}><Plus aria-hidden />{t("contentModel.collections.create")}</Button>}
              />
            )}
          </div>
        ) : (
          <ul className={LIBRARY_GRID} aria-label={t("contentModel.collections.title")}>
            {collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                href={props.getHref(collection.id)}
                onEdit={collection.canEdit && !collection.archived ? openForm : undefined}
                onArchive={collection.canArchive && !collection.archived ? setArchiving : undefined}
                onRestore={collection.canArchive && collection.archived ? restore : undefined}
                busy={restoring === collection.id}
              />
            ))}
          </ul>
        )}
      </LibraryLayout>

      <CollectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        collection={editing}
        onSubmit={(input) => (editing ? props.onEdit(editing.id, input) : props.onCreate(input))}
      />
      <CollectionArchiveDialog collection={archiving} onOpenChange={(open) => { if (!open) setArchiving(null); }} onArchive={props.onArchive} />
    </>
  );
}
