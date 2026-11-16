"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PhotoSlider } from "react-photo-view";
import { Expand, Upload, X } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import "react-photo-view/dist/react-photo-view.css";

interface AssetImagePreviewProps {
  fileUrl: string;
  fileName: string;
  /** Compact, unlabeled preview for an existing image section. */
  variant?: "default" | "thumbnail";
  isEditing?: boolean;
  /** 编辑模式下用户选择的待上传新图片 */
  newImageFile?: File | null;
  onFileSelect?: (file: File) => void;
  onFileRemove?: () => void;
}

export function AssetImagePreview({
  fileUrl,
  fileName,
  variant = "default",
  isEditing = false,
  newImageFile = null,
  onFileSelect,
  onFileRemove,
}: AssetImagePreviewProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!newImageFile) { setLocalUrl(null); return; }
    const url = URL.createObjectURL(newImageFile);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [newImageFile]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) onFileSelect?.(acceptedFiles[0]);
    },
    [onFileSelect],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: false,
    disabled: !isEditing,
  });

  // 优先显示本地选择的新图片
  const previewUrl = localUrl ?? fileUrl;
  const thumbnail = variant === "thumbnail";
  // Reference photos and local Blob replacements have arbitrary natural dimensions.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={previewUrl} alt={fileName} className={thumbnail ? "aspect-[4/3] w-full object-contain" : "max-h-64 w-full object-contain"} />;

  return (
    <div className="space-y-2">
      {!thumbnail && <div className="text-xs font-medium text-muted-foreground">
        {t("assetEditor.preview.image")}
      </div>}
      <div className="relative rounded-md border bg-muted/30">
        {isEditing ? image : <button
          ref={trigger}
          type="button"
          className="relative block w-full cursor-zoom-in overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("assetEditor.preview.openImage", { name: fileName })}
          aria-haspopup="dialog"
          onClick={() => setVisible(true)}
        >
          {image}
          <span className="pointer-events-none absolute bottom-2 start-2 rounded-sm bg-background/90 p-1.5 text-foreground"><Expand className="size-3.5" aria-hidden /></span>
        </button>}
        {isEditing && newImageFile && (
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={onFileRemove}
            aria-label={t("assetEditor.preview.removeImage")}
            type="button"
          >
            <X className="h-3 w-3" aria-hidden />
          </Button>
        )}
      </div>
      {isEditing && (
        <div
          {...getRootProps()}
          className={`border border-dashed rounded-md px-3 py-2 text-center cursor-pointer text-xs text-muted-foreground transition-colors ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-3.5 w-3.5 inline-block mr-1 align-text-bottom" />
          {t("assetEditor.preview.imageReplace")}
        </div>
      )}
      {!isEditing && (
        <Dialog open={visible} onOpenChange={setVisible}>
          <DialogContent
            ref={setPortalContainer}
            showCloseButton={false}
            aria-describedby={undefined}
            className="inset-0 h-dvh w-screen max-h-dvh max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 shadow-none data-[state=open]:!animate-none data-[state=closed]:!animate-none sm:max-w-none"
            onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); }}
          >
            <DialogTitle className="sr-only">{t("assetEditor.preview.openImage", { name: fileName })}</DialogTitle>
            {portalContainer && <PhotoSlider
              images={[{ src: fileUrl, key: fileUrl }]}
              visible={visible}
              onClose={() => setVisible(false)}
              index={0}
              portalContainer={portalContainer}
              bannerVisible={false}
              overlayRender={() => <Button autoFocus type="button" variant="secondary" size="icon" className="fixed end-4 top-4 z-20 size-11" aria-label={t("common.close")} onClick={() => setVisible(false)}><X aria-hidden /></Button>}
            />}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
