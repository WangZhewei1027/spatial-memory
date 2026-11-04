import { useTranslation } from "react-i18next";

interface AssetVideoPreviewProps {
  fileUrl: string;
  fileName: string;
  posterUrl?: string | null;
}

export function AssetVideoPreview({
  fileUrl,
  fileName: _fileName,
  posterUrl,
}: AssetVideoPreviewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        {t("assetEditor.preview.video")}
      </label>
      <div className="rounded-md border p-4 bg-muted/30">
        <video
          controls
          className="w-full max-h-64 rounded"
          preload="metadata"
          poster={posterUrl ?? undefined}
          playsInline
        >
          <source src={fileUrl} type="video/mp4" />
          <source src={fileUrl} type="video/webm" />
          <source src={fileUrl} type="video/quicktime" />
          {t("assetEditor.preview.videoNotSupported")}
        </video>
      </div>
      <p className="text-xs text-muted-foreground truncate">{fileUrl}</p>
    </div>
  );
}
