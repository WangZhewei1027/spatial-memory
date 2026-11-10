import { createHash } from "node:crypto";

/**
 * Opaque version of a recognition target's reference images, returned by
 * `candidates` and echoed back to `content`. Any change to the image list or
 * its order, or to the asset, yields a new version. A single image hashes
 * exactly as before multi-image support, so existing device caches stay valid.
 */
export function referenceVersion(urls: readonly string[], updatedAt: Date | string): string {
  const stamp = updatedAt instanceof Date ? String(updatedAt) : updatedAt;
  return createHash("sha256").update(`${urls.join("\n")}:${stamp}`).digest("hex");
}
