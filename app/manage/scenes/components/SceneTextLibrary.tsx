"use client";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

export function SceneTextLibrary({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  return <div className="scene-library-texts">
    <Button variant="outline" className="scene-library-create-text" disabled={!canAdd} onClick={onAdd}><Plus />{text("添加空间文字", "Add spatial text")}</Button>
    <Text as="p" variant="bodySm" tone="subdued">{text("文字随当前场景保存。", "Text is saved with this scene.")}</Text>
  </div>;
}
