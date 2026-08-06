/** Types for the character-anchor apply module (used by the vite dev endpoint). */
export interface CharacterPlacement {
  id: string;
  world?: string;
  col: number;
  row: number;
}
export interface CharacterApplyEntry {
  id: string;
  col: number;
  row: number;
  /** true when the character was not yet in characters.json and was appended */
  added: boolean;
}
export function applyCharacters(
  doc: { characters: CharacterPlacement[] },
  repoRoot: string
): CharacterApplyEntry[];
export function readCharacters(repoRoot: string): {
  characters: Array<{ id: string; anchor: [number, number] }>;
};
