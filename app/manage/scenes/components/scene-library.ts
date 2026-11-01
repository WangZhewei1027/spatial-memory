import { Box, Film, ImageIcon, Library, Music2, Type } from "lucide-react";

/** New content categories share one media browser; spatial text stays scene-owned. */
export const LIBRARY_SECTIONS = [
  { id: "all", label: ["素材", "All"], icon: Library },
  { id: "model", label: ["模型", "Models"], icon: Box },
  { id: "image", label: ["图片", "Images"], icon: ImageIcon },
  { id: "video", label: ["视频", "Video"], icon: Film },
  { id: "audio", label: ["音频", "Audio"], icon: Music2 },
  { id: "text", label: ["文字", "Text"], icon: Type },
] as const;
export type LibrarySection = typeof LIBRARY_SECTIONS[number]["id"];
export type LibraryLayout = "grid" | "list";

export function libraryDuration(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
