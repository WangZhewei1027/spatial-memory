/** Scene-local lighting. Both hosts use these defaults for older documents. */
export const DEFAULT_SCENE_LIGHTING = Object.freeze({
  ambientColor: '#ffffff', ambientIntensity: 1.2,
  directionalColor: '#ffffff', directionalIntensity: 2,
  azimuth: 45, elevation: Math.atan2(8, Math.hypot(5, 5)) * 180 / Math.PI,
  environment: 'studio', environmentIntensity: 1, environmentRotation: 0,
});

/** Return field errors without coercing external data or accepting private fields. */
export function lightingIssues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['lighting'];
  const errors = Object.keys(value).filter(key => !Object.prototype.hasOwnProperty.call(DEFAULT_SCENE_LIGHTING, key));
  for (const key of ['ambientColor', 'directionalColor'])
    if (typeof value[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[key])) errors.push(key);
  for (const [key, min, max] of [['ambientIntensity', 0, 10], ['directionalIntensity', 0, 10], ['azimuth', -180, 180], ['elevation', -90, 90], ['environmentIntensity', 0, 5], ['environmentRotation', -180, 180]])
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) errors.push(key);
  if (!['none', 'studio'].includes(value.environment)) errors.push('environment');
  return errors;
}
