/** Types for the animation-alignment apply module (used by the vite dev endpoints). */
export interface AnimTransform {
  scale: number;
  dx: number;
  dy: number;
}
export interface AlignDoc {
  version: 1;
  characters: Record<string, { atlas?: string; anims: Record<string, AnimTransform> }>;
}
export interface AutoAlignResult {
  ok: boolean;
  alignment: AlignDoc;
  report: Record<string, Record<string, string>>;
}
export function stateDoc(repoRoot: string): {
  ok: boolean;
  characters: Record<string, unknown>;
  alignment: AlignDoc;
};
export function autoAlign(
  repoRoot: string,
  opts?: { character?: string; anim?: string }
): AutoAlignResult;
export function applyAnimAlign(doc: AlignDoc, repoRoot: string): string;
export interface IngestResult {
  ok: boolean;
  clip: string;
  keyer: 'black' | 'green';
  frames: number;
  frameWidth: number;
  frameHeight: number;
  grid: string;
  sheet: string;
  bytes: number;
  loopSeamRmse: number;
  file: string;
  summary?: string;
  alignment?: { atlas?: string; anims: Record<string, AnimTransform> };
}
export function ingestClip(
  repoRoot: string,
  opts: {
    character: string;
    clip: string;
    video: string;
    fps?: number;
    height?: number;
    loop?: boolean;
    trimLoop?: boolean;
    write?: boolean;
  }
): IngestResult;
