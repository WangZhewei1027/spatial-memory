import { invalid } from "./errors";
import { rejectUnknown, requireEnum, requireRecord } from "./input";

export interface CollectionMiniappConfig {
  retrieval_mode: "gps" | "anchor";
  text_asset_miniapp_style: "plain_white" | "dialog_decorated";
  confetti_enabled: boolean;
  footer_enabled: boolean;
}

export const DEFAULT_COLLECTION_MINIAPP_CONFIG: Readonly<CollectionMiniappConfig> = {
  retrieval_mode: "gps",
  text_asset_miniapp_style: "dialog_decorated",
  confetti_enabled: false,
  footer_enabled: false,
};

/** A complete, public configuration; private team settings never enter this shape. */
export function parseCollectionMiniappConfig(value: unknown): CollectionMiniappConfig {
  const config = requireRecord(value, "miniappConfig");
  rejectUnknown(config, Object.keys(DEFAULT_COLLECTION_MINIAPP_CONFIG), "miniappConfig");
  if (typeof config.confetti_enabled !== "boolean" || typeof config.footer_enabled !== "boolean")
    throw invalid("彩带与水印设置必须是布尔值");
  return {
    retrieval_mode: requireEnum(config.retrieval_mode, "retrieval_mode", ["gps", "anchor"]),
    text_asset_miniapp_style: requireEnum(config.text_asset_miniapp_style, "text_asset_miniapp_style", ["plain_white", "dialog_decorated"]),
    confetti_enabled: config.confetti_enabled,
    footer_enabled: config.footer_enabled,
  };
}
