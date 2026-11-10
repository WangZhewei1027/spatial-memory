"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ContentSection } from "@/app/manage/content/ContentSection";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Item {
  id: string;
  name: string;
}

export interface MatchingPointAttachmentsProps {
  canManage: boolean;
  childrenAssets: Item[];
  availableAssets: Item[];
  attaching?: boolean;
  error?: string | null;
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
}

/**
 * Recognition-target section of the asset panel: content shown after the
 * target is recognized. The reference image itself is the asset content and
 * is replaced through the panel's regular edit action.
 */
export function MatchingPointAttachments(props: MatchingPointAttachmentsProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!props.availableAssets.some((a) => a.id === selected)) setSelected("");
  }, [props.availableAssets, selected]);
  return (
    <ContentSection
      plain
      title={`${t("matching.children")} · ${props.childrenAssets.length}`}
      description={t("matching.imageHint")}
    >
      <div className="space-y-2 pb-1">
        {!props.childrenAssets.length && (
          <Text as="p" variant="bodySm" tone="subdued">
            {t("matching.emptyChildren")}
          </Text>
        )}
        {props.childrenAssets.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto">
            {props.childrenAssets.map((asset) => (
              <li key={asset.id} className="flex items-center justify-between gap-2 py-2">
                <Text as="span" variant="bodySm" breakWord className="min-w-0 flex-1">
                  {asset.name}
                </Text>
                {props.canManage && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    aria-label={`${t("matching.detach")} ${asset.name}`}
                    disabled={props.attaching}
                    onClick={() => props.onDetach(asset.id)}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.canManage && props.availableAssets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Select value={selected} onValueChange={setSelected} disabled={props.attaching}>
              <SelectTrigger className="min-w-0 flex-1" aria-label={t("matching.selectChildren")}>
                <SelectValue placeholder={t("matching.selectChildren")} />
              </SelectTrigger>
              <SelectContent>
                {props.availableAssets.map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    {asset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!selected || props.attaching}
              onClick={() => props.onAttach(selected)}
            >
              {t("matching.attach")}
            </Button>
          </div>
        )}
        {props.error && (
          <Text as="p" variant="bodySm" tone="critical" role="alert">
            {props.error}
          </Text>
        )}
      </div>
    </ContentSection>
  );
}
