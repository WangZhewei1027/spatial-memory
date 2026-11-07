import { RefObject } from "react";

interface ViewerFrameProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  title?: string;
  organizationId?: string;
}

// The viewer is a static page; it learns where the Cesium build / 3D tiles
// live (object storage) and the optional 天地图 key from its own query string.
// See public/js/viewer/src/utils/config.js.
function viewerSrc(organizationId?: string): string {
  const params = new URLSearchParams();
  if (organizationId) params.set("organizationId", organizationId);
  const media = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  if (media) params.set("media", media);
  const tianditu = process.env.NEXT_PUBLIC_TIANDITU_KEY;
  if (tianditu) params.set("tdt", tianditu);
  const query = params.toString();
  return `/js/viewer/index.html${query ? `?${query}` : ""}`;
}

export function ViewerFrame({ iframeRef, title = "3D Viewer", organizationId }: ViewerFrameProps) {
  return (
    <div className="w-full h-full">
      <iframe
        ref={iframeRef}
        src={viewerSrc(organizationId)}
        className="w-full h-full border-0"
        title={title}
      />
    </div>
  );
}
