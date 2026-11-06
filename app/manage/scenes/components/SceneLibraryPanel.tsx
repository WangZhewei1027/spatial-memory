"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { LayoutGrid, List, LoaderCircle, Search, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PERFORMANCE_KINDS, isPerformanceKind, resourceFromAsset } from "./scene-performance";
import { newIdempotencyKey, organizationApi } from "../../lib/content-api";
import { errorMessage } from "../../lib/content-errors";
import { acceptFor, prepareFile, uploadAssetFiles } from "../../lib/content-upload";
import { useUploadStageText } from "../../lib/upload-stage-text";
import type { UploadStage } from "@/lib/upload/progress";
import { inferUploadType } from "@/lib/upload/detection";
import { useIntegrationText } from "../../lib/integration-text";
import type { SceneResource } from "./types";
import { SCENE_LIBRARY_TEXTS } from "./scene-library-texts";
import { LIBRARY_SECTIONS, type LibraryLayout, type LibrarySection } from "./scene-library";
import { useSceneLibraryCatalog } from "./useSceneLibraryCatalog";
import { SceneLibraryList } from "./SceneLibraryList";
import { SceneTextLibrary } from "./SceneTextLibrary";

export function SceneLibraryPanel({ organizationId, canAdd, canUpload, onRegister, onAdd, onAddText }: {
  organizationId: string | null;
  canAdd: boolean; canUpload: boolean;
  /** Register before dragging; the existing stage/timeline protocol carries only the asset ID. */
  onRegister: (resource: SceneResource) => void;
  onAdd: (resource: SceneResource) => void;
  onAddText: () => void;
}) {
  const tx = useIntegrationText(SCENE_LIBRARY_TEXTS);
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const [section, setSection] = useState<LibrarySection>("all");
  const [layoutChoice, setLayoutChoice] = useState<LibraryLayout | null>(null);
  const layout = layoutChoice ?? (section === "audio" ? "list" : "grid");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [imported, setImported] = useState("");
  const [stage, setStage] = useState<UploadStage | null>(null);
  const stageText = useUploadStageText();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadKey = useRef<{ file: File; key: string } | null>(null);
  const mounted = useRef(true);
  const currentOrganization = useRef(organizationId); currentOrganization.current = organizationId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const isText = section === "text";
  const catalog = useSceneLibraryCatalog({ organizationId, enabled: !isText, kind: isText ? "all" : section, search, refreshKey });
  const pendingSearch = query.trim() !== search;
  const loading = catalog.loading || pendingSearch;
  const entries = pendingSearch ? [] : catalog.items;

  const upload = async (file: File) => {
    if (!organizationId || !canUpload || stage) return;
    setStage("preparing"); setUploadError(""); setImported("");
    try {
      if (uploadKey.current?.file !== file) uploadKey.current = { file, key: newIdempotencyKey() };
      const type = inferUploadType(file.type, file.name);
      if (!isPerformanceKind(type)) throw new Error(text("支持 GLB、图片、音频和视频文件。", "Choose a GLB, image, audio or video file."));
      const prepared = await prepareFile(file, type);
      const version = await uploadAssetFiles(prepared, { organizationId }, undefined, next => { if (mounted.current) setStage(next); });
      if (mounted.current) setStage("creating");
      const created = await organizationApi.createAsset(organizationId, { name: file.name.replace(/\.[^.]+$/, ""), fileType: type, payload: version.payload, resources: version.resources, idempotencyKey: uploadKey.current.key });
      uploadKey.current = null;
      if (!mounted.current || currentOrganization.current !== organizationId) return;
      const resource = resourceFromAsset(created.asset);
      if (resource) onRegister(resource);
      // Import fills the team bin. Only + / double-click / drop insert into the scene.
      setSection(type); setQuery(""); setSearch(""); setRefreshKey(value => value + 1);
      setImported(created.asset.name || file.name);
    } catch (cause) { if (mounted.current) setUploadError(errorMessage(cause, tx)); }
    finally { if (mounted.current) { setStage(null); if (fileInput.current) fileInput.current.value = ""; } }
  };
  const searchLabel = tx("contentModel.integration.sceneLibrary.search");
  const empty = !loading && !entries.length && !catalog.error && !catalog.hasMore;

  return <section className="scene-library" aria-label={tx("contentModel.integration.sceneLibrary.label")}>
    <div className="scene-library-categories" role="group" aria-label={text("内容类型", "Content type")}>
      {LIBRARY_SECTIONS.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}><Icon aria-hidden="true" /><span>{text(label[0], label[1])}</span></button>)}
    </div>
      <div className="scene-library-browser">
        {!isText && <div className="scene-library-toolbar">
          {canUpload && organizationId && <Button variant="outline" size="sm" className="scene-library-import" title={text("导入到团队素材库", "Import into the team library")} disabled={!!stage} onClick={() => fileInput.current?.click()}>{stage ? <LoaderCircle className="animate-spin" /> : <Upload />}{text("导入", "Import")}</Button>}
          <div className="scene-library-view" role="group" aria-label={text("显示方式", "View mode")}>{(["grid", "list"] as const).map(value => { const Icon = value === "grid" ? LayoutGrid : List; const label = value === "grid" ? text("网格视图", "Grid view") : text("列表视图", "List view"); return <Button type="button" key={value} variant="ghost" size="icon" aria-pressed={layout === value} aria-label={label} title={label} onClick={() => setLayoutChoice(value)}><Icon /></Button>; })}</div>
        </div>}
        {!isText && <div className="scene-library-search"><Search aria-hidden="true" /><Input value={query} onChange={event => setQuery(event.target.value)} aria-label={searchLabel} placeholder={searchLabel} />{query && <button type="button" aria-label={text("清除搜索", "Clear search")} onClick={() => setQuery("")}><X /></button>}</div>}
        <input ref={fileInput} type="file" hidden accept={(isText || section === "all" ? PERFORMANCE_KINDS : [section]).map(acceptFor).filter(Boolean).join(",")} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        {stage && <div className="scene-library-notice" role="status"><LoaderCircle className="animate-spin" /><Text as="span" variant="bodyXs">{stageText(stage)}</Text></div>}
        {uploadError && <div className="scene-library-notice" role="alert"><Text as="p" variant="bodyXs" tone="critical">{uploadError}</Text><button type="button" aria-label={text("关闭提示", "Dismiss message")} onClick={() => setUploadError("")}><X /></button></div>}
        {imported && <div className="scene-library-notice" role="status"><Text as="p" variant="bodyXs" truncate title={imported}>{text("已导入", "Imported")}: {imported}</Text><button type="button" aria-label={text("关闭提示", "Dismiss message")} onClick={() => setImported("")}><X /></button></div>}
        <div className="scene-library-scroll" key={section}>
          {isText ? <SceneTextLibrary canAdd={canAdd} onAdd={onAddText} /> : <>
            <SceneLibraryList layout={layout} entries={entries} canAdd={canAdd} loading={loading} onRegister={onRegister} onAdd={onAdd} />
            {empty && <div className="scene-library-empty"><Text as="p" variant="bodyXs" tone="subdued">{tx(query.trim() ? "contentModel.integration.sceneLibrary.noResults" : "contentModel.integration.sceneLibrary.emptyTeam")}</Text>{query.trim() ? <Button variant="outline" size="sm" onClick={() => setQuery("")}>{text("清除搜索", "Clear search")}</Button> : canUpload && organizationId ? <Button variant="outline" size="sm" disabled={!!stage} onClick={() => fileInput.current?.click()}><Upload />{text("导入素材", "Import asset")}</Button> : null}</div>}
            {!pendingSearch && catalog.error != null && <div className="scene-library-empty" role="alert"><Text as="p" variant="bodyXs" tone="critical">{errorMessage(catalog.error, tx)}</Text><Button variant="outline" size="sm" onClick={catalog.retry}>{tx("contentModel.integration.sceneLibrary.retry")}</Button></div>}
            {catalog.hasMore && catalog.error == null && !pendingSearch && <Button variant="ghost" size="sm" className="scene-library-more" disabled={catalog.loadingMore} onClick={catalog.loadMore}>{catalog.loadingMore && <LoaderCircle className="animate-spin" />}{tx("contentModel.integration.sceneLibrary.loadMore")}</Button>}
          </>}
        </div>
      </div>
  </section>;
}
