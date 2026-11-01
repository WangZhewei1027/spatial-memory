import { COMPOSITION_LIMITS } from "./legacy-scene-limits";
import { TRANSFORM_CHANNELS } from "../../lib/scene/protocol";
import { IssueList, rejectUnknownKeys, requireObject, requireNumberInRange, requireNumberTuple } from "../../lib/scene/validate-utils";

/** Validate the supported native Theatre subset at the existing save boundary.
 * No code, asset URLs, additional sheets or unbound objects can enter playback. */
export function validateTheatreState(issues: IssueList, raw: unknown, instances: Set<string>, duration: number | null) {
  const state = requireObject(issues, "content.theatre", raw);
  if (!state) return;
  const err = (message: string) => issues.error("content.theatre", message);
  rejectUnknownKeys(issues, "content.theatre", state, ["definitionVersion", "revisionHistory", "sheetsById"]);
  if (state.definitionVersion !== "0.4.0") err("不支持的 Theatre state 版本");
  if (!Array.isArray(state.revisionHistory) || state.revisionHistory.length > 50 || state.revisionHistory.some((id) => typeof id !== "string" || id.length > 128)) err("revisionHistory 无效");
  const sheets = requireObject(issues, "content.theatre.sheetsById", state.sheetsById);
  if (!sheets) return;
  rejectUnknownKeys(issues, "content.theatre.sheetsById", sheets, ["Scene"]);
  const sheet = requireObject(issues, "content.theatre.sheetsById.Scene", sheets.Scene);
  if (!sheet) return;
  rejectUnknownKeys(issues, "content.theatre.Scene", sheet, ["staticOverrides", "sequence"]);
  const overrides = requireObject(issues, "content.theatre.staticOverrides", sheet.staticOverrides);
  if (overrides) rejectUnknownKeys(issues, "content.theatre.staticOverrides", overrides, ["byObject"]);
  const objects = requireObject(issues, "content.theatre.byObject", overrides?.byObject);
  const valueRange = (channel: string) => channel.startsWith("scale.") ? { exclusiveMin: 0, max: 100 } : { min: -100, max: 100 };
  for (const [id, rawValues] of Object.entries(objects ?? {})) {
    if (!instances.has(id)) err(`未绑定的实例 ${id}`);
    const values = requireObject(issues, `content.theatre.${id}`, rawValues);
    if (!values) continue;
    rejectUnknownKeys(issues, `content.theatre.${id}`, values, ["position", "rotation", "scale"]);
    for (const [group, rawVector] of Object.entries(values)) {
      const vector = requireObject(issues, `content.theatre.${id}.${group}`, rawVector);
      if (!vector) continue;
      rejectUnknownKeys(issues, `content.theatre.${id}.${group}`, vector, ["x", "y", "z"]);
      for (const [axis, value] of Object.entries(vector)) requireNumberInRange(issues, `content.theatre.${id}.${group}.${axis}`, value, valueRange(`${group}.${axis}`));
    }
  }
  const sequence = requireObject(issues, "content.theatre.sequence", sheet.sequence);
  if (!sequence) return;
  rejectUnknownKeys(issues, "content.theatre.sequence", sequence, ["type", "length", "subUnitsPerUnit", "tracksByObject"]);
  if (sequence.type !== "PositionalSequence") err("仅支持 PositionalSequence");
  if (!requireNumberInRange(issues, "content.theatre.sequence.length", sequence.length, { exclusiveMin: 0, max: 600 }) || sequence.length !== duration) err("时长必须与 Theatre sequence.length 一致");
  if (!Number.isInteger(sequence.subUnitsPerUnit) || (sequence.subUnitsPerUnit as number) < 1 || (sequence.subUnitsPerUnit as number) > 1000) err("时间刻度无效");
  const tracks = requireObject(issues, "content.theatre.tracksByObject", sequence.tracksByObject);
  let count = 0;
  for (const [id, rawObject] of Object.entries(tracks ?? {})) {
    if (!instances.has(id)) err(`未绑定的轨道 ${id}`);
    const object = requireObject(issues, "content.theatre.tracksByObject", rawObject);
    if (!object) continue;
    rejectUnknownKeys(issues, "content.theatre.trackObject", object, ["trackIdByPropPath", "trackData"]);
    const paths = requireObject(issues, "content.theatre.paths", object.trackIdByPropPath);
    const data = requireObject(issues, "content.theatre.trackData", object.trackData);
    const used = new Set<string>();
    for (const [path, trackId] of Object.entries(paths ?? {})) {
      const channel = TRANSFORM_CHANNELS.find((channel) => JSON.stringify(channel.split(".")) === path);
      if (!channel || typeof trackId !== "string" || trackId.length > 128 || ["__proto__", "constructor", "prototype"].includes(trackId) || used.has(trackId)) { err("轨道绑定无效"); continue; }
      used.add(trackId);
      const track = requireObject(issues, "content.theatre.track", data?.[trackId]);
      if (!track) continue;
      rejectUnknownKeys(issues, "content.theatre.track", track, ["type", "keyframes", "__debugName"]);
      // Studio 0.7.2 exports this optional label; migrated/Core-only tracks omit it.
      if (track.__debugName !== undefined && (typeof track.__debugName !== "string" || track.__debugName.length > 128))
        issues.error("content.theatre.track.__debugName", "必须是不超过 128 字符的字符串");
      if (track.type !== "BasicKeyframedTrack" || !Array.isArray(track.keyframes)) { err("无效的关键帧轨道"); continue; }
      const ids = new Set<string>();
      let previous = -1;
      for (const frameRaw of track.keyframes) {
        count++;
        const frame = requireObject(issues, "content.theatre.keyframe", frameRaw);
        if (!frame) continue;
        rejectUnknownKeys(issues, "content.theatre.keyframe", frame, ["id", "position", "value", "handles", "connectedRight", "type"]);
        if (typeof frame.id !== "string" || !frame.id.length || frame.id.length > 128 || ids.has(frame.id)) err("关键帧 id 无效或重复");
        else ids.add(frame.id);
        // Theatre may keep keys beyond a shortened sequence; they are still editable.
        if (requireNumberInRange(issues, "content.theatre.keyframe.position", frame.position, { min: 0, max: 600 })) {
          if (frame.position <= previous) err("关键帧必须按时间递增");
          previous = frame.position;
        }
        requireNumberInRange(issues, "content.theatre.keyframe.value", frame.value, valueRange(channel));
        const handles = requireNumberTuple(issues, "content.theatre.keyframe.handles", frame.handles, 4);
        // Native curves support vertical overshoot. Horizontal handles must remain monotonic.
        if (handles && (handles[0] < 0 || handles[0] > 1 || handles[2] < 0 || handles[2] > 1 || handles.some((v) => Math.abs(v) > 100))) err("缓动控制点无效");
        if (typeof frame.connectedRight !== "boolean" || (frame.type !== undefined && frame.type !== "bezier" && frame.type !== "hold")) err("关键帧插值无效");
      }
    }
    if (Object.keys(data ?? {}).some((id) => !used.has(id))) err("存在未绑定的 trackData");
  }
  if (count > COMPOSITION_LIMITS.maxKeyframes) err("关键帧总数不能超过 2400");
}
