/** The server checks team access. Missing context, failures and non-booleans stay off. */
export async function isMapScanModelEnabled() {
  const organizationId = new URLSearchParams(window.location.search).get("organizationId");
  if (!organizationId) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/map-scan-model`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.data?.enabled === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
