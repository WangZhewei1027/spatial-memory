"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { SPECIAL_ASSET_FILE_TYPES, type AssetDto, type SceneSummaryDto } from "@/lib/content-model/contracts";
import { organizationApi } from "../../lib/content-api";
import { errorMessage } from "../../lib/content-errors";
import { contentType, excerptOf, thumbnailOf } from "../../lib/content-mappers";
import { usePlacementMap } from "./PlacementMapContext";
import { PlacementContentCard } from "./PlacementContentCard";
export type PickedSource = { kind: "asset"; asset: AssetDto } | { kind: "scene"; scene: SceneSummaryDto };

const SEARCH_DELAY_MS = 300;
const CATEGORIES = ["all", "model", "image", "video", "audio", "text", "link", "document", "scene"] as const;
type Category = (typeof CATEGORIES)[number];

type Loaded<T> = { key: string; items: T[]; error: string | null };

/**
 * Picker over the whole team: every active asset (search, current version)
 * or every saved scene. The same scene may be placed in many collections.
 */
export function SourcePicker({ value, onChange }: { value: PickedSource | null; onChange: (value: PickedSource | null) => void }) {
  const { tx, organizationId } = usePlacementMap();
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [assets, setAssets] = useState<Loaded<AssetDto> | null>(null);
  const [scenes, setScenes] = useState<Loaded<SceneSummaryDto> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const assetKey = `${organizationId}|${category}|${debounced}`;
  useEffect(() => {
    if (category === "scene") return;
    const abort = new AbortController();
    organizationApi
      .assets(organizationId, { view: "all", q: debounced || undefined, file_type: category === "all" ? undefined : category, limit: 20, state: "active" }, abort.signal)
      .then((page) => !abort.signal.aborted && setAssets({ key: assetKey, items: (page.data ?? []).filter((asset) => !SPECIAL_ASSET_FILE_TYPES.includes(asset.file_type)), error: null }))
      .catch((error) => !abort.signal.aborted && setAssets({ key: assetKey, items: [], error: errorMessage(error, tx) }));
    return () => abort.abort();
  }, [organizationId, category, debounced, assetKey, tx]);

  useEffect(() => {
    const abort = new AbortController();
    organizationApi
      .scenes(organizationId, { state: "active" }, abort.signal)
      .then((list) => !abort.signal.aborted && setScenes({ key: organizationId, items: list.items, error: null }))
      .catch((error) => !abort.signal.aborted && setScenes({ key: organizationId, items: [], error: errorMessage(error, tx) }));
    return () => abort.abort();
  }, [organizationId, tx]);

  const includeAssets = category !== "scene", includeScenes = category === "all" || category === "scene";
  const currentAssets = assets?.key === assetKey ? assets : null;
  const currentScenes = scenes?.key === organizationId ? scenes : null;
  const loading = (includeAssets && !currentAssets) || (includeScenes && !currentScenes);
  const error = (includeAssets && currentAssets?.error) || (includeScenes && currentScenes?.error);
  const sources: PickedSource[] = [
    ...(includeAssets ? (currentAssets?.items ?? []).map((asset): PickedSource => ({ kind: "asset", asset })) : []),
    ...(includeScenes ? (currentScenes?.items ?? []).filter((scene) => scene.name.toLocaleLowerCase().includes(debounced.toLocaleLowerCase())).map((scene): PickedSource => ({ kind: "scene", scene })) : []),
  ];
  sources.sort((a, b) => (b.kind === "asset" ? b.asset.updated_at : b.scene.updated_at).localeCompare(a.kind === "asset" ? a.asset.updated_at : a.scene.updated_at));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-1" data-source-toolbar>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx("contentModel.integration.map.create.searchContent")} aria-label={tx("contentModel.integration.map.create.searchContent")} className="ps-8" />
        </div>
        <Select value={category} onValueChange={(next) => setCategory(next as Category)}>
          <SelectTrigger className="w-28 shrink-0 sm:w-32" aria-label={tx("contentModel.integration.map.create.category")}><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORIES.map((option) => <SelectItem key={option} value={option}>{tx(option === "all" ? "contentModel.integration.map.create.allCategories" : `contentModel.integration.map.type.${option}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 [scrollbar-gutter:stable]" data-source-results aria-busy={loading}>
        {loading ? <Text as="p" variant="bodySm" tone="subdued" role="status" className="py-8" alignment="center">{tx("contentModel.integration.map.create.loadingContent")}</Text> : <>
          {error && <Text as="p" variant="bodySm" tone="critical" role="alert" className="py-3">{error}</Text>}
          {!error && sources.length === 0 && <Text as="p" variant="bodySm" tone="subdued" role="status" className="py-8" alignment="center">{tx("contentModel.integration.map.create.noContent")}</Text>}
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={tx("contentModel.integration.map.create.chooseContent")}>
            {sources.map((source) => {
              if (source.kind === "asset") {
                const { asset } = source;
                const name = asset.name || asset.id.slice(0, 8);
                return <PlacementContentCard key={`asset:${asset.id}`} selected={value?.kind === "asset" && value.asset.id === asset.id} onClick={() => onChange(source)}
                  name={name} contentType={contentType(asset.file_type)} typeLabel={tx(`contentModel.integration.map.type.${asset.file_type}`)} thumbnailUrl={thumbnailOf(asset)} textExcerpt={excerptOf(asset)} />;
              }
              const { scene } = source;
              return <PlacementContentCard key={`scene:${scene.id}`} selected={value?.kind === "scene" && value.scene.id === scene.id} onClick={() => onChange(source)}
                name={scene.name} contentType="scene" typeLabel={tx("contentModel.integration.map.type.scene")} />;
            })}
          </div>
        </>}
      </div>
    </div>
  );
}
