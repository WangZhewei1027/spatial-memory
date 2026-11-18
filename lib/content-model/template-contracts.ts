import type { DuplicateContentRequest } from "./duplicate-contracts";

export const TEMPLATE_TYPES = ["asset", "scene", "collection"] as const;
export type TemplateType = typeof TEMPLATE_TYPES[number];

export interface TemplateMedia {
  kind: "image" | "video";
  url: string;
}

export interface TemplateCard {
  id: string;
  type: TemplateType;
  name: string | null;
  thumbnail: TemplateMedia | null;
}

export interface ManualTemplatePreview {
  thumbnail: TemplateMedia | null;
  lock_version: number;
}

export type DuplicateTemplateRequest = Omit<DuplicateContentRequest, "sourceType"> & { sourceType: TemplateType };
