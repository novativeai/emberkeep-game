import { GOLDEN_CHAIN, WORLD_TELEPORT_BOREALIS } from './Constants';
import { goldenAwakened, GOLDEN_AWAKENED_STAT } from './goldenPromise';
import { PRIMARY_WORLD, sameLattice, type GameState } from './GameState';
import { getLattice } from './iso';
import type { SavedLattice } from './types';

/**
 * Save-integrity report — the instrument, not a fix.
 *
 * A save stores coordinates; the world stores what those coordinates MEAN (its
 * playable cells, its cell lattice), and the two live in different files restored by
 * different code at different times. When they drift apart the game does not throw:
 * it quietly shows a scrambled board, or a dragon in two places. This measures the
 * gap instead of waiting for someone to notice it.
 *
 * Run `window.__emberkeep.audit()` in the console — before shipping, and any time
 * something looks wrong. `node scripts/audit-grids.mjs` covers the other half: how
 * much of each hand-drawn grid survives the lattice it is folded through.
 */

export interface WorldAudit {
  id: string;
  /** The world the player is standing in — the only one whose ground is loaded. */
  live: boolean;
  items: number;
  /** Pieces standing on ground this world does not offer. `null` when unmeasurable
   *  (only the live world's cells exist in memory). */
  offGround: number | null;
  /** Cells holding more than one piece — always a defect. */
  stacked: number;
  /** The lattice this board's coordinates are written in (absent = pre-lattice save). */
  lattice?: SavedLattice;
  /** Does it match the lattice now live? `null` for a world that is not live. */
  latticeMatchesLive: boolean | null;
}

export interface SaveAudit {
  activeWorld: string;
  /** Playable cells the live world currently offers. */
  activeCells: number;
  worlds: WorldAudit[];
  /** chain -> the worlds holding it. A dragon in two rows here is a dragon in two
   *  places in the game. */
  chains: Record<string, string[]>;
  golden: {
    /** What the altar will decide on the next boot. */
    awakened: boolean;
    /** Whether that decision rests on a recorded fact rather than a re-derivation. */
    recorded: boolean;
    standsIn: string[];
    altarShouldBeEmpty: boolean;
  };
  /** Everything above, reduced to the things a human should act on. */
  problems: string[];
}

const cellKey = (c: number, r: number): string => `${c},${r}`;
const fmtLattice = (l?: SavedLattice): string =>
  l
    ? `${(l.halfW * 2).toFixed(1)}×${(l.halfH * 2).toFixed(2)} @ ${Math.round(l.originX)},${Math.round(l.originY)}`
    : '—';

export function auditSave(state: GameState, baseHidden: boolean): SaveAudit {
  const save = state.toSave(0, 0);
  const live = getLattice();
  const activeWorld = state.activeWorld;
  const problems: string[] = [];

  // The live world's ground. Only this one is loaded — a world's playable cells are
  // re-derived when you enter it, so the others cannot be measured from here, and
  // saying "0 off-ground" about them would be a lie rather than a reassurance.
  const b = state.bounds;
  let activeCells = 0;
  for (let row = b.minRow; row <= b.maxRow; row++) {
    for (let col = b.minCol; col <= b.maxCol; col++) {
      if (state.isTileActive(col, row)) activeCells++;
    }
  }

  const chains: Record<string, string[]> = {};
  const worlds: WorldAudit[] = [];

  for (const [id, board] of Object.entries(save.worlds ?? {})) {
    const isLive = id === activeWorld;
    const seen = new Set<string>();
    let stacked = 0;
    let offGround = 0;
    for (const item of board.items) {
      const key = cellKey(item.col, item.row);
      if (seen.has(key)) stacked++;
      seen.add(key);
      if (isLive && !state.isTileActive(item.col, item.row)) offGround++;
      const holders = (chains[item.chain] ??= []);
      if (!holders.includes(id)) holders.push(id);
    }
    worlds.push({
      id,
      live: isLive,
      items: board.items.length,
      offGround: isLive ? offGround : null,
      stacked,
      lattice: board.lattice,
      latticeMatchesLive: isLive ? !!board.lattice && sameLattice(board.lattice, live) : null
    });

    if (stacked > 0) problems.push(`${id} : ${stacked} case(s) portent plus d'une pièce.`);
    if (isLive && offGround > 0 && state.worldAuthorsItsCells) {
      problems.push(
        `${id} : ${offGround} pièce(s) hors sol — board:reconcile ne s'est pas exécuté après la restauration du monde.`
      );
    }
    if (isLive && board.lattice && !sameLattice(board.lattice, live)) {
      problems.push(
        `${id} : la lattice sauvegardée (${fmtLattice(board.lattice)}) diffère de la lattice vive ` +
          `(${fmtLattice(live)}) — les coordonnées n'ont pas encore été reprojetées.`
      );
    }
    if (!board.lattice) {
      problems.push(`${id} : aucune lattice enregistrée (sauvegarde antérieure) — elle sera adoptée à la prochaine entrée.`);
    }
  }

  // She stands in ONE place. Two rows, or none while the altar thinks she has flown,
  // is the bug that put the same dragon in nb2 and in borealis at once.
  const standsIn = chains[GOLDEN_CHAIN] ?? [];
  const awakened = goldenAwakened(state, baseHidden);
  const recorded = state.stat(GOLDEN_AWAKENED_STAT) > 0;
  const altarShouldBeEmpty = awakened && standsIn.includes(WORLD_TELEPORT_BOREALIS.toWorld);
  if (standsIn.length > 1) {
    problems.push(`${GOLDEN_CHAIN} présent dans ${standsIn.length} mondes (${standsIn.join(', ')}) — il doit être unique.`);
  }
  if (awakened && !recorded) {
    problems.push(
      `l'éveil de la Dragonne d'or est DÉDUIT, pas enregistré (${GOLDEN_AWAKENED_STAT} absent) — ` +
        `sauvegarde antérieure au correctif ; la première éclosion l'inscrira.`
    );
  }

  return {
    activeWorld,
    activeCells,
    worlds,
    chains,
    golden: { awakened, recorded, standsIn, altarShouldBeEmpty },
    problems
  };
}

/** The same report, printed. Returns it too, so the console shows both. */
export function printSaveAudit(state: GameState, baseHidden: boolean): SaveAudit {
  const a = auditSave(state, baseHidden);
  const rows = a.worlds.map((w) => ({
    monde: w.id === PRIMARY_WORLD ? `${w.id} (île)` : w.id,
    vif: w.live ? '●' : '',
    pièces: w.items,
    'hors sol': w.offGround === null ? '?' : w.offGround,
    empilées: w.stacked,
    lattice: fmtLattice(w.lattice),
    'lattice OK': w.latticeMatchesLive === null ? '?' : w.latticeMatchesLive ? 'oui' : 'NON'
  }));
  console.group(`[audit] monde vif "${a.activeWorld}" · ${a.activeCells} cases jouables`);
  console.table(rows);
  console.log(
    `Dragonne d'or : éveillée=${a.golden.awakened} (enregistré=${a.golden.recorded}) · ` +
      `présente dans [${a.golden.standsIn.join(', ') || 'nulle part'}] · ` +
      `autel ${a.golden.altarShouldBeEmpty ? 'VIDE' : 'occupé'}`
  );
  if (a.problems.length === 0) console.log('%cAucun problème.', 'color:#5c8');
  else for (const p of a.problems) console.warn('•', p);
  console.groupEnd();
  return a;
}
