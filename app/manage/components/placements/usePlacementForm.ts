"use client";

import { useCallback, useEffect, useState } from "react";
import type { PayloadScalar, PlacementDto, PlacementRenderConfig, UpdatePlacementRequest } from "@/lib/content-model/contracts";
import type { ContentActionFailure } from "@/app/manage/content/useContentAction";
import { isLockConflict, placementApi } from "../../lib/content-api";
import { toActionResult } from "../../lib/content-errors";
import { placementFileType } from "../../lib/placement-to-viewer";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { parseNumber, scalarEntries } from "./placement-utils";
import type { PlacementFormValues } from "../../lib/placement-draft";
export type { PlacementFormValues } from "../../lib/placement-draft";

const text = (value: PayloadScalar | undefined) => (value === undefined || value === null ? "" : String(value));

export function formValuesOf(placement: PlacementDto): PlacementFormValues {
  const config = placement.render_config.config ?? {};
  return {
    name: placement.name ?? "",
    status: placement.status,
    longitude: placement.location ? String(placement.location.longitude) : "",
    latitude: placement.location ? String(placement.location.latitude) : "",
    altitude: placement.location?.altitude != null ? String(placement.location.altitude) : "",
    anchorId: placement.anchor_id,
    isHuge: placement.render_config.is_huge ?? false,
    scale: text(config.scale_multiplier),
    textColor: text(config.text_color),
    textSize: text(config.text_size),
    tagIds: [...placement.tag_ids].sort(),
  };
}

function sameValues(a: PlacementFormValues, b: PlacementFormValues) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Scale and text style live in render_config.config. */
function renderConfigOf(base: PlacementDto, values: PlacementFormValues): PlacementRenderConfig {
  const type = placementFileType(base);
  const config: Record<string, PayloadScalar> = scalarEntries(base.render_config.config);
  const put = (key: string, raw: string, numeric: boolean) => {
    if (!raw.trim()) delete config[key];
    else config[key] = numeric ? Number(raw) : raw.trim();
  };
  if (type === "model") put("scale_multiplier", values.scale, true);
  if (type === "text") {
    put("text_color", values.textColor, false);
    put("text_size", values.textSize, true);
  }
  const out: PlacementRenderConfig = { config };
  if (type === "model") out.is_huge = values.isHuge;
  if (base.render_config.display) out.display = scalarEntries(base.render_config.display);
  return out;
}

export type FormProblem = "coordinates" | "scale" | "textSize";

/** Only changed fields; `problem` when the input cannot be sent. */
export function buildChanges(base: PlacementDto, values: PlacementFormValues): { changes: Omit<UpdatePlacementRequest, "expectedLockVersion">; problem: FormProblem | null } {
  const before = formValuesOf(base);
  const changes: Omit<UpdatePlacementRequest, "expectedLockVersion"> = {};
  if (values.name.trim() !== before.name.trim()) changes.name = values.name.trim() || null;
  if (values.status !== before.status) changes.status = values.status;
  if (values.anchorId !== before.anchorId) changes.anchorId = values.anchorId;
  if (JSON.stringify(values.tagIds) !== JSON.stringify(before.tagIds)) changes.tagIds = values.tagIds;

  if (values.longitude !== before.longitude || values.latitude !== before.latitude || values.altitude !== before.altitude) {
    const longitude = parseNumber(values.longitude);
    const latitude = parseNumber(values.latitude);
    const altitude = parseNumber(values.altitude);
    if (longitude === null && latitude === null && altitude === null) changes.location = null;
    else if (longitude === null || latitude === null || Number.isNaN(longitude) || Number.isNaN(latitude) || Number.isNaN(altitude)
      || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return { changes, problem: "coordinates" };
    else changes.location = { longitude, latitude, altitude };
  }

  if (values.isHuge !== before.isHuge || values.scale !== before.scale || values.textColor !== before.textColor || values.textSize !== before.textSize) {
    const scale = parseNumber(values.scale);
    if (scale !== null && !(scale > 0)) return { changes, problem: "scale" };
    const size = parseNumber(values.textSize);
    if (size !== null && !(size > 0)) return { changes, problem: "textSize" };
    changes.renderConfig = renderConfigOf(base, values);
  }
  return { changes, problem: null };
}

/**
 * Editor state for one placement. The form is based on the lock version it
 * was loaded from: a newer server row replaces it only while there are no
 * local edits; otherwise saving surfaces the 409 and keeps the edits until
 * the user explicitly reloads.
 */
export function usePlacementForm(placement: PlacementDto) {
  const { tx } = usePlacementMap();
  const scopeKey = usePlacementStore((state) => state.scopeKey);
  const draft = usePlacementStore((state) => state.placementDrafts[placement.id]);
  const base = draft?.base ?? placement;
  const values = draft?.values ?? formValuesOf(placement);
  const [saving, setSaving] = useState(false);
  const [saveConflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<ContentActionFailure | null>(null);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [rebaseAfter, setRebaseAfter] = useState<number | null>(null);
  const loadedCount = usePlacementStore((state) => state.loadedCount);
  const dirty = !sameValues(values, formValuesOf(base));
  const conflict = saveConflict || (dirty && base.lock_version !== placement.lock_version);

  // Only an explicit conflict reload replaces the retained version and draft.
  useEffect(() => {
    if (scopeKey && rebaseAfter !== null && loadedCount > rebaseAfter) {
      usePlacementStore.getState().setPlacementDraft(scopeKey, placement.id, null);
      setConflict(false);
      setFailure(null);
      setRebaseAfter(null);
    }
  }, [placement.id, scopeKey, rebaseAfter, loadedCount]);

  const update = useCallback((patch: Partial<PlacementFormValues>) => {
    if (!scopeKey) return;
    const store = usePlacementStore.getState();
    const current = store.placementDrafts[placement.id];
    const original = current?.base ?? placement;
    const next = { ...(current?.values ?? formValuesOf(original)), ...patch };
    store.setPlacementDraft(scopeKey, placement.id, sameValues(next, formValuesOf(original)) ? null : { base: original, values: next });
    setProblem(null);
  }, [placement, scopeKey]);

  const save = useCallback(async () => {
    const { changes, problem: invalid } = buildChanges(base, values);
    if (invalid) return setProblem(invalid);
    if (!Object.keys(changes).length) return;
    setSaving(true);
    setFailure(null);
    try {
      const updated = await placementApi.update(base.id, { expectedLockVersion: base.lock_version, ...changes });
      const store = usePlacementStore.getState();
      if (store.scopeKey !== scopeKey) return;
      store.upsertPlacements([updated]);
      // A later draft must survive an in-flight save from an unmounted editor.
      if (scopeKey && store.placementDrafts[base.id] === draft) store.setPlacementDraft(scopeKey, base.id, null);
      setConflict(false);
    } catch (error) {
      if (isLockConflict(error)) setConflict(true);
      else setFailure(toActionResult(error, tx));
    } finally {
      setSaving(false);
    }
  }, [base, values, tx, scopeKey, draft]);

  const discard = useCallback(() => {
    if (scopeKey) usePlacementStore.getState().setPlacementDraft(scopeKey, placement.id, null);
    setConflict(false);
    setProblem(null);
    setFailure(null);
  }, [placement.id, scopeKey]);

  /** Explicit reload after a conflict: re-fetch the list, then take the server row. */
  const reload = useCallback(() => {
    setRebaseAfter(usePlacementStore.getState().loadedCount);
    usePlacementStore.getState().requestReload();
  }, []);

  return { base, values, update, dirty, saving, conflict, failure, problem, save, discard, reload };
}
