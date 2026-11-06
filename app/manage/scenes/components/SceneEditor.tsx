"use client";
import { SceneQrButton } from "@/components/scene-qr-button";
import { ContentNotice } from "@/app/manage/content/ContentFeedback";
import { Button } from "@/components/ui/button";
import { NavigationIsland } from "@/components/ui/navigation-island";
import { Text } from "@/components/ui/typography";
import type { SceneDetailDto } from "@/lib/content-model/contracts";
import type { PlacementReader, ScenePosition } from "@/lib/scene/editor-interactions";
import { type CompositionInstance } from "@/lib/scene/protocol";
import { findNode, isGroup, type SceneNode } from "@/lib/scene/hierarchy-authoring";
import { hiddenNodeIds } from "@/lib/scene/visibility";
import { editTransform } from "@/lib/scene/transform-authoring";
import { copyTracks, pasteTracks, type TrackClipboard } from "./scene-clipboard";
import { X } from "lucide-react";
import { Component, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { teamHref } from "../../lib/content-context";
import { addModelInstance, replaceInstanceAsset, type AssetReplaceFailure, type ModelAddFailure } from "./scene-add-model";
import { insertionTiming } from "./scene-performance";
import { SceneConflictBanner } from "./SceneConflictBanner";
import { SceneInstancePanel } from "./SceneInstancePanel";
import { SceneTimeline } from "./SceneTimeline";
import { SceneSidebar } from "./SceneSidebar";
import { useSceneTracks } from "./useSceneTracks";
import { useSceneEditorShortcuts } from "./useSceneEditorShortcuts";
import { ScenePanelDivider } from "./ScenePanelDivider";
import { useScenePanelSize } from "./useScenePanelSize";
import { useSceneWorkspace } from "./useSceneWorkspace";
import { SceneLibraryPanel } from "./SceneLibraryPanel";
import { SceneModelDropZone } from "./SceneModelDropZone";
import { SceneToolbar } from "./SceneToolbar";
import { SceneViewport } from "./SceneViewport";
import { SceneCameraPreview } from "./SceneCameraPreview";
import { sceneCameraSettings, sceneViewerPosition, type SceneCameraSettings } from "./three-editor/spatial-reference";
import type { SceneResource } from "./types";
import { useSceneDocument } from "./useSceneDocument";
import "./scene-editor.css";

class ViewportBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export default function SceneEditor({ sceneId, initial, organizationId }: { sceneId: string; initial?: SceneDetailDto | null; organizationId: string | null }) {
  const { t, i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const editor = useSceneDocument(sceneId, initial);
  const { session, document, clips, time, playing, commit, resolve, resources, detail, readOnly } = editor;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds.at(-1) ?? null;
  const [preview, setPreview] = useState(false);
  const [grid, setGrid] = useState(true);
  const [labels, setLabels] = useState(true);
  const [cameraLens, setCameraLens] = useState({ pitch: 0, fov: 60 });
  const [headerElement, setHeaderElement] = useState<HTMLDivElement | null>(null);
  const nativeToolsRef = useRef<HTMLDivElement>(null);
  const shadingRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<PlacementReader | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const originRef = useRef<(() => void) | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const compact = useSceneWorkspace();
  const library = useScenePanelSize("library", compact);
  const panelOpen = !library.collapsed;
  const selectedNode = document && selectedId ? findNode(document.definition.content, selectedId) : undefined;
  const instance = selectedNode && !isGroup(selectedNode) ? selectedNode : undefined;
  const tracks = useSceneTracks(editor, selectedIds, setSelectedIds, text);
  const selectTracks = (ids: string[]) => {
    setSelectedIds(ids);
    if (ids.length && compact && panelOpen) library.close();
  };
  const nameOf = (node: SceneNode) => node.name ?? (isGroup(node) ? node.id : node.text ? node.text.content.slice(0, 40) : resolve(document?.definition.content.assets[node.asset ?? ""])?.name ?? node.asset ?? node.id);
  const paste = (snapshot: TrackClipboard) => {
    if (readOnly || playing) return;
    let ids: string[] = [];
    const applied = commit(current => {
      const result = pasteTracks(current.definition, snapshot, text("副本", "copy"));
      ids = result.selected;
      return { ...current, definition: result.definition };
    });
    if (applied) selectTracks(ids);
  };
  useSceneEditorShortcuts(editor, {
    copy: () => document && copyTracks(document.definition.content, selectedIds, nameOf),
    paste, remove: () => tracks.remove(selectedIds), hasSelection: !!selectedNode || selectedIds.length > 1,
  });
  if (!session || !document) return <main className="scene-workspace-theme scene-editor-status fixed inset-0 z-50 flex items-center justify-center bg-background"><div className="max-w-lg space-y-4 p-6"><Text as="h1" variant="headingMd">{t("sceneEditor.heading")}</Text><Text as="p" variant="bodyMd" tone={editor.error ? "critical" : "subdued"}>{editor.error || t("sceneEditor.loading")}</Text>{editor.error && <Button onClick={editor.retry}>{t("sceneEditor.retry")}</Button>}</div></main>;
  const { instances, groups, assets, loop } = document.definition.content;
  const cameraSettings = sceneCameraSettings(document.definition.content.viewerPosition, cameraLens);
  const changeCamera = (next: SceneCameraSettings) => {
    setCameraLens({ pitch: next.pitch, fov: next.fov });
    if (readOnly || playing || (next.distance === cameraSettings.distance && next.height === cameraSettings.height && next.yaw === cameraSettings.yaw)) return;
    const viewerPosition = sceneViewerPosition(next);
    commit(current => ({ ...current, definition: { ...current.definition, content: { ...current.definition.content, viewerPosition } } }));
  };
  const duration = document.definition.content.durationSeconds ?? 10;
  const sceneOrganizationId = detail?.organization_id ?? organizationId;
  const canAdd = !readOnly && !playing;
  const resourceOf = (item: CompositionInstance) => item.asset ? resolve(assets[item.asset]) : undefined;
  const select = (id: string | null) => selectTracks(id ? [id] : []);
  const kindOf = (node: SceneNode) => isGroup(node) ? "group" as const : node.text ? "text" as const : resourceOf(node)?.kind ?? "model";
  const addAsset = (key: string, position: ScenePosition = [0, 0, 0], picked?: SceneResource, at = time) => {
    if (!canAdd) return;
    const resource = picked ?? resources[key];
    const id = `object_${crypto.randomUUID().slice(0, 8)}`;
    const outcome: { added?: boolean; failure?: ModelAddFailure } = {};
    const applied = commit(current => {
      const result = addModelInstance(current.definition.content, { key, resource, id, position, startSeconds: at });
      if (!result.ok) { outcome.failure = result.reason; return current; }
      const timing = insertionTiming(at, current.definition.content.durationSeconds ?? 10, resource?.durationSeconds);
      result.content = { ...result.content, durationSeconds: Math.max(current.definition.content.durationSeconds ?? 10, timing.endSeconds), instances: result.content.instances.map(item => item.id === id ? { ...item, timing, ...(resource?.kind === "audio" || resource?.kind === "video" ? { media: { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: 1, loop: false, muted: false } } : {}) } : item) };
      outcome.added = true;
      return { ...current, definition: { ...current.definition, content: result.content } };
    });
    if (outcome.failure) editor.setError(text("素材不可用，请刷新素材库后重试。", "This asset is unavailable. Refresh the library and try again."));
    if (applied && outcome.added) {
      if (picked) editor.registerResource(picked);
      if (resource?.kind === "model" && resource.animations === undefined) editor.awaitInitialClip(id, resource.assetId);
      select(id);
    }
  };
  /** Swaps the selected track's file for another asset of the same kind; the track itself is unchanged. */
  const replaceAsset = (id: string, key: string) => {
    const source = instances.find(item => item.id === id);
    if (!source || !canAdd) return;
    let failure: AssetReplaceFailure | undefined;
    commit(current => {
      const result = replaceInstanceAsset(current.definition.content, { id, key, resource: resources[key], from: resourceOf(source) });
      if (!result.ok) { failure = result.reason; return current; }
      // Pin the visible name: unnamed tracks would otherwise take the new asset's name.
      const content = { ...result.content, instances: result.content.instances.map(item => item.id === id && !item.name ? { ...item, name: nameOf(source) } : item) };
      return { ...current, definition: { ...current.definition, content } };
    });
    if (failure) editor.setError(failure === "kind" ? text("只能替换为同类型素材。", "Replace only with an asset of the same type.") : text("素材不可用，请刷新素材库后重试。", "This asset is unavailable. Refresh the library and try again."));
  };
  const addText = () => {
    if (!canAdd) return;
    const id = `text_${crypto.randomUUID().slice(0, 8)}`;
    const timing = insertionTiming(time, duration);
    const added: CompositionInstance = { id, name: text("空间文字", "Spatial text"), text: { content: text("在此写下你的故事", "Tell your story here"), color: "#202020", fontSize: .25, width: 3, align: "center" }, position: [0, 1.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null, timing };
    commit(current => ({ ...current, definition: { ...current.definition, content: { ...current.definition.content, durationSeconds: Math.max(duration, timing.endSeconds), instances: [...current.definition.content.instances, added] } } }));
    select(id);
  };
  const updateInstance = (patch: Partial<CompositionInstance>) => {
    if (!instance || playing) return;
    tracks.edit(instance.id, node => ({ ...node, ...patch }));
  };
  const duplicate = (sourceId: string) => {
    const snapshot = copyTracks(document.definition.content, [sourceId], nameOf);
    if (snapshot) paste(snapshot);
  };
  const selectedResource = instance ? resourceOf(instance) : undefined;
  const hidden = hiddenNodeIds(document.definition.content);
  return <main className="scene-workspace-theme scene-native-stage fixed inset-0 z-50 bg-background" aria-label={t("sceneEditor.sceneView")}>
    <NavigationIsland ref={setHeaderElement} className="scene-project-island">
      <SceneToolbar panelOpen={panelOpen} onTogglePanel={library.toggle} title={document.title} dirty={editor.dirty} saving={editor.saving} preview={preview} canUndo={editor.canUndo} canRedo={editor.canRedo} onUndo={editor.undo} onRedo={editor.redo} onTitle={title => commit(current => ({ ...current, title }))} onPreview={() => setPreview(!preview)} onSave={() => void editor.save()} onAddText={addText} canAddText={canAdd} backHref={teamHref("/manage/scenes", sceneOrganizationId)} readOnly={readOnly} qr={detail?.state === "active" ? <SceneQrButton sceneId={sceneId} dirty={editor.dirty} portalContainer={headerElement} /> : undefined} />
      {editor.conflict && <SceneConflictBanner draftJson={() => JSON.stringify({ name: document.title, document: document.definition }, null, 2)} fileName={`${document.title || "scene"}-draft.json`} onReload={editor.retry} onDismiss={editor.dismissConflict} />}
      {editor.error && <div role="alert" className="flex items-start gap-3 border-t bg-background p-3"><Text as="p" variant="bodySm" tone="critical" className="flex-1">{editor.error}</Text><Button variant="ghost" size="icon" className="size-6" aria-label={text("关闭提示", "Dismiss message")} onClick={() => editor.setError("")}><X /></Button></div>}
      {readOnly && <ContentNotice title={text("只读场景", "Read-only scene")} description={text("可以预览播放；当前权限或归档状态不允许编辑。", "Preview and playback are available. Editing is unavailable for this permission or archive status.")} />}
    </NavigationIsland>
    <div className="scene-workbench">
      <div className="scene-library-pane" style={{ width: library.size }} hidden={library.collapsed}>
        <aside id="scene-assets" className="scene-workspace-sidebar scene-island" aria-label={text("素材库", "Asset library")}>
          <SceneLibraryPanel organizationId={sceneOrganizationId} canAdd={canAdd} canUpload={!readOnly} onRegister={editor.registerResource} onAdd={resource => addAsset(resource.assetId, undefined, resource)} onAddText={addText} />
        </aside>
        <ScenePanelDivider panel="library" sizing={library} controls="scene-assets" />
      </div>
      <div className="scene-stage-content">
      <div className="scene-stage-area" data-preview-open={preview || undefined} data-inspector={!!selectedNode || undefined}>
        <SceneModelDropZone canDrop={key => !!resources[key]?.url && resources[key]?.assetState !== "archived"} enabled={canAdd} placementRef={placementRef} onAdd={addAsset}>
          <ViewportBoundary fallback={<Text as="p" variant="bodyMd" tone="critical">{t("sceneEditor.modelFailed")}</Text>}>
            <SceneViewport placementRef={placementRef} session={session} instances={instances} groups={groups} resolveUrl={item => resourceOf(item)?.url} resolveResource={resourceOf} onClips={editor.onClips} fitRef={fitRef} originRef={originRef} previewRef={previewRef} cameraSettings={cameraSettings} selectedId={selectedId} onSelect={select} grid={grid} labels={labels} toolsRef={nativeToolsRef} shadingRef={shadingRef} language={i18n.language} preview={preview} onError={editor.setError} editable={!readOnly && !playing} onTransform={(id, group, value) => tracks.edit(id, node => editTransform(node, group, session.time, value))} />
          </ViewportBoundary>
        </SceneModelDropZone>
        <div className="scene-tools-anchor"><SceneSidebar nativeToolsRef={nativeToolsRef} shadingRef={shadingRef} grid={grid} labels={labels} onLabels={() => setLabels(value => !value)} onGrid={() => setGrid(!grid)} onFit={() => fitRef.current?.()} onOrigin={() => originRef.current?.()} cameraSettings={cameraSettings} onCameraChange={changeCamera} positionDisabled={readOnly || playing} onPreview={() => setPreview(true)} /></div>
        <SceneCameraPreview open={preview} frameRef={previewRef} settings={cameraSettings} onChange={changeCamera} positionDisabled={readOnly || playing} onClose={() => setPreview(false)} />
        {selectedNode && !(compact && panelOpen) && <aside className="scene-inspector-island scene-island"><SceneInstancePanel key={selectedId} node={selectedNode} hiddenByParent={!!selectedNode.parent && hidden.has(selectedNode.parent)} name={nameOf(selectedNode)} resource={selectedResource} assetHref={teamHref(`/manage/assets/${selectedResource?.assetId}`, sceneOrganizationId)} clips={instance ? clips[instance.id] : undefined} readOnly={readOnly} playing={playing} time={time} duration={duration} onChange={updateInstance} onEdit={edit => selectedId && tracks.edit(selectedId, edit)} onRename={name => selectedId && tracks.rename(selectedId, name)} onClose={() => select(null)} onAnimation={animation => updateInstance({ animation })} onUngroup={() => selectedId && tracks.ungroup(selectedId)} onReplaceAsset={key => selectedId && replaceAsset(selectedId, key)} /></aside>}
        {!instances.length && <div className="scene-stage-empty"><Text as="p" variant="bodySm" tone="subdued">{text("拖入素材或添加文字", "Drop an asset or add text")}</Text></div>}
        {grid && labels && <div className="scene-stage-hint"><Text as="span" variant="bodyXs" tone="subdued">{text("每格 1 米", "1 m per cell")}</Text></div>}
      </div>
      <SceneTimeline content={document.definition.content} clips={clips} nameOf={nameOf} kindOf={kindOf} onAddAsset={(id, at) => addAsset(id, undefined, undefined, at)} selectedIds={selectedIds} onSelect={selectTracks} tracks={tracks} onDuplicate={duplicate} time={time} duration={duration} loop={loop} playing={playing} readOnly={readOnly} onSeek={editor.seek} onPlay={editor.play} onDuration={durationSeconds => commit(current => ({ ...current, definition: { ...current.definition, content: { ...current.definition.content, durationSeconds } } }))} onLoop={loop => commit(current => ({ ...current, definition: { ...current.definition, content: { ...current.definition.content, loop } } }))} />
    </div></div>
  </main>;
}
