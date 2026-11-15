"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Anchor } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PlacementDto, PlacementStatus } from "@/lib/content-model/contracts";
import { FieldLabel } from "../AssetEditor/FieldLabel";
import { PlacementFieldGroup } from "./PlacementFieldGroup";
import { AssetTagEditor } from "../AssetEditor/fields/AssetTagEditor";
import { placementFileType } from "../../lib/placement-to-viewer";
import { usePlacementMap } from "./PlacementMapContext";
import { PlacementLocationFields } from "./PlacementLocationFields";
import { PlacementRenderFields } from "./PlacementRenderFields";
import type { FormProblem, PlacementFormValues } from "./usePlacementForm";

const EDITABLE_STATUSES: PlacementStatus[] = ["active", "paused", "draft"];
const NO_ANCHOR = "__none__";

interface PlacementFieldsFormProps {
  placement: PlacementDto;
  values: PlacementFormValues;
  editable: boolean;
  problem: FormProblem | null;
  onChange: (patch: Partial<PlacementFormValues>) => void;
}

/** Fields that belong to the placement itself (not to the source content). */
export function PlacementFieldsForm({ placement, values, editable, problem, onChange }: PlacementFieldsFormProps) {
  const { t } = useTranslation();
  const { tx, anchors, tags, workspaceId } = usePlacementMap();
  const id = useId();
  const type = placementFileType(placement);
  const showAnchor = type !== "anchor";
  const statuses = placement.status === "archived" ? [...EDITABLE_STATUSES, "archived" as const] : EDITABLE_STATUSES;
  const anchorKnown = !values.anchorId || anchors.some((anchor) => anchor.id === values.anchorId);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)] gap-2">
      <div className="space-y-1">
        <FieldLabel htmlFor={`${id}-name`}>{tx("contentModel.integration.map.field.name")}</FieldLabel>
        <Input id={`${id}-name`} value={values.name} disabled={!editable} placeholder={tx("contentModel.integration.map.field.namePlaceholder")} onChange={(event) => onChange({ name: event.target.value })} />
      </div>

      <div className="space-y-1">
        <FieldLabel htmlFor={`${id}-status`}>{tx("contentModel.integration.map.field.status")}</FieldLabel>
        <Select value={values.status} disabled={!editable} onValueChange={(value) => onChange({ status: value as PlacementStatus })}>
          <SelectTrigger id={`${id}-status`} className="text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {statuses.map((status) => (
              <SelectItem key={status} value={status} disabled={status === "archived"}>{t(`contentModel.placement.status.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {placement.status === "archived" && <p className="text-xs text-muted-foreground">{tx("contentModel.integration.map.field.archivedHint")}</p>}
      </div>
      </div>

      <div className="border-t pt-2"><PlacementLocationFields
        longitude={values.longitude}
        latitude={values.latitude}
        altitude={values.altitude}
        disabled={!editable}
        onChange={onChange}
        invalid={problem === "coordinates"}
      /></div>
      {problem === "coordinates" && <p role="alert" className="text-xs text-destructive">{tx("contentModel.integration.map.problem.coordinates")}</p>}

      {showAnchor && (
        <PlacementFieldGroup title={tx("contentModel.integration.map.field.anchor")} summary={values.anchorId ? anchors.find((anchor) => anchor.id === values.anchorId)?.name || tx("contentModel.integration.map.field.anchorOther") : tx("contentModel.integration.map.field.anchorNone")}>
        <div className="space-y-1">
          <FieldLabel htmlFor={`${id}-anchor`}>{tx("contentModel.integration.map.field.anchor")}</FieldLabel>
          <Select value={values.anchorId ?? NO_ANCHOR} disabled={!editable || !workspaceId} onValueChange={(value) => onChange({ anchorId: value === NO_ANCHOR ? null : value })}>
            <SelectTrigger id={`${id}-anchor`} className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ANCHOR}>{tx("contentModel.integration.map.field.anchorNone")}</SelectItem>
              {!anchorKnown && values.anchorId && <SelectItem value={values.anchorId}>{tx("contentModel.integration.map.field.anchorOther")}</SelectItem>}
              {anchors.map((anchor) => (
                <SelectItem key={anchor.id} value={anchor.id}>
                  <Anchor className="size-3 text-amber-600 dark:text-amber-400" aria-hidden />
                  {anchor.name || tx("contentModel.integration.map.anchors.unnamed")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{tx("contentModel.integration.map.field.anchorHint")}</p>
        </div>
        </PlacementFieldGroup>
      )}

      {(type === "model" || type === "text") && <PlacementFieldGroup title={tx("contentModel.integration.map.section.display")} invalid={problem === "scale" || problem === "textSize"} summary={type === "model" ? tx("contentModel.integration.map.section.scaleSummary", { scale: values.scale || "1" }) : `${values.textColor || tx("contentModel.integration.map.field.default")} · ${values.textSize || tx("contentModel.integration.map.field.default")}`}>
        <PlacementRenderFields type={type} values={values} editable={editable} problem={problem} onChange={onChange} />
      </PlacementFieldGroup>}

      <PlacementFieldGroup title={tx("contentModel.integration.map.section.tags")} summary={values.tagIds.length ? tags.filter((tag) => values.tagIds.includes(tag.id)).map((tag) => tag.name).join(" · ") || tx("contentModel.integration.map.section.tagCount", { count: values.tagIds.length }) : tx("contentModel.integration.map.section.noTags")}>
        <AssetTagEditor tagIds={values.tagIds} workspaceId={placement.workspace_id} isEditing={editable} onTagIdsChange={(tagIds) => onChange({ tagIds: [...tagIds].sort() })} />
      </PlacementFieldGroup>
    </div>
  );
}
