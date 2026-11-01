export type LinkAssetType = "figma" | "iframe" | "url";

export interface LinkAssetData {
  originalUrl: string;
  previewUrl: string;
  linkType: LinkAssetType;
}

export type LinkAssetParseErrorCode =
  | "empty"
  | "iframe_missing_src"
  | "invalid_url"
  | "unsupported_protocol";

export class LinkAssetParseError extends Error {
  readonly code: LinkAssetParseErrorCode;

  constructor(code: LinkAssetParseErrorCode) {
    super(code);
    this.name = "LinkAssetParseError";
    this.code = code;
  }
}

interface LinkTransformRule {
  type: LinkAssetType;
  matches: (url: URL) => boolean;
  toPreviewUrl: (url: URL) => string;
}

const FIGMA_EMBED_PATHS = new Set([
  "board",
  "deck",
  "design",
  "file",
  "proto",
  "slides",
]);

function isFigmaHost(hostname: string): boolean {
  return hostname === "figma.com" || hostname.endsWith(".figma.com");
}

function isFigmaEmbedUrl(url: URL): boolean {
  return (
    url.hostname === "embed.figma.com" ||
    (isFigmaHost(url.hostname) && url.pathname.startsWith("/embed"))
  );
}

function canConvertFigmaUrl(url: URL): boolean {
  if (!isFigmaHost(url.hostname) || isFigmaEmbedUrl(url)) return false;
  const firstPathSegment = url.pathname.split("/").filter(Boolean)[0];
  return FIGMA_EMBED_PATHS.has(firstPathSegment ?? "");
}

function withFigmaEmbedHost(url: URL): string {
  const previewUrl = new URL(url.href);
  if (
    previewUrl.hostname === "embed.figma.com" &&
    !previewUrl.searchParams.has("embed-host")
  ) {
    previewUrl.searchParams.set("embed-host", "spatial-memory");
  }
  return previewUrl.href;
}

/**
 * Link rules are deliberately data-driven so another provider can be added
 * without changing the input parsing or security checks.
 */
const LINK_TRANSFORM_RULES: LinkTransformRule[] = [
  {
    type: "figma",
    matches: (url) => isFigmaEmbedUrl(url),
    toPreviewUrl: (url) => withFigmaEmbedHost(url),
  },
  {
    type: "figma",
    matches: (url) => canConvertFigmaUrl(url),
    toPreviewUrl: (url) => {
      const previewUrl = new URL(url.href);
      previewUrl.protocol = "https:";
      previewUrl.hostname = "embed.figma.com";
      previewUrl.port = "";
      return withFigmaEmbedHost(previewUrl);
    },
  },
];

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'");
}

function extractIframeSrc(input: string): string | null {
  const match = input.match(
    /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
  );
  return match
    ? decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "")
    : null;
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LinkAssetParseError("invalid_url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LinkAssetParseError("unsupported_protocol");
  }

  return url;
}

export function parseLinkAssetInput(input: string): LinkAssetData {
  const trimmedInput = input.trim();
  if (!trimmedInput) throw new LinkAssetParseError("empty");

  const isIframeInput = /^<iframe\b/i.test(trimmedInput);
  const source = isIframeInput ? extractIframeSrc(trimmedInput) : trimmedInput;
  if (isIframeInput && !source) {
    throw new LinkAssetParseError("iframe_missing_src");
  }

  const originalUrl = parseHttpUrl(decodeHtmlEntities(source ?? "")).href;
  const parsedUrl = new URL(originalUrl);
  const matchingRule = LINK_TRANSFORM_RULES.find((rule) =>
    rule.matches(parsedUrl),
  );

  if (matchingRule) {
    return {
      originalUrl,
      previewUrl: matchingRule.toPreviewUrl(parsedUrl),
      linkType: matchingRule.type,
    };
  }

  return {
    originalUrl,
    previewUrl: originalUrl,
    linkType: isIframeInput ? "iframe" : "url",
  };
}

export function getLinkAssetErrorKey(error: unknown): string {
  if (!(error instanceof LinkAssetParseError)) {
    return "linkAsset.errors.invalidUrl";
  }

  const keys: Record<LinkAssetParseErrorCode, string> = {
    empty: "linkAsset.errors.empty",
    iframe_missing_src: "linkAsset.errors.iframeMissingSrc",
    invalid_url: "linkAsset.errors.invalidUrl",
    unsupported_protocol: "linkAsset.errors.unsupportedProtocol",
  };
  return keys[error.code];
}
