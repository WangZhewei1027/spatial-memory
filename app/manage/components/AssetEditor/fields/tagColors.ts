/**
 * Notion 风格的固定标签调色板。
 * 颜色仍以 hex 字符串存储到后端,兼容历史上的任意 hex 数据;
 * 编辑器默认展示这组命名色块,并保留自定义 hex 作为补充。
 */

export interface TagColorPreset {
  /** 用于 i18n label / aria 的键:assetEditor.tags.colors.<key> */
  key: string;
  hex: string;
}

export const TAG_COLOR_PRESETS: TagColorPreset[] = [
  { key: "gray", hex: "#9B9A97" },
  { key: "brown", hex: "#A37764" },
  { key: "orange", hex: "#D9730D" },
  { key: "yellow", hex: "#DFAB01" },
  { key: "green", hex: "#0F7B6C" },
  { key: "blue", hex: "#0B6E99" },
  { key: "purple", hex: "#6940A5" },
  { key: "pink", hex: "#AD1A72" },
  { key: "red", hex: "#E03E3E" },
];

export const DEFAULT_TAG_COLOR = "#9B9A97";

/**
 * 给定背景 hex,返回可读的前景文字色(深底白字、浅底深字),
 * 用于彩色 badge 的文字对比。
 */
export function getReadableTextColor(hex: string): string {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  // 相对亮度(sRGB 近似)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}
