import { COMPOSITION_LIMITS } from "../legacy-scene-limits";
import {
} from "../../../lib/scene/protocol";
import { validateTracks } from "../../../lib/scene/validate-tracks";
import {
  ALIAS_RE,
  IssueList,
  UUID_RE,
  rejectUnknownKeys,
  requireBoolean,
  requireNumberInRange,
  requireNumberTuple,
  requireObject,
} from "../../../lib/scene/validate-utils";

// Pure structure validation. Asset references are checked by service.server.ts;
// clip existence is checked by the player against the loaded model.

const INSTANCE_KEYS = ["id", "asset", "position", "quaternion", "scale", "animation"];
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
  allowTracks = false,
): void {
  rejectUnknownKeys(issues, "content", content, [
    "kind",
    "units",
    "durationSeconds",
    "loop",
    "assets",
    "instances",
  ]);
  if (content.units !== "meters") issues.error("content.units", '必须是 "meters"');
  requireBoolean(issues, "content.loop", content.loop);

  // assets: alias → { assetId }
  const aliasToAssetId = new Map<string, string>();
  const assets = requireObject(issues, "content.assets", content.assets);
  if (assets) {
    const entries = Object.entries(assets);
    if (entries.length > COMPOSITION_LIMITS.maxAssets) {
      issues.error("content.assets", `资源数量不能超过 ${COMPOSITION_LIMITS.maxAssets}`);
    }
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

  // durationSeconds: finite > 0 ≤ max, or null only for static scenes
  const duration = content.durationSeconds;
  let durationValue: number | null = null;
  if (duration === null) {
    durationValue = null;
  } else if (
    requireNumberInRange(issues, "content.durationSeconds", duration, {
      exclusiveMin: 0,
      max: COMPOSITION_LIMITS.maxDurationSeconds,
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
  if (instances.length > COMPOSITION_LIMITS.maxInstances) {
    issues.error("content.instances", `实例数量不能超过 ${COMPOSITION_LIMITS.maxInstances}`);
  }
  const seenIds = new Set<string>();
  let anyAnimation = false;
  let keyframeCount = 0;
  instances.forEach((raw, index) => {
    const path = `content.instances[${index}]`;
    const inst = requireObject(issues, path, raw);
    if (!inst) return;
    rejectUnknownKeys(issues, path, inst, allowTracks ? [...INSTANCE_KEYS, "tracks"] : INSTANCE_KEYS);
    if (allowTracks && inst.tracks !== undefined) {
      keyframeCount += validateTracks(issues, `${path}.tracks`, inst.tracks, durationValue);
      if (keyframeCount > 0) anyAnimation = true;
    }
    if (typeof inst.id !== "string" || !ALIAS_RE.test(inst.id)) {
      issues.error(`${path}.id`, "实例 id 必须以字母开头，只含字母、数字、_、-，最长 32");
    } else if (seenIds.has(inst.id)) {
      issues.error(`${path}.id`, `实例 id "${inst.id}" 重复`);
    } else {
      seenIds.add(inst.id);
    }
    if (typeof inst.asset !== "string" || !aliasToAssetId.has(inst.asset)) {
      issues.error(`${path}.asset`, "引用的资源别名不存在");
    }
    const position = requireNumberTuple(issues, `${path}.position`, inst.position, 3);
    if (position && position.some((v) => Math.abs(v) > COMPOSITION_LIMITS.maxPositionAbs)) {
      issues.error(`${path}.position`, `每个分量的绝对值不能超过 ${COMPOSITION_LIMITS.maxPositionAbs}`);
    }
    const quaternion = requireNumberTuple(issues, `${path}.quaternion`, inst.quaternion, 4);
    if (quaternion) {
      const norm = Math.hypot(...quaternion);
      if (Math.abs(norm - 1) > 1e-3) {
        issues.error(`${path}.quaternion`, `必须是单位四元数（当前模长 ${norm.toFixed(4)}）`);
      }
    }
    const scale = requireNumberTuple(issues, `${path}.scale`, inst.scale, 3);
    if (scale && scale.some((v) => v <= 0 || v > COMPOSITION_LIMITS.maxScale)) {
      issues.error(`${path}.scale`, `每个分量必须大于 0 且不超过 ${COMPOSITION_LIMITS.maxScale}`);
    }
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
  if (keyframeCount > COMPOSITION_LIMITS.maxKeyframes) issues.error("content.instances", `关键帧总数不能超过 ${COMPOSITION_LIMITS.maxKeyframes}`);
}
