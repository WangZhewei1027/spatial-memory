import Image from "next/image";
import { Clapperboard, ImageIcon } from "lucide-react";
import type { TemplateCard } from "@/lib/content-model/template-contracts";

export function TemplateCover({ template, name }: { template: TemplateCard; name: string }) {
  const Icon = template.type === "scene" ? Clapperboard : ImageIcon;
  const media = template.thumbnail;
  if (media?.kind === "image") {
    return <Image src={media.url} alt="" fill sizes="(max-width: 640px) 50vw, 200px" unoptimized className="object-cover" />;
  }
  if (media?.kind === "video") {
    return <video src={media.url} autoPlay loop muted playsInline aria-label={name} className="pointer-events-none size-full object-contain" />;
  }
  return <Icon aria-hidden className="size-8 text-muted-foreground" />;
}
