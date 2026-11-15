/**
 * Client adapter between original files and commands that accept upload
 * receipts. The browser extracts capture GPS; the upload endpoint compresses
 * images and transcodes audio before issuing receipts for the final bytes.
 *
 * Capture GPS goes into `payload.capture` as provenance only; a placement is
 * created solely from an explicit location the caller passes.
 */
import type {
  AssetFileType,
  AssetPayload,
  CaptureMetadata,
  ModelAnimationInfo,
  PayloadAttributes,
  ResourceInput,
  UploadReceiptDto,
} from "@/lib/content-model/contracts";
import type { LinkAssetData } from "@/lib/link-asset";
import { FILE_TYPE_CONFIGS, getEffectiveMaxSizeMB, validateFileSize } from "@/lib/upload/config";
import { FileUploadService } from "@/lib/upload/service";
import type { UploadStageListener } from "@/lib/upload/progress";
import type { UploadType } from "@/lib/upload/types";
import { uploadReceipt, type UploadScope } from "./content-api";

export interface PreparedFile {
  file: File;
  type: UploadType;
  capture?: CaptureMetadata;
  animations?: ModelAnimationInfo[];
}

/** Upload types that become asset content in the generic library. */
export const LIBRARY_UPLOAD_TYPES = ["model", "image", "video", "audio", "document", "anchor"] as const;
export type LibraryUploadType = (typeof LIBRARY_UPLOAD_TYPES)[number];

export function acceptFor(type: UploadType) {
  return FILE_TYPE_CONFIGS[type]?.accept;
}

/** Validate originals and inspect capture/animation metadata before upload. */
export async function prepareFile(file: File, type?: UploadType): Promise<PreparedFile> {
  if (type === "model") {
    if (!validateFileSize(file, getEffectiveMaxSizeMB("model"))) throw new Error(`> ${getEffectiveMaxSizeMB("model")} MB`);
    return { file, type: "model", animations: await readModelAnimations(file) };
  }
  const processed = await new FileUploadService().processFile(file, type);
  const gps = processed.gpsSource;
  const capture: CaptureMetadata | undefined = gps
    ? { latitude: gps.location.latitude, longitude: gps.location.longitude, altitude: gps.location.height, source: gps.type, captured_at: gps.timestamp }
    : undefined;
  return { file: processed.file, type: processed.type, capture };
}

/** Best-effort clip list for the asset payload; the server stays authoritative. */
export async function readModelAnimations(file: File): Promise<ModelAnimationInfo[] | undefined> {
  try {
    const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/loaders/DRACOLoader.js"),
    ]);
    const loader = new GLTFLoader();
    const media = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
    if (media) loader.setDRACOLoader(new DRACOLoader().setDecoderPath(`${media.replace(/\/+$/, "")}/static/draco/gltf/`));
    const gltf = await loader.parseAsync(await file.arrayBuffer(), "");
    return gltf.animations.map((clip, index) => ({ index, name: clip.name, duration_seconds: clip.duration }));
  } catch {
    return undefined;
  }
}

export function fileTypeOf(type: UploadType): AssetFileType {
  return type === "scene" ? "document" : type;
}

export function filePayload(prepared: PreparedFile): AssetPayload {
  const kind = fileTypeOf(prepared.type);
  const base = prepared.capture ? { capture: prepared.capture } : {};
  if (kind === "model") return { ...base, kind, ...(prepared.animations ? { animations: prepared.animations } : {}) };
  if (kind === "text" || kind === "link") throw new Error(`${kind} has no file payload`);
  return { ...base, kind } as AssetPayload;
}

export function textPayload(text: string, attributes?: PayloadAttributes, capture?: CaptureMetadata): AssetPayload {
  return { kind: "text", text, ...(attributes ? { attributes } : {}), ...(capture ? { capture } : {}) };
}

export function linkPayload(link: LinkAssetData, title?: string): AssetPayload {
  return { kind: "link", url: link.originalUrl, ...(title ? { title } : {}), preview: { preview_url: link.previewUrl, link_type: link.linkType } };
}

export interface UploadedAssetInput {
  payload: AssetPayload;
  resources: ResourceInput[];
  receipts: UploadReceiptDto[];
}

/**
 * Upload the original file and describe the server's result as asset content. Team
 * content passes only the organization; a collection is added solely for
 * upload-and-place on the map or onsite.
 */
export async function uploadAssetFiles(prepared: PreparedFile, scope: UploadScope, signal?: AbortSignal, onStage?: UploadStageListener): Promise<UploadedAssetInput> {
  const receipt = await uploadReceipt(prepared.file, { ...scope, type: prepared.type, purpose: "asset", signal, onStage });
  return { payload: filePayload(prepared), resources: [{ role: prepared.type === "anchor" ? "reference" : "primary", receiptId: receipt.id }], receipts: [receipt] };
}
