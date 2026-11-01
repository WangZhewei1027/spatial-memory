// Historical constraints for the pre-migration scene formats only.
export const COMPOSITION_LIMITS = {
  maxAssets: 8,
  maxInstances: 24,
  maxDurationSeconds: 600,
  maxScale: 100,
  maxPositionAbs: 100,
  maxKeyframes: 2400,
  maxGroups: 16,
  maxGroupDepth: 4,
  maxNameLength: 64,
  maxTextLength: 4000,
} as const;
