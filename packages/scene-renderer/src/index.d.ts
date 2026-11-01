export interface RenderResource { assetId?: string; url: string; kind: 'model' | 'image' | 'video' | 'audio'; name?: string | null; contentHash?: string; animations?: unknown[] }
export interface CameraView { name?: string; position?: [number, number, number]; target?: [number, number, number]; up?: [number, number, number]; fov?: number; near?: number; far?: number; fit?: boolean }
export interface RenderInput { document: unknown; resources?: Record<string, RenderResource>; times: number[]; cameras?: (string | CameraView)[]; outputDir: string; options?: { width?: number; height?: number; timeoutMs?: number; overlays?: boolean; revision?: string; executablePath?: string; background?: string } }
export interface ImageArtifact { path: string; mimeType: 'image/png'; time: number; camera: string; width: number; height: number; sha256: string }
export interface RenderResult { images: ImageArtifact[]; manifest: string; documentHash: string; resources: Record<string, unknown>; frames: unknown[]; diagnostics: unknown[] }
export function renderScene(input: RenderInput): Promise<RenderResult>;
export function probeAsset(input: { path?: string; url?: string; kind?: string; outputDir?: string; options?: RenderInput['options'] }): Promise<{ facts: Record<string, unknown>; previews: ImageArtifact[]; errors: unknown[]; manifest: string }>;
