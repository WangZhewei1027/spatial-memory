"use client";

import Image from "next/image";
import { MapPin, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ActivityDto } from "@/lib/activities/contracts";
import { CrossOrganizationDuplicateButton } from "../CrossOrganizationDuplicate";
import { ContentStatusBadge } from "../../content/ContentStatusBadge";
import { LibraryCard } from "../../content/LibraryCard";
import { useContentFormat } from "../../content/useContentFormat";

export function ActivityCard({ activity, href }: { activity: ActivityDto; href: string }) {
  const { t } = useTranslation();
  const format = useContentFormat();
  const Icon = activity.type === "shop_checkin" ? MapPin : MessageSquare;
  const cover = activity.type === "shop_checkin"
    ? activity.points.find(point => point.state === "active" && point.image_url)?.image_url
    : null;
  return (
    <LibraryCard
      name={activity.name}
      href={href}
      target="_blank"
      description={activity.description ?? undefined}
      thumbnail={<span className={`flex size-full items-center justify-center ${activity.state === "archived" ? "opacity-60" : ""}`}>
        {cover ? <Image src={cover} alt="" width={384} height={288} unoptimized className="size-full object-cover" />
          : <Icon className="size-8 text-muted-foreground" aria-hidden />}
      </span>}
      metadata={<>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {t(`activities.types.${activity.type}`)}
        </span>
        <time dateTime={activity.updated_at} className="whitespace-nowrap tabular-nums">{format.date(activity.updated_at)}</time>
      </>}
      badges={activity.state === "archived" && <ContentStatusBadge kind="archived" />}
      actions={<CrossOrganizationDuplicateButton sourceType="activity" sourceId={activity.id} sourceOrganizationId={activity.organization_id} name={activity.name} archived={activity.state === "archived"} iconOnly />}
    />
  );
}
