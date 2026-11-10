export interface SceneLighting {
  ambientColor: string; ambientIntensity: number;
  directionalColor: string; directionalIntensity: number;
  azimuth: number; elevation: number;
  environment: 'none' | 'studio'; environmentIntensity: number; environmentRotation: number;
}
export const DEFAULT_SCENE_LIGHTING: Readonly<SceneLighting>;
export function lightingIssues(value: unknown): string[];
