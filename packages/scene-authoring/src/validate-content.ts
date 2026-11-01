import {
  TRANSFORM_CHANNELS, AUTOMATION_CHANNELS,
} from "./protocol";
import {
  ALIAS_RE,
  IssueList,
  UUID_RE,
  rejectUnknownKeys,
  requireBoolean,
  requireNumberInRange,
  requireNumberTuple,
  requireObject,
} from "./validate-utils";
import { validatePresentation } from "./validate-presentation";

// Pure structure validation. Asset references are checked by service.server.ts;
// clip existence is checked by the player against the loaded model.

const INSTANCE_KEYS = ["id", "asset", "text", "timing", "media", "opacity", "name", "parent", "position", "rotation", "scale", "animation", "tracks"];
const GROUP_KEYS = ["id", "name", "parent", "position", "rotation", "scale", "tracks"];
const ANIMATION_KEYS = ["clipIndex", "clipName", "startSeconds", "loop"];

interface ParsedAnimation {
  clipIndex?: number;
  clipName?: string;
  startSeconds: number;
  loop: boolean;
}

function validateAnimation(
  issues: IssueList,
  path: string,
  value: unknown,
): ParsedAnimation | null {
  const anim = requireObject(issues, path, value);
  if (!anim) return null;
  rejectUnknownKeys(issues, path, anim, ANIMATION_KEYS);
  const hasIndex = anim.clipIndex !== undefined;
  const hasName = anim.clipName !== undefined;
  if (hasIndex === hasName) {
    issues.error(path, "clipIndex 与 clipName 必须二选一");
  }
  if (hasIndex && (!Number.isInteger(anim.clipIndex) || (anim.clipIndex as number) < 0)) {
    issues.error(`${path}.clipIndex`, "必须是 ≥ 0 的整数");
  }
  if (hasName && (typeof anim.clipName !== "string" || anim.clipName.length === 0)) {
    issues.error(`${path}.clipName`, "必须是非空字符串");
  }
  const startOk = requireNumberInRange(issues, `${path}.startSeconds`, anim.startSeconds, {
    min: 0,
  });
  const loopOk = requireBoolean(issues, `${path}.loop`, anim.loop);
  if (!startOk || !loopOk) return null;
  return {
    clipIndex: hasIndex ? (anim.clipIndex as number) : undefined,
    clipName: hasName ? (anim.clipName as string) : undefined,
    startSeconds: anim.startSeconds as number,
    loop: anim.loop as boolean,
  };
}

export function validateCompositionContent(
  issues: IssueList,
  content: Record<string, unknown>,
  options: { groups: boolean; presentation?: boolean; automation?: boolean; visibility?: boolean; viewerPosition?: boolean } = { groups: true, presentation: true, automation: true, visibility: true, viewerPosition: true },
): void {
  rejectUnknownKeys(issues, "content", content, [
    "kind",
    "units",
    "durationSeconds",
    "loop",
    "assets",
    "instances",
    "groups",
    "viewerPosition",
  ]);
  if (content.units !== "meters") issues.error("content.units", '必须是 "meters"');
  requireBoolean(issues, "content.loop", content.loop);
  if (content.viewerPosition !== undefined) {
    if (!options.viewerPosition) issues.error("content.viewerPosition", "观察位置需要 schemaVersion 9 播放清单");
    if (requireNumberTuple(issues, "content.viewerPosition", content.viewerPosition, 3)) {
      const [x, , z] = content.viewerPosition as number[];
      if (x === 0 && z === 0) issues.error("content.viewerPosition", "观察位置的水平距离必须大于 0");
    }
  }

  // assets: alias → { assetId }
  const aliasToAssetId = new Map<string, string>();
  const assets = requireObject(issues, "content.assets", content.assets);
  if (assets) {
    const entries = Object.entries(assets);
    for (const [alias, ref] of entries) {
      const path = `content.assets.${alias}`;
      if (!ALIAS_RE.test(alias)) issues.error(path, "别名必须以字母开头，只含字母、数字、_、-，最长 32");
      const obj = requireObject(issues, path, ref);
      if (!obj) continue;
      rejectUnknownKeys(issues, path, obj, ["assetId"]);
      if (typeof obj.assetId !== "string" || !UUID_RE.test(obj.assetId)) {
        issues.error(`${path}.assetId`, "必须是素材 UUID");
        continue;
      }
      aliasToAssetId.set(alias, obj.assetId);
    }
  }

  // durationSeconds: finite > 0, or null only for static scenes
  const duration = content.durationSeconds;
  let durationValue: number | null = null;
  if (duration === null) {
    durationValue = null;
  } else if (
    requireNumberInRange(issues, "content.durationSeconds", duration, {
      exclusiveMin: 0,
    })
  ) {
    durationValue = duration;
  }

  // instances
  if (!Array.isArray(content.instances)) {
    issues.error("content.instances", "必须是数组");
    return;
  }
  const instances = content.instances as unknown[];
  const seenIds = new Set<string>();
  const nodeId = (path: string, id: unknown) => {
    if (typeof id !== "string" || (!ALIAS_RE.test(id) || ["constructor", "prototype", "__proto__"].includes(id))) {
      issues.error(`${path}.id`, "id 必须以字母开头，只含字母、数字、_、-，最长 32");
    } else if (seenIds.has(id)) {
      issues.error(`${path}.id`, `id "${id}" 重复`);
    } else {
      seenIds.add(id);
    }
  };
  const nodeName = (path: string, name: unknown) => {
    if (typeof name !== "string" || !name.trim())
      issues.error(`${path}.name`, "名称必须是非空字符串");
  };
  let anyAnimation = false;
  const transform = (path: string, node: Record<string, unknown>, scalarTracks = false) => {
    requireNumberTuple(issues, `${path}.position`, node.position, 3);
    requireNumberTuple(issues, `${path}.rotation`, node.rotation, 3);
    if (node.tracks !== undefined) {
      const tracks = requireObject(issues, `${path}.tracks`, node.tracks);
      if (tracks) {
        rejectUnknownKeys(issues, `${path}.tracks`, tracks, scalarTracks ? AUTOMATION_CHANNELS : TRANSFORM_CHANNELS);
        for (const [channel, frames] of Object.entries(tracks)) {
          const at = `${path}.tracks.${channel}`;
          if (!Array.isArray(frames) || frames.length === 0) { issues.error(at, "关键帧必须是非空数组"); continue; }
          anyAnimation = true;
          let previous = -1;
          frames.forEach((raw, i) => {
            const fp = `${at}[${i}]`, frame = requireObject(issues, fp, raw);
            if (!frame) return;
            rejectUnknownKeys(issues, fp, frame, ["time", "value", "handles", "connectedRight"]);
            if (requireNumberInRange(issues, `${fp}.time`, frame.time, { min: 0 })) {
              if (frame.time <= previous) issues.error(`${fp}.time`, "关键帧时间必须严格递增");
              previous = frame.time;
            }
            requireNumberInRange(issues, `${fp}.value`, frame.value, channel === "opacity" || channel === "volume" ? { min: 0, max: 1 } : channel.startsWith("scale.") ? { exclusiveMin: 0 } : {});
            const handles = requireNumberTuple(issues, `${fp}.handles`, frame.handles, 4);
            if (handles && (handles[0] < 0 || handles[0] > 1 || handles[2] < 0 || handles[2] > 1)) issues.error(`${fp}.handles`, "曲线横向控制点必须在 0–1 之间");
            requireBoolean(issues, `${fp}.connectedRight`, frame.connectedRight);
          });
        }
      }
    }
    const scale = requireNumberTuple(issues, `${path}.scale`, node.scale, 3);
    if (scale && scale.some((v) => v <= 0)) {
      issues.error(`${path}.scale`, "每个分量必须大于 0");
    }
  };

  // groups: transform parents; references are checked once every ID is known.
  const parents = new Map<string, unknown>(), groupPaths = new Map<string, string>();
  if (content.groups !== undefined) {
    if (!options.groups) issues.error("content.groups", "该版本不支持分组");
    else if (!Array.isArray(content.groups)) issues.error("content.groups", "必须是数组");
    else {
      (content.groups as unknown[]).forEach((raw, index) => {
        const path = `content.groups[${index}]`;
        const group = requireObject(issues, path, raw);
        if (!group) return;
        rejectUnknownKeys(issues, path, group, options.visibility ? [...GROUP_KEYS, 'hidden'] : GROUP_KEYS);
        if (group.hidden !== undefined) requireBoolean(issues, `${path}.hidden`, group.hidden);
        nodeId(path, group.id);
        nodeName(path, group.name);
        transform(path, group);
        if (typeof group.id === "string") { parents.set(group.id, group.parent); groupPaths.set(group.id, path); }
      });
    }
  }
  const checkParent = (path: string, parent: unknown) => {
    if (parent === undefined) return;
    if (!options.groups) issues.error(`${path}.parent`, "该版本不支持分组");
    else if (typeof parent !== "string" || !parents.has(parent)) issues.error(`${path}.parent`, "引用的分组不存在");
  };
  for (const [id, parent] of parents) {
    const path = groupPaths.get(id)!;
    checkParent(path, parent);
    const visited = new Set([id]);
    for (let at = parent; typeof at === "string" && parents.has(at); at = parents.get(at)) {
      if (visited.has(at)) { issues.error(`${path}.parent`, "分组不能循环引用"); break; }
      visited.add(at);
    }
  }

  instances.forEach((raw, index) => {
    const path = `content.instances[${index}]`;
    const inst = requireObject(issues, path, raw);
    if (!inst) return;
    rejectUnknownKeys(issues, path, inst, options.visibility ? [...INSTANCE_KEYS, 'hidden'] : INSTANCE_KEYS);
    if (inst.hidden !== undefined) requireBoolean(issues, `${path}.hidden`, inst.hidden);
    nodeId(path, inst.id);
    if (inst.name !== undefined) nodeName(path, inst.name);
    checkParent(path, inst.parent);
    if (inst.text === undefined && (typeof inst.asset !== "string" || !aliasToAssetId.has(inst.asset))) {
      issues.error(`${path}.asset`, "引用的资源别名不存在");
    }
    validatePresentation(issues, path, inst, options.presentation === true, options.automation === true);
    if (inst.timing !== undefined || inst.media !== undefined) anyAnimation = true;
    transform(path, inst, options.automation === true);
    if (inst.animation === null) return;
    if (inst.animation === undefined) {
      issues.error(`${path}.animation`, "必须显式写 null 或动画对象");
      return;
    }
    const anim = validateAnimation(issues, `${path}.animation`, inst.animation);
    anyAnimation = true;
    if (!anim) return;
    if (durationValue !== null && anim.startSeconds >= durationValue) {
      issues.error(`${path}.animation.startSeconds`, "必须小于 durationSeconds");
    }
  });
  if (duration === null && anyAnimation) {
    issues.error("content.durationSeconds", "有实例带动画时必须设置 durationSeconds");
  }
}
