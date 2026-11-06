"use client";
import { subscribeContentChanges } from "../../lib/content-events";
import { resourceFromAsset, resourceFromResolved } from "./scene-performance";
import type { SceneDetailDto, SceneResolvedResourceDto } from "@/lib/content-model/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetApi, isLockConflict, sceneApi } from "../../lib/content-api";
import { fromDocument, normalizeDefinition, toDocument, type EditorAssetRef, type EditorDefinition } from "../../lib/scene-document";
import { resourceKey } from "./scene-add-model";
import { createSceneSession, type SceneSession } from "./scene-session";
import type { ClipInfo, SceneResource } from "./types";

export type SceneDocument = { title: string; definition: EditorDefinition };
export interface SaveConflict { message: string }

const indexResolved = (list: SceneResolvedResourceDto[]) => Object.fromEntries(list.map((item) => [item.asset_id, resourceFromResolved(item)]));

export function useSceneDocument(sceneId: string, initial?: SceneDetailDto | null) {
  const { t } = useTranslation();
  const [session, setSession] = useState<SceneSession | null>(null);
  const [document, setDocument] = useState<SceneDocument | null>(null);
  const [resources, setResources] = useState<Record<string, SceneResource>>({});
  const [detail, setDetail] = useState<SceneDetailDto | null>(null);
  const [clips, setClips] = useState<Record<string, ClipInfo[]>>({});
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const retry = 0;
  const history = useRef<{ past: SceneDocument[]; future: SceneDocument[] }>({ past: [], future: [] });
  const [, renderHistory] = useState(0);
  const lock = useRef<string | number>("");
  const initialRef = useRef(initial ?? null);
  const latest = useRef(document); latest.current = document;
  const savingRef = useRef(false);
  const dirty = (!!document && JSON.stringify(document) !== baseline);
  const readOnly = (!detail || !detail.capabilities.can_edit || detail.state === "archived");
  useEffect(() => {
    let cancelled = false;
    let active: SceneSession | undefined;
    const abort = new AbortController();
    const cleanup: (() => void)[] = [];
    setError(""); setConflict(null);
    (async () => {
        // Both Strict Mode runs may use the route's prefetch; only an explicit reload refetches.
        const prefetched = retry === 0 ? initialRef.current : null;
        const scene = prefetched ?? await sceneApi.get(sceneId, abort.signal);
        const loaded: SceneDocument = { title: scene.name, definition: fromDocument(scene.document) };
        if (cancelled) return;
        setDetail(scene); setResources(indexResolved(scene.referenced_resources)); lock.current = scene.lock_version;
      active = createSceneSession(loaded.definition);
      if (cancelled) { active.dispose(); return; }
      setDocument(loaded); setBaseline(JSON.stringify(loaded));
      const player = active;
      cleanup.push(player.subscribe(() => { setTime(player.time); setPlaying(player.playing); }));
      setSession(active);
    })().catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; abort.abort(); cleanup.forEach((fn) => fn()); active?.dispose(); };
  }, [sceneId, retry]);
  useEffect(() => {
    const previous = window.document.title;
    window.document.title = [document?.title.trim(), t("sceneEditor.heading")].filter(Boolean).join(" · ");
    return () => { window.document.title = previous; };
  }, [document?.title, t]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || savingRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  // Refresh resources independently: the local composition and undo history stay intact.
  useEffect(() => {
    let abort: AbortController | null = null;
    const stop = subscribeContentChanges(() => {
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      const ids = [...new Set(Object.values(latest.current?.definition.content.assets ?? {}).map((ref) => ref.assetId))];
      void Promise.all(ids.map(async (id) => {
        const asset = await assetApi.get(id, controller.signal);
        return resourceFromAsset(asset);
      })).then((items) => {
        if (!controller.signal.aborted) setResources((current) => ({ ...current, ...Object.fromEntries(items.filter((item): item is SceneResource => !!item).map((item) => [item.assetId, item])) }));
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    });
    return () => { stop(); abort?.abort(); };
  }, [sceneId]);
  const resolve = useCallback((ref: EditorAssetRef | undefined) => resources[resourceKey(ref)], [resources]);
  const registerResource = useCallback((resource: SceneResource) => {
    const key = resource.assetId;
    if (key) setResources((current) => ({ ...current, [key]: { ...current[key], ...resource } }));
  }, []);
  const commit = useCallback((edit: (current: SceneDocument) => SceneDocument) => {
    const previous = latest.current;
    if (!previous || !session || readOnly) return;
    try {
      const next = edit(previous);
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      if (JSON.stringify(next.definition) !== JSON.stringify(previous.definition)) {
        next.definition = normalizeDefinition(next.definition);
        session.pause();
        session.sync(next.definition.content);
      }
      history.current.past.push(previous);
      if (history.current.past.length > 60) history.current.past.shift();
      history.current.future = [];
      latest.current = next; setDocument(next); setError("");
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [session, readOnly]);
  const travel = (direction: "past" | "future") => {
    const previous = latest.current, next = history.current[direction].pop();
    if (!previous || !next || !session || readOnly) return;
    history.current[direction === "past" ? "future" : "past"].push(previous);
    session.pause(); session.sync(next.definition.content);
    latest.current = next; setDocument(next); setError(""); renderHistory(n => n + 1);
  };
  useEffect(() => {
    if (!session) return;
    let frame = 0, last = 0;
    const tick = (now: number) => {
      if (!session.playing) { frame = 0; return; }
      session.advance(last ? (now - last) / 1000 : 0); last = now;
      frame = session.playing ? requestAnimationFrame(tick) : 0;
    };
    const stop = session.subscribe(() => {
      if (session.playing && !frame) { last = 0; frame = requestAnimationFrame(tick); }
      else if (!session.playing && frame) { cancelAnimationFrame(frame); frame = 0; }
    });
    const hide = () => { if (window.document.hidden) session.pause(); };
    window.document.addEventListener("visibilitychange", hide);
    return () => { stop(); cancelAnimationFrame(frame); window.document.removeEventListener("visibilitychange", hide); };
  }, [session]);
  // Legacy uploads can lack a clip index. Resolve only newly inserted tracks, as part of their insertion history.
  const pendingInitialClips = useRef(new Map<string, string>());
  const awaitInitialClip = (id: string, assetId: string) => pendingInitialClips.current.set(id, assetId);
  const onClips = useCallback((id: string, value: ClipInfo[], loadedAssetId?: string) => {
    setClips(current => ({ ...current, [id]: value }));
    if (!loadedAssetId || pendingInitialClips.current.get(id) !== loadedAssetId) return;
    pendingInitialClips.current.delete(id);
    if (!value.length || !latest.current || !session) return;
    const initialize = (snapshot: SceneDocument) => {
      const content = snapshot.definition.content;
      const instance = content.instances.find(item => item.id === id);
      if (!instance?.asset || instance.animation || content.assets[instance.asset]?.assetId !== loadedAssetId) return snapshot;
      const animation = { clipIndex: 0, startSeconds: instance.timing?.startSeconds ?? 0, loop: true };
      const instances = content.instances.map(item => item === instance ? { ...item, animation } : item);
      return { ...snapshot, definition: { ...snapshot.definition, content: { ...content, instances } } };
    };
    history.current.past = history.current.past.map(initialize);
    history.current.future = history.current.future.map(initialize);
    const next = initialize(latest.current);
    if (next !== latest.current) {
      latest.current = next; setDocument(next); session.sync(next.definition.content);
    }
  }, [session]);
  /** Saves the current scene; all references read this saved content. Resolves true on success. */
  const save = useCallback(async () => {
    const current = latest.current;
    if (!current || !session || savingRef.current || readOnly) return false;
    setError("");
    try {
      const snapshot = structuredClone(current);
      snapshot.definition = normalizeDefinition(snapshot.definition);
      latest.current = snapshot; setDocument(snapshot);
      if (!snapshot.title.trim()) throw new Error(t("sceneEditor.titleRequired"));
      const { instances, assets } = snapshot.definition.content;
      for (const instance of instances) {
        if (instance.text) continue;
        if (!instance.asset || !resources[resourceKey(assets[instance.asset])]?.url) throw new Error(t("sceneEditor.missingModel"));
        if (instance.animation) {
          const available = clips[instance.id];
          const clip = instance.animation.clipIndex !== undefined ? available?.[instance.animation.clipIndex] : available?.find((item) => item.name === instance.animation?.clipName);
          if (!clip || !(clip.duration > 0)) throw new Error(t("sceneEditor.invalidClip"));
        }
      }
      session.pause(); savingRef.current = true; setSaving(true);
        try {
          const saved = await sceneApi.save(sceneId, { expectedLockVersion: Number(lock.current), name: snapshot.title, document: toDocument(snapshot.definition) });
          lock.current = saved.lock_version; setDetail(saved);
          setResources((current) => ({ ...current, ...indexResolved(saved.referenced_resources) }));
        } catch (err) {
          // Stale or missing lock: keep the local draft untouched and offer recovery; never overwrite.
          if (isLockConflict(err)) { setConflict({ message: err instanceof Error ? err.message : String(err) }); return false; }
          throw err;
        }
      setBaseline(JSON.stringify(snapshot)); setConflict(null);
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }, [session, resources, clips, sceneId, readOnly, t]);
  const seek = (position: number) => session?.seek(position);
  const play = () => {
    if (!session || !document) return;
    if (playing) { session.pause(); return; }
    session.play(document.definition.content.loop);
  };
  return {
    session, document, resources, resolve, registerResource, detail, setDetail, lockVersion: () => lock.current,
    clips, onClips, awaitInitialClip, error, setError, conflict, dismissConflict: () => setConflict(null), saving, dirty, readOnly, time, playing, commit, save, seek, play,
    undo: () => travel("past"), redo: () => travel("future"), canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0,
    retry: () => window.location.reload(),
  };
}
export type SceneEditorState = ReturnType<typeof useSceneDocument>;
