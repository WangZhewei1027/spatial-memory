"use client";
import { useEffect, useRef, useState } from "react";
import { QrCode } from "lucide-react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { subscribeContentChanges } from "@/app/manage/lib/content-events";
import { composeWeChatQr } from "@/lib/wechat-qr-composition";

export interface WeChatQrButtonProps {
  label: string;
  title: string;
  description?: string;
  load: () => Promise<{ url?: string; centerImageUrl?: string | null; error?: string }>;
  /** An overlay host in the same document and theme as the trigger. */
  portalContainer?: HTMLElement | null;
}
/** Props-only QR display. Context wrappers key this component to cancel stale requests. */
export function WeChatQrButton({ label, title, description, load, portalContainer }: WeChatQrButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<{ src: string; custom?: boolean; fallback?: boolean }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const dismissedInViewport = useRef(false);
  useEffect(() => {
    if (!open || !portalContainer || portalContainer.ownerDocument === document) return;
    // Events in the editor iframe do not bubble to the portalled popover's document.
    const close = () => { dismissedInViewport.current = true; setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open, portalContainer]);
  useEffect(() => {
    if (open) return subscribeContentChanges(() => setAttempt((value) => value + 1));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(undefined);
    setImage(undefined);
    load().then(async ({ url, centerImageUrl, error }) => {
      if (cancelled) return;
      if (!url) {
        setError(error || t("workspace.qrError"));
        return;
      }
      if (!centerImageUrl) {
        setImage({ src: url });
        return;
      }
      try {
        const png = await composeWeChatQr(url, centerImageUrl);
        if (!cancelled) setImage({ src: png, custom: true });
      } catch {
        if (!cancelled) setImage({ src: url, fallback: true });
      }
    }).catch(() => { if (!cancelled) setError(t("workspace.qrError")); });
    return () => { cancelled = true; };
  }, [open, load, attempt, t]);

  const retry = () => setAttempt((value) => value + 1);

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label={label} title={label}><QrCode className="size-4" /></Button></PopoverTrigger>
    <PopoverContent ref={contentRef} portalContainer={portalContainer} aria-label={title} align="end" sideOffset={10} collisionPadding={12} className="w-72 max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-4" onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.focus(); }} onCloseAutoFocus={(event) => { if (dismissedInViewport.current) event.preventDefault(); dismissedInViewport.current = false; }}>
      <div className="flex flex-col items-center gap-2">
        <Text as="p" variant="bodySm" fontWeight="medium" alignment="center">{title}</Text>
        {description && <Text as="p" variant="bodySm" tone="subdued">{description}</Text>}
        {error ? (
          <>
            <Text as="p" variant="bodySm" tone="critical" role="alert" breakWord>{error}</Text>
            <Button size="sm" variant="outline" onClick={retry}>{t("contentModel.action.retry")}</Button>
          </>
        ) : image ? (
          <>
            <QrImage key={image.src} src={image.src} label={label} onError={() => setError(t("workspace.qrError"))} />
            {image.custom && (
              <Button asChild size="sm" variant="outline">
                <a href={image.src} download="wechat-qr.png">{t("admin.settings.wechatQr.center.download")}</a>
              </Button>
            )}
            {image.fallback && (
              <>
                <Text as="p" variant="bodySm" tone="critical" role="alert">{t("admin.settings.wechatQr.center.compositionError")}</Text>
                <Button size="sm" variant="outline" onClick={retry}>{t("contentModel.action.retry")}</Button>
              </>
            )}
          </>
        ) : <Skeleton className="aspect-square w-56 max-w-full" />}
      </div>
    </PopoverContent>
  </Popover>;
}

function QrImage({ src, label, onError }: { src: string; label: string; onError: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <Skeleton className="aspect-square w-56 max-w-full" />}
      <Image src={src} alt={label} width={224} height={224} unoptimized loading="eager"
        onLoad={() => setLoaded(true)} onError={onError}
        className={loaded ? "h-auto w-56 max-w-full rounded" : "hidden"}
      />
    </>
  );
}
