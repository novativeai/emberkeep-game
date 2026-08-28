/** Types for `tuning-catalog.mjs` — the ⏱ Tuning page's view of Constants.ts. */

export interface TuningLeaf {
  group: string;
  keys: string[];
  path: string;
  value: number;
  raw: string;
  start: number;
  end: number;
  doc: string;
}

export interface TuningParam {
  path: string;
  group: string;
  key: string;
  value: number;
  doc: string;
  min: number;
  max: number;
  step: number;
}

export interface TuningCategory {
  id: string;
  name: string;
  blurb: string;
  preview: string | null;
  params: TuningParam[];
}

export function parseConstants(src: string): TuningLeaf[];
export function applyTuning(
  src: string,
  edits: Record<string, number>,
  index: TuningLeaf[]
): { text: string; count: number };
export function rangeFor(value: number, path: string): { min: number; max: number; step: number };
export function buildCatalog(src: string): TuningCategory[];
export const CATEGORIES: { id: string; name: string; blurb: string; preview: string | null; groups?: string[]; keys?: string[] }[];
