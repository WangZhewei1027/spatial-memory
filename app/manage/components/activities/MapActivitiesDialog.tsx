"use client";

import Link from "next/link";
import { CalendarDays, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePlacementStore } from "../../lib/placement-store";
import { teamHref } from "../../lib/content-context";
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
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3 sm:px-6">
          <DialogHeader className="min-w-0 text-start">
            <DialogTitle>{t("activities.title")}</DialogTitle>
            <DialogDescription className="sr-only">{props.workspaceName}</DialogDescription>
          </DialogHeader>
          <Button variant="ghost" size="icon" asChild className="size-10 shrink-0">
            <Link href={teamHref("/manage/activities", props.organizationId)} target="_blank" rel="noopener noreferrer" aria-label={t("activities.manage")} title={t("activities.manage")}><ExternalLink aria-hidden /></Link>
          </Button>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="-me-2 ms-auto size-11 shrink-0" aria-label={t("common.close")}><X aria-hidden /></Button>
          </DialogClose>
        </div>
        <MapActivities key={`${props.organizationId}:${props.workspaceId}`} {...props} />
      </DialogContent>
    </Dialog>
  );
}
