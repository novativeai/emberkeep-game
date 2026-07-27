/** Types for the merge apply module (used by the vite dev endpoint). */
export interface MergeApplySummary {
  chains: number;
  tiers: number;
  artWritten: string[];
  assetsUpserted: string[];
  anchorsSet: string[];
}
export function validateMergeDoc(doc: unknown): void;
export function applyMergeDoc(
  doc: unknown,
  repoRoot: string,
  options?: { dryRun?: boolean }
): MergeApplySummary;
