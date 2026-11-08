"use client";

import { CalendarDays, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePlacementStore } from "../../lib/placement-store";
import { MapActivities, type MapActivitiesProps } from "./MapActivities";

/** Activity management is independent of the map's content list and selection. */
export function MapActivitiesDialog(props: MapActivitiesProps) {
  const { t } = useTranslation();
  const open = usePlacementStore((state) => state.activitiesOpen);
  const setOpen = usePlacementStore((state) => state.setActivitiesOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><CalendarDays aria-hidden />{t("activities.title")}</Button>
      </DialogTrigger>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <div className="flex shrink-0 items-start gap-4 border-b px-5 py-4 sm:px-6">
          <DialogHeader className="min-w-0 flex-1 gap-1 text-start">
            <DialogTitle>{t("activities.title")}</DialogTitle>
            <DialogDescription className="truncate" title={props.workspaceName}>{props.workspaceName}</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="-me-2 -mt-1 size-11 shrink-0" aria-label={t("common.close")}><X aria-hidden /></Button>
          </DialogClose>
        </div>
        <MapActivities key={`${props.organizationId}:${props.workspaceId}`} {...props} />
      </DialogContent>
    </Dialog>
  );
}
