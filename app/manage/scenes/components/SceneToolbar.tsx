"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { ArrowLeft, Box, Eye, LoaderCircle, PanelLeftClose, PanelLeftOpen, Redo2, Save, Type, Undo2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface SceneToolbarProps {
  title: string; dirty: boolean; saving: boolean; preview: boolean; canUndo: boolean; canRedo: boolean;
  onTitle: (value: string) => void; onPreview: () => void; onSave: () => void; onUndo: () => void; onRedo: () => void;
  /** Where the back arrow leads; defaults to the map workspace. */
  backHref?: string;
  /** Viewer or archived scene: no title edit, save, undo or redo. */
  readOnly?: boolean;
  /** Archive state shown beside the save state (scenes). */
  status?: ReactNode;
  qr?: ReactNode;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  onAddText?: () => void;
  canAddText?: boolean;
}
export function SceneToolbar(props: SceneToolbarProps) {
  const { t, i18n } = useTranslation();
  const panelLabel = i18n.language.startsWith("zh") ? "素材库" : "Asset library";
  const previewLabel = i18n.language.startsWith("zh") ? "相机预览" : "Camera preview";
  const [draft, setDraft] = useState(props.title);
  useEffect(() => setDraft(props.title), [props.title]);
  const saveStatus = <><span className={`size-1.5 shrink-0 rounded-full ${props.dirty ? "bg-warning" : "bg-success"}`} /><Text as="span" variant="bodyXs" tone="subdued">{t(props.saving ? "sceneEditor.saving" : props.dirty ? "sceneEditor.unsaved" : "sceneEditor.saved")}</Text></>;
  return <header className="navigation-row scene-toolbar" aria-label={t("sceneEditor.controls")}>
    <Text as="h1" variant="headingMd" className="sr-only">{t("sceneEditor.heading")}</Text>
    <Button variant="ghost" size="icon" className="size-7" asChild title={t("sceneEditor.back")}><a target="_top" href={props.backHref ?? "/manage"} aria-label={t("sceneEditor.back")}><ArrowLeft /></a></Button>
    {props.onTogglePanel ? <Button variant="ghost" size="icon" className="size-7" aria-label={panelLabel} title={panelLabel} aria-expanded={props.panelOpen} aria-controls="scene-assets" onClick={props.onTogglePanel}>{props.panelOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</Button> : <Box className="size-5 shrink-0 text-muted-foreground max-sm:hidden" />}
    <div className="min-w-0 flex-1"><Input aria-label={t("sceneEditor.title")} readOnly={props.readOnly} value={draft} onChange={(event) => { setDraft(event.target.value); props.onTitle(event.target.value); }} onBlur={() => props.onTitle(draft)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-7 max-w-lg border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-input focus-visible:border-input md:text-sm" /><div role="status" className="flex items-center gap-1.5 whitespace-nowrap px-2 sm:hidden">{saveStatus}</div></div>
    {!props.readOnly && <div role="status" className="hidden items-center gap-2 sm:flex">{saveStatus}</div>}
    {props.status && <div className="hidden items-center sm:flex">{props.status}</div>}
    <div className="mx-1 hidden h-4 border-l sm:block" />
    {!props.readOnly && <><Button variant="ghost" size="icon" className="size-7" disabled={!props.canUndo} aria-label={t("sceneEditor.undo")} title={`${t("sceneEditor.undo")} (Ctrl/⌘ Z)`} onClick={props.onUndo}><Undo2 /></Button>
    <Button variant="ghost" size="icon" className="size-7" disabled={!props.canRedo} aria-label={t("sceneEditor.redo")} title={`${t("sceneEditor.redo")} (Ctrl/⌘ Shift Z)`} onClick={props.onRedo}><Redo2 /></Button></>}
    {props.onAddText && !props.readOnly && !props.panelOpen && <Button variant="ghost" size="sm" className="h-7 px-2" disabled={!props.canAddText} onClick={props.onAddText} aria-label={i18n.language.startsWith("zh") ? "添加空间文字" : "Add spatial text"}><Type /><span className="hidden md:inline">{i18n.language.startsWith("zh") ? "文字" : "Text"}</span></Button>}
    <Button variant={props.preview ? "secondary" : "ghost"} size="sm" className="h-7 px-2" aria-pressed={props.preview} aria-controls="scene-camera-preview" onClick={props.onPreview}><Eye /><span className="hidden sm:inline">{previewLabel}</span><span className="sr-only sm:hidden">{previewLabel}</span></Button>
    {!props.readOnly && <Button size="sm" variant="default" className="h-7 px-2.5" disabled={props.saving || (!props.dirty && draft === props.title) || !draft.trim()} onClick={() => { props.onTitle(draft); props.onSave(); }} title="Ctrl/⌘ S">{props.saving ? <LoaderCircle className="animate-spin" /> : <Save />}{t(props.saving ? "sceneEditor.saving" : "common.save")}</Button>}
    {props.qr && <div className="shrink-0">{props.qr}</div>}
  </header>;
}
