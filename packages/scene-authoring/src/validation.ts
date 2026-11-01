import { validateSceneDocument } from './validate';
import { isSceneResourceKind, type SceneDocument } from './protocol';
import { catchResult, diagnostic, failure, jsonIssue, success } from './common';
import type { AuthoringOptions, Diagnostic, Result } from './types';

export function validate(document: unknown, options: AuthoringOptions = {}): Result<{ document: SceneDocument }> {
  return catchResult(() => {
    const json = jsonIssue(document);
    if (json) return failure([json]);
    const checked = validateSceneDocument(document);
    if (!checked.ok) return failure(checked.issues.filter(issue => issue.severity === 'error').map(issue => diagnostic('INVALID_DOCUMENT', issue.path, issue.message)));
    // This assertion follows the complete runtime schema check above.
    const valid = document as SceneDocument;
    const errors: Diagnostic[] = [], warnings: Diagnostic[] = [];
    for (const [alias, ref] of Object.entries(valid.content.assets)) {
      const fact = options.resources?.[ref.assetId];
      if (!fact) {
        if (options.requireResources) errors.push(diagnostic('RESOURCE_NOT_FOUND', `content.assets.${alias}`, `Missing resource facts: ${ref.assetId}`));
        continue;
      }
      if (fact.assetId !== ref.assetId || !isSceneResourceKind(fact.kind)) errors.push(diagnostic('INVALID_RESOURCE', `content.assets.${alias}`, 'Resource identity or kind is invalid'));
      if (fact.state === 'archived') warnings.push({ ...diagnostic('ARCHIVED_RESOURCE', `content.assets.${alias}`, 'Archived references require server verification before saving'), severity: 'warning' });
    }
    valid.content.instances.forEach((node, index) => {
      const ref = node.asset && valid.content.assets[node.asset], fact = ref ? options.resources?.[ref.assetId] : undefined;
      if (!fact) return;
      const path = `content.instances[${index}]`;
      if (node.animation && fact.kind !== 'model') errors.push(diagnostic('RESOURCE_KIND_MISMATCH', `${path}.animation`, 'Only model resources have GLB animations', node.id));
      if ((node.media || node.tracks?.volume) && fact.kind !== 'audio' && fact.kind !== 'video') errors.push(diagnostic('RESOURCE_KIND_MISMATCH', `${path}.media`, 'Media settings and volume tracks require audio or video', node.id));
      if (node.animation && fact.animations) {
        const animation = node.animation;
        const matches = fact.animations.filter(clip => animation.clipIndex !== undefined ? clip.index === animation.clipIndex : clip.name === animation.clipName);
        if (matches.length !== 1) errors.push(diagnostic(matches.length ? 'AMBIGUOUS_CLIP' : 'CLIP_NOT_FOUND', `${path}.animation`, 'The selected animation must identify exactly one resource clip', node.id));
      }
    });
    return errors.length ? failure(errors) : success({ document: structuredClone(valid) }, warnings);
  });
}
