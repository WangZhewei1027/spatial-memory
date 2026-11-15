"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLinkAssetErrorKey, parseLinkAssetInput } from "@/lib/link-asset";
import type { UploadType } from "@/lib/upload/types";
import type { UploadStage } from "@/lib/upload/progress";
import { fileTypeOf, linkPayload, prepareFile, textPayload, uploadAssetFiles, type PreparedFile, type UploadedAssetInput } from "../../lib/content-upload";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { EMPTY_LOCATION, locationFromCapture, parseLocation, useCreatePlacement, type LocationInput } from "./useCreatePlacement";
import type { PickedSource } from "./SourcePicker";

const PLACEABLE: UploadType[] = ["image", "video", "audio", "model", "document", "text", "link", "anchor"];

/** One creation draft survives inspector switches; upload happens only on submit. */
export function usePlacementCreation() {
  const { t } = useTranslation();
  const { tx, organizationId, workspaceId, allowedUploadTypes } = usePlacementMap();
  const types = useMemo(() => PLACEABLE.filter((type) => allowedUploadTypes.includes(type)), [allowedUploadTypes]);
  const create = useCreatePlacement();
  const [mode, setMode] = useState<"existing" | "upload">("existing");
  const [source, setSource] = useState<PickedSource | null>(null);
  const [type, setType] = useState<UploadType>(types[0] ?? "image");
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState<LocationInput>(EMPTY_LOCATION);
  const [problem, setProblem] = useState<string | null>(null);
  const preparation = useRef(0);
  const uploaded = useRef<{ source: PreparedFile; input: UploadedAssetInput } | null>(null);
  const linkState = useMemo(() => {
    if (type !== "link" || !link.trim()) return { data: null, errorKey: null };
    try { return { data: parseLinkAssetInput(link), errorKey: null }; }
    catch (error) { return { data: null, errorKey: getLinkAssetErrorKey(error) }; }
  }, [type, link]);
  const isFile = type !== "text" && type !== "link";
  const uploadReady = types.includes(type) && !preparing && (isFile ? !!prepared : type === "text" ? !!text.trim() : !!linkState.data);
  const contentReady = mode === "existing" ? !!source : uploadReady;
  const point = parseLocation(location);
  const dirty = !!(source || file || text || link || name || Object.values(location).some(Boolean));
  const sourceName = mode === "existing"
    ? source?.kind === "asset" ? source.asset.name : source?.scene.name
    : isFile ? file?.name : type === "text" ? text.trim().slice(0, 40) : linkState.data?.originalUrl;

  useEffect(() => { usePlacementStore.getState().setCreateHasDraft(dirty); }, [dirty]);
  useEffect(() => () => { preparation.current++; }, []);

  const clearFile = () => { preparation.current++; setFile(null); setPrepared(null); setPreparing(false); uploaded.current = null; setProblem(null); };
  const changeType = (next: UploadType) => { clearFile(); setType(next); create.resetIntent(); };
  const selectFile = async (next: File) => {
    const version = ++preparation.current;
    setFile(next); setPrepared(null); setProblem(null); setPreparing(true); uploaded.current = null; create.resetIntent();
    try {
      const result = await prepareFile(next, type);
      if (version === preparation.current) setPrepared(result);
    } catch (error) {
      if (version === preparation.current) setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === preparation.current) setPreparing(false);
    }
  };
  const reset = () => {
    clearFile(); setSource(null); setText(""); setLink(""); setName(""); setLocation(EMPTY_LOCATION); create.resetIntent();
  };
  const submit = async () => {
    if (create.pending || preparing) return;
    setProblem(null);
    if (!contentReady) return setProblem(tx("contentModel.integration.map.create.pickSource"));
    if (point === "invalid") return setProblem(tx("contentModel.integration.map.problem.coordinates"));
    if (!point) return setProblem(tx("contentModel.integration.map.create.locationRequired"));
    setStage("creating");
    const created = await create.submit(async () => {
      const common = { name: name.trim() || undefined, location: point, status: "active" as const };
      if (mode === "existing" && source) {
        const target = source.kind === "asset" ? { kind: "asset" as const, assetId: source.asset.id } : { kind: "scene" as const, sceneId: source.scene.id };
        return { ...common, target };
      }
      const assetName = name.trim() || sourceName || "";
      if (type === "text") return { ...common, asset: { name: assetName, fileType: "text", payload: textPayload(text.trim()), resources: [] } };
      if (type === "link" && linkState.data) return { ...common, asset: { name: assetName, fileType: "link", payload: linkPayload(linkState.data, name.trim() || undefined), resources: [] } };
      if (!prepared) throw new Error(tx("contentModel.integration.map.create.fileRequired"));
      if (!uploaded.current || uploaded.current.source !== prepared) uploaded.current = { source: prepared, input: await uploadAssetFiles(prepared, { organizationId, workspaceId }, undefined, setStage) };
      setStage("creating");
      const { payload, resources } = uploaded.current.input;
      return { ...common, asset: { name: assetName, fileType: fileTypeOf(prepared.type), payload, resources } };
    });
    setStage(null);
    if (created) reset();
  };
  return {
    mode, setMode, source, setSource, types, type, changeType, file, prepared, clearFile, selectFile, preparing,
    text, setText, link, setLink, linkState, linkError: linkState.errorKey ? t(linkState.errorKey) : null,
    name, setName, location, setLocation, point, photoLocation: locationFromCapture(prepared?.capture),
    contentReady, uploadReady, sourceName, dirty, isFile, problem, error: create.error, pending: create.pending, stage, submit, reset,
  };
}

export type PlacementCreation = ReturnType<typeof usePlacementCreation>;
