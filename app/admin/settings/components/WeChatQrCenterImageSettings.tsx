"use client";

import { useEffect, useId, useRef, useState } from "react";
import { QrCode } from "lucide-react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/typography";
import { contentRequest, isContentApiError, isLockConflict, uploadReceipt } from "@/app/manage/lib/content-api";
import { useUploadStageText } from "@/app/manage/lib/upload-stage-text";
import { publicObjectUrl } from "@/lib/assets/urls";
import type { UploadStage } from "@/lib/upload/progress";

const FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CROP_SIZE = 192;

export function WeChatQrCenterImageSettings({ organizationId, savedKey, onSaved }: {
  organizationId: string;
  savedKey: string | null;
  onSaved: (key: string | null) => void;
}) {
  const { t } = useTranslation();
  const uploadStageText = useUploadStageText();
  const id = useId();
  const savedImage = savedKey ? publicObjectUrl(savedKey) : null;
  const [stage, setStage] = useState<UploadStage | "saving" | null>(null);
  const saving = stage !== null;
  const operation = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<HTMLImageElement | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const request = useRef(0);

  useEffect(() => () => { request.current++; operation.current?.abort(); }, []);

  async function selectFile(file: File) {
    const selection = ++request.current;
    setDraft(null);
    setError("");
    if ((file.type && !FILE_TYPES.includes(file.type)) || file.size > MAX_FILE_BYTES) {
      setError("invalidFile");
      setReading(false);
      return;
    }

    setReading(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      if (request.current === selection) setDraft(image);
    } catch {
      if (request.current === selection) setError("invalidFile");
    } finally {
      URL.revokeObjectURL(url);
      if (request.current === selection) setReading(false);
    }
  }

  function closeCrop() {
    setDraft(null);
    setError("");
    choose.current?.focus();
  }

  async function saveImage(canvas: HTMLCanvasElement | null) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setStage(canvas ? "preparing" : "saving");
    setError("");
    try {
      let receiptId: string | null = null;
      if (canvas) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (signal.aborted) return;
        if (!blob) {
          setError("cropError");
          return;
        }
        const file = new File([blob], "wechat-qr-center.png", { type: blob.type });
        const receipt = await uploadReceipt(file, {
          organizationId, type: "image", signal,
          onStage: (next) => { if (!signal.aborted) setStage(next); },
        });
        if (signal.aborted) return;
        setStage("saving");
        receiptId = receipt.id;
      }
      const { data } = await contentRequest<{ data: { key: string | null } }>(
        `/api/organizations/${organizationId}/wechat-qr-center-image`,
        { method: "PUT", body: { receiptId, expectedKey: savedKey }, signal },
      );
      if (signal.aborted) return;
      onSaved(data.key);
      closeCrop();
    } catch (cause) {
      if (signal.aborted) return;
      if (canvas && isContentApiError(cause) && cause.status === 429) setError("uploadBusy");
      else setError(isLockConflict(cause) ? "conflict" : "storageError");
    } finally {
      operation.current = null;
      if (!signal.aborted) setStage(null);
    }
  }

  return (
    <fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-3 border-t pt-4" aria-labelledby={id}>
      <Text as="h3" variant="bodySm" fontWeight="medium" id={id}>
        {t("admin.settings.wechatQr.center.title")}
      </Text>
      <div className="flex items-center gap-3">
        {savedImage ? (
          <Image src={savedImage} alt="" width={40} height={40} unoptimized className="size-10 rounded-full border" />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <QrCode className="size-5" aria-hidden="true" />
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Text as="span" variant="bodySm" tone="subdued" role="status">
            {t(`admin.settings.wechatQr.center.${savedImage ? "custom" : "default"}`)}
          </Text>
          <Button ref={choose} type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            {t(`admin.settings.wechatQr.center.${savedImage ? "replace" : "choose"}`)}
          </Button>
          {savedImage && !draft && (
            <Button type="button" variant="ghost" size="sm" onClick={() => saveImage(null)}>
              {t("admin.settings.wechatQr.center.reset")}
            </Button>
          )}
        </div>
        <input ref={input} type="file" accept={FILE_TYPES.join(",")} hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void selectFile(file);
        }} />
      </div>
      {draft ? (
        <div inert={saving}>
          <CircleCrop image={draft} onApply={saveImage} onCancel={closeCrop} onError={() => setError("cropError")} />
        </div>
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          {t(`admin.settings.wechatQr.center.${reading ? "reading" : "description"}`)}
        </Text>
      )}
      {stage && <Text as="p" variant="bodySm" tone="subdued" role="status">
        {stage === "saving" ? t("admin.settings.wechatQr.center.saving") : uploadStageText(stage)}
      </Text>}
      {error && <Text as="p" variant="bodySm" tone="critical" role="alert">{t(`admin.settings.wechatQr.center.${error}`)}</Text>}
    </fieldset>
  );
}

function CircleCrop({ image, onApply, onCancel, onError }: {
  image: HTMLImageElement;
  onApply: (canvas: HTMLCanvasElement) => void;
  onCancel: () => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const cropSide = Math.min(width, height) / zoom;
  const limitX = (width - cropSide) / 2;
  const limitY = (height - cropSide) / 2;

  function moveCrop(dx: number, dy: number) {
    setOffset(({ x, y }) => ({
      x: Math.max(-limitX, Math.min(limitX, x + dx * cropSide)),
      y: Math.max(-limitY, Math.min(limitY, y + dy * cropSide)),
    }));
  }

  useEffect(() => { viewport.current?.focus(); }, []);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "white";
    context.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    context.drawImage(image, limitX - offset.x, limitY - offset.y, cropSide, cropSide, 0, 0, CROP_SIZE, CROP_SIZE);
  }, [image, limitX, limitY, offset, cropSide]);

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
      <div
        ref={viewport}
        role="group"
        tabIndex={0}
        aria-label={t("admin.settings.wechatQr.center.crop")}
        aria-describedby={`${id}-hint`}
        className="aspect-square w-40 max-w-full shrink-0 touch-none cursor-grab overflow-hidden rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (!pointer.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const size = event.currentTarget.clientWidth;
          moveCrop((event.clientX - pointer.current.x) / size, (event.clientY - pointer.current.y) / size);
          pointer.current = { x: event.clientX, y: event.clientY };
        }}
        onLostPointerCapture={() => { pointer.current = null; }}
        onKeyDown={(event) => {
          const steps: Record<string, [number, number]> = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] };
          const step = steps[event.key];
          if (!step) return;
          event.preventDefault();
          moveCrop(...step);
        }}
      >
        <canvas ref={canvas} width={CROP_SIZE} height={CROP_SIZE} className="block size-full" aria-hidden="true" />
      </div>
      <div className="w-full max-w-xs min-w-0 space-y-3">
        <Text as="p" variant="bodySm" tone="subdued" id={`${id}-hint`}>
          {t("admin.settings.wechatQr.center.cropHint")}
        </Text>
        <div className="space-y-1">
          <Label htmlFor={id}>{t("admin.settings.wechatQr.center.zoom")}</Label>
          <input id={id} type="range" min={1} max={3} step={0.05} value={zoom}
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            className="block h-6 w-full cursor-pointer accent-primary focus-visible:outline-ring"
            onChange={(event) => {
              const nextZoom = event.currentTarget.valueAsNumber;
              const nextSide = Math.min(width, height) / nextZoom;
              const nextLimitX = (width - nextSide) / 2;
              const nextLimitY = (height - nextSide) / 2;
              setZoom(nextZoom);
              setOffset(({ x, y }) => ({
                x: Math.max(-nextLimitX, Math.min(nextLimitX, x)),
                y: Math.max(-nextLimitY, Math.min(nextLimitY, y)),
              }));
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => {
            try {
              if (!canvas.current?.getContext("2d")) throw new Error("Canvas unavailable");
              onApply(canvas.current);
            } catch {
              onError();
            }
          }}>{t("admin.settings.wechatQr.center.apply")}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        </div>
      </div>
    </div>
  );
}
