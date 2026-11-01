import "server-only";
import OSS from "ali-oss";
import { mediaUrl } from "./public-url";

// Server-side object storage on Aliyun OSS (replaces Supabase Storage).
// Credentials come from the configured RAM user (ALIBABA_CLOUD_ACCESS_KEY_*,
// shared with the SMS client). The bucket is public-read; URLs are built by
// lib/storage/public-url.ts, never by the SDK (which would point at the raw
// bucket endpoint instead of the media domain).

export { mediaUrl, mediaKeyFromUrl, assetKeyFromUrl, ASSETS_PREFIX, WECHAT_QR_PREFIX } from "./public-url";

let client: OSS | null = null;

function getClient(): OSS {
  if (client) return client;
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;
  if (!bucket || !region) throw new Error("OSS_BUCKET / OSS_REGION are not set");
  client = new OSS({
    region,
    bucket,
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID!,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET!,
    secure: true,
    // Same-region servers reach OSS over the free internal endpoint.
    internal: process.env.OSS_INTERNAL === "true",
    timeout: 60_000,
  });
  return client;
}

export interface PutObjectOptions {
  contentType: string;
  /** Defaults to one year immutable — upload keys are unique per content. */
  cacheControl?: string;
}

/** Upload a buffer and return its public URL. */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  options: PutObjectOptions,
): Promise<string> {
  await getClient().put(key, Buffer.from(body), {
    headers: {
      "Content-Type": options.contentType,
      "Cache-Control": options.cacheControl ?? "public, max-age=31536000, immutable",
    },
  });
  return mediaUrl(key);
}

/** Delete up to any number of keys (batched by 1000, the OSS limit). */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await getClient().deleteMulti(batch, { quiet: true });
  }
}

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
}

/** Metadata of one object, or null when it does not exist. */
export async function headObject(key: string): Promise<ObjectInfo | null> {
  try {
    const res = await getClient().head(key);
    const headers = res.res.headers as Record<string, string | undefined>;
    return {
      key,
      size: Number(headers["content-length"] ?? 0),
      lastModified: new Date(headers["last-modified"] ?? 0),
      contentType: headers["content-type"],
    };
  } catch (err) {
    if ((err as { code?: string }).code === "NoSuchKey") return null;
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** Iterate every object under a prefix. */
export async function* listObjects(prefix: string): AsyncGenerator<ObjectInfo> {
  let token: string | undefined;
  do {
    const res = await getClient().listV2({
      prefix,
      "max-keys": "1000",
      "continuation-token": token,
    });
    for (const obj of res.objects ?? []) {
      yield {
        key: obj.name,
        size: obj.size,
        lastModified: new Date(obj.lastModified),
      };
    }
    token = res.nextContinuationToken || undefined;
  } while (token);
}

/** Read an object into memory (server-side only, e.g. anchor reference images). */
export async function getObject(key: string): Promise<Buffer> {
  const res = await getClient().get(key);
  return res.content as Buffer;
}
