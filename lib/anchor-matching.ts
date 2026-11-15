/** Shared recognition request validation. No browser or server dependencies. */
export const MAX_MATCH_IMAGE_BYTES = 4 * 1024 * 1024;
export class MatchingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function finiteNumber(
  value: unknown,
  min: number,
  max: number,
  name: string,
): number {
  if (typeof value !== "number" && typeof value !== "string")
    throw new MatchingError(`Invalid ${name}`);
  if (typeof value === "string" && !value.trim())
    throw new MatchingError(`Missing ${name}`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max)
    throw new MatchingError(`Invalid ${name}`);
  return result;
}
export function requireUuid(value: unknown, name = "workspace_id"): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new MatchingError(`Invalid ${name}`);
  return value;
}
export function parseGps(form: FormData, now = Date.now()) {
  if (form.get("coordinate_system") !== "wgs84")
    throw new MatchingError("coordinate_system must be wgs84");
  const latitude = finiteNumber(form.get("latitude"), -90, 90, "latitude");
  const longitude = finiteNumber(form.get("longitude"), -180, 180, "longitude");
  const accuracy = finiteNumber(
    form.get("accuracy"),
    0,
    100,
    "accuracy (0–100 metres)",
  );
  const timestamp = finiteNumber(
    form.get("gps_timestamp"),
    now - 30000,
    now + 5000,
    "gps_timestamp (fresh Unix milliseconds)",
  );
  return {
    latitude,
    longitude,
    accuracy,
    timestamp,
    radius: Math.min(200, Math.max(75, accuracy * 2)),
  };
}
