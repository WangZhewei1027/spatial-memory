import { type IssueList, rejectUnknownKeys, requireBoolean, requireNumberInRange, requireObject } from "./validate-utils";

const COLOR = /^#[0-9a-f]{6}$/i;

/** Presentation fields are optional on old documents, but complete and finite when supplied. */
export function validatePresentation(issues: IssueList, path: string, instance: Record<string, unknown>, allowed: boolean, automation = false): void {
  for (const field of ["text", "timing", "media"] as const) {
    if (instance[field] !== undefined && !allowed) issues.error(`${path}.${field}`, "此功能需要播放清单 schemaVersion 7");
  }
  if (instance.opacity !== undefined) {
    if (!automation) issues.error(`${path}.opacity`, "透明度需要播放清单 schemaVersion 8");
    requireNumberInRange(issues, `${path}.opacity`, instance.opacity, { min: 0, max: 1 });
  }
  if (instance.text !== undefined) {
    if (instance.asset !== undefined) issues.error(`${path}.asset`, "空间文字不能同时引用团队素材");
    if (instance.animation !== null) issues.error(`${path}.animation`, "空间文字不能使用模型动画");
    if (instance.media !== undefined) issues.error(`${path}.media`, "空间文字不能使用媒体播放参数");
    if (instance.tracks && typeof instance.tracks === "object" && "volume" in instance.tracks) issues.error(`${path}.tracks.volume`, "空间文字不能使用音量关键帧");
    const text = requireObject(issues, `${path}.text`, instance.text);
    if (text) {
      const at = `${path}.text`;
      rejectUnknownKeys(issues, at, text, ["content", "color", "fontSize", "width", "align", "backgroundColor"]);
      if (typeof text.content !== "string" || !text.content.trim())
        issues.error(`${at}.content`, "文字必须是非空字符串");
      for (const key of ["color", "backgroundColor"]) {
        if (key === "backgroundColor" && text[key] === undefined) continue;
        if (typeof text[key] !== "string" || !COLOR.test(text[key])) issues.error(`${at}.${key}`, "颜色必须是 #RRGGBB");
      }
      requireNumberInRange(issues, `${at}.fontSize`, text.fontSize, { exclusiveMin: 0 });
      requireNumberInRange(issues, `${at}.width`, text.width, { exclusiveMin: 0 });
      if (typeof text.align !== "string" || !["left", "center", "right"].includes(text.align)) issues.error(`${at}.align`, "对齐方式必须是 left、center 或 right");
    }
  }
  if (instance.timing !== undefined) {
    const timing = requireObject(issues, `${path}.timing`, instance.timing);
    if (timing) {
      const at = `${path}.timing`;
      rejectUnknownKeys(issues, at, timing, ["startSeconds", "endSeconds", "fadeInSeconds", "fadeOutSeconds"]);
      const startOk = requireNumberInRange(issues, `${at}.startSeconds`, timing.startSeconds, { min: 0 });
      if (timing.endSeconds !== null && requireNumberInRange(issues, `${at}.endSeconds`, timing.endSeconds, { min: 0 }) && startOk && timing.endSeconds <= (timing.startSeconds as number))
        issues.error(`${at}.endSeconds`, "消失点必须晚于出现点");
      for (const key of ["fadeInSeconds", "fadeOutSeconds"]) requireNumberInRange(issues, `${at}.${key}`, timing[key], { min: 0 });
    }
  }
  if (instance.media !== undefined) {
    if (instance.animation !== null) issues.error(`${path}.animation`, "媒体播放参数不能和模型动画同时使用");
    const media = requireObject(issues, `${path}.media`, instance.media);
    if (media) {
      const at = `${path}.media`;
      rejectUnknownKeys(issues, at, media, ["trimStartSeconds", "trimEndSeconds", "playbackRate", "volume", "loop", "muted", "spatial"]);
      const startOk = requireNumberInRange(issues, `${at}.trimStartSeconds`, media.trimStartSeconds, { min: 0 });
      if (media.trimEndSeconds !== null && requireNumberInRange(issues, `${at}.trimEndSeconds`, media.trimEndSeconds, { min: 0 }) && startOk && media.trimEndSeconds <= (media.trimStartSeconds as number))
        issues.error(`${at}.trimEndSeconds`, "素材结束点必须晚于素材起点");
      if (media.playbackRate !== 1) issues.error(`${at}.playbackRate`, "媒体仅支持原速播放，playbackRate 必须为 1");
      requireNumberInRange(issues, `${at}.volume`, media.volume, { min: 0, max: 1 });
      requireBoolean(issues, `${at}.loop`, media.loop);
      requireBoolean(issues, `${at}.muted`, media.muted);
      if (media.spatial !== undefined) {
        if (!automation) issues.error(`${at}.spatial`, "空间音频需要播放清单 schemaVersion 8");
        const spatial = requireObject(issues, `${at}.spatial`, media.spatial);
        if (spatial) {
          const p = `${at}.spatial`;
          rejectUnknownKeys(issues, p, spatial, ["enabled", "refDistance", "maxDistance", "rolloffFactor"]);
          requireBoolean(issues, `${p}.enabled`, spatial.enabled);
          const refOk = requireNumberInRange(issues, `${p}.refDistance`, spatial.refDistance, { exclusiveMin: 0 });
          const maxOk = requireNumberInRange(issues, `${p}.maxDistance`, spatial.maxDistance, { exclusiveMin: 0 });
          if (refOk && maxOk && (spatial.maxDistance as number) < (spatial.refDistance as number)) issues.error(`${p}.maxDistance`, "最大距离不能小于参考距离");
          requireNumberInRange(issues, `${p}.rolloffFactor`, spatial.rolloffFactor, { min: 0 });
        }
      }
    }
  }
}
