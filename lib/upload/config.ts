import type { FileTypeConfig, UploadType } from "./types";
import {
  ImageIcon,
  Video,
  Music,
  FileText,
  Link as LinkIcon,
  File,
  Anchor,
  Box,
  Layers,
} from "lucide-react";
import { extractGPSFromImage } from "@/lib/exif-reader";
import { UPLOAD_ACCEPTS } from "./detection";
import { UPLOAD_SOURCE_MAX_MB } from "./policy";

// 定义移至 ./types（纯模块，服务端路由可安全导入），此处再导出以兼容现有引用
export { DEFAULT_UPLOAD_TYPES } from "./types";
export { inferUploadType } from "./detection";

/**
 * 文件类型配置
 */
export const FILE_TYPE_CONFIGS: Record<UploadType, FileTypeConfig> = {
  image: {
    type: "image",
    label: "fileTypes.image",
    icon: ImageIcon,
    accept: UPLOAD_ACCEPTS.image,
    maxSize: UPLOAD_SOURCE_MAX_MB.image,
    extractMetadata: async (file: File) => ({ gps: await extractGPSFromImage(file) }),
  },
  video: {
    type: "video",
    label: "fileTypes.video",
    icon: Video,
    accept: UPLOAD_ACCEPTS.video,
    maxSize: UPLOAD_SOURCE_MAX_MB.video,
  },
  audio: {
    type: "audio",
    label: "fileTypes.audio",
    icon: Music,
    accept: UPLOAD_ACCEPTS.audio,
    maxSize: UPLOAD_SOURCE_MAX_MB.audio,
  },
  document: {
    type: "document",
    label: "fileTypes.document",
    icon: File,
    accept: UPLOAD_ACCEPTS.document,
    maxSize: UPLOAD_SOURCE_MAX_MB.document,
  },
  link: {
    type: "link",
    label: "fileTypes.link",
    icon: LinkIcon,
    accept: UPLOAD_ACCEPTS.link,
  },
  text: {
    type: "text",
    label: "fileTypes.text",
    icon: FileText,
    accept: UPLOAD_ACCEPTS.text,
  },
  anchor: {
    type: "anchor",
    label: "fileTypes.anchor",
    icon: Anchor,
    accept: UPLOAD_ACCEPTS.anchor,
    maxSize: UPLOAD_SOURCE_MAX_MB.anchor,
    extractMetadata: async (file: File) => ({ gps: await extractGPSFromImage(file) }),
  },
  scene: {
    type: "scene",
    label: "fileTypes.scene",
    icon: Layers,
    accept: UPLOAD_ACCEPTS.scene,
    maxSize: UPLOAD_SOURCE_MAX_MB.scene,
  },
  model: {
    type: "model",
    label: "fileTypes.model",
    icon: Box,
    accept: UPLOAD_ACCEPTS.model,
    maxSize: UPLOAD_SOURCE_MAX_MB.model,
  },
};

/** Original-file size accepted before server-side compression. */
export function getEffectiveMaxSizeMB(type: UploadType): number {
  return UPLOAD_SOURCE_MAX_MB[type];
}

/**
 * 验证文件大小
 */
export function validateFileSize(file: File, maxSizeMB?: number): boolean {
  if (!maxSizeMB) return true;
  const maxBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxBytes;
}
