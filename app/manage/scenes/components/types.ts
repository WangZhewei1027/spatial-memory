import type { AssetState, ModelAnimationInfo } from "@/lib/content-model/contracts";

export type ClipInfo = { name: string; duration: number };
export type SceneResourceKind = "model" | "image" | "audio" | "video";
/** A team resource the editor can render, resolved from the current asset. */
export interface SceneResource {
  assetId: string;
  assetLockVersion: number;
  name: string | null;
  url: string | null;
  assetState: AssetState;
  /** Omitted only by legacy model fixtures. */
  kind?: SceneResourceKind;
  durationSeconds?: number;
  /** Library artwork only; never load an entire video or model to draw a tile. */
  thumbnailUrl?: string | null;
  animations?: ModelAnimationInfo[];
}
