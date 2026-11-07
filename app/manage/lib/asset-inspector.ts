/** Local inspector navigation keeps the library mounted, including filters and scroll. */
export const ASSET_INSPECTOR_PARAM = "assetId";

export function openAssetInspector(assetId: string) {
  const url = new URL(window.location.href);
  if (!/^\/manage\/assets\/?$/.test(url.pathname)) return;
  const replacing = url.searchParams.has(ASSET_INSPECTOR_PARAM);
  url.searchParams.set(ASSET_INSPECTOR_PARAM, assetId);
  if (replacing) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function closeAssetInspector() {
  const url = new URL(window.location.href);
  const assetId = url.searchParams.get(ASSET_INSPECTOR_PARAM);
  url.searchParams.delete(ASSET_INSPECTOR_PARAM);
  window.history.replaceState(null, "", url);
  requestAnimationFrame(() => document.getElementById(`library-asset-${assetId}`)?.focus({ preventScroll: true }));
}
