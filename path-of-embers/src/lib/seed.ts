import type { Group, Priority, ProjectData, Status, Task, UserId } from './types';

/**
 * The starting board: the current run of Emberkeep work, as a dependency graph.
 * It is seed data, not scripture — every field is editable in the app or over
 * the API, and the whole thing can be replaced by an import.
 */

const GROUPS: Group[] = [
  { id: 'world', name: 'World', glyph: 'W', blurb: 'Grid, zones and masking.', order: 0 },
  { id: 'gameplay', name: 'Gameplay', glyph: 'G', blurb: 'Core mechanics.', order: 1 },
  { id: 'characters', name: 'Characters', glyph: 'C', blurb: '3D characters and rigs.', order: 2 },
  { id: 'ui', name: 'UI', glyph: 'U', blurb: 'Interface and on-screen text.', order: 3 },
];

/** [key, title, group, status, priority, assignee, estimate(h), deps, tags, notes] */
type Row = [
  string,
  string,
  string,
  Status,
  Priority,
  UserId | null,
  number,
  string[],
  string[],
  string,
];

const ROWS: Row[] = [
  [
    'EMB-1',
    'Multiple grid',
    'world',
    'ready',
    'critical',
    'onja',
    16,
    [],
    ['grid'],
    'Define the grid first: perspective, size, matrix size. Support for multiple grid definitions — every zone laid out afterwards depends on this.',
  ],
  [
    'EMB-2',
    'Zone-1, Hub and Zone-2 masking',
    'world',
    'backlog',
    'high',
    'aina',
    14,
    ['EMB-1'],
    ['art'],
    'Cut the playable-area masks for Zone-1, the Hub and Zone-2 against the grid definition.',
  ],
  [
    'EMB-3',
    'Zone-1, Hub and Zone-2 integration',
    'world',
    'backlog',
    'high',
    'onja',
    12,
    ['EMB-2'],
    ['integration'],
    'Wire the masked zones into the engine so they load, unlock and render off the grid definition.',
  ],
  [
    'EMB-4',
    'Dragon feeding system',
    'gameplay',
    'ready',
    'high',
    'onja',
    18,
    [],
    ['mechanics'],
    'Take the dragons off the merge chains and feed them instead.',
  ],
  [
    'EMB-5',
    'Generation of 3D characters',
    'characters',
    'ready',
    'normal',
    'aina',
    20,
    [],
    ['art', '3d'],
    'Produce the 3D character assets.',
  ],
  [
    'EMB-6',
    'Integration of 3D characters',
    'characters',
    'backlog',
    'normal',
    'onja',
    14,
    ['EMB-5'],
    ['3d', 'integration'],
    'Bring the generated 3D characters into the game: rig hookup, placement and runtime.',
  ],
  [
    'EMB-7',
    'Art + text bubble for monologue',
    'ui',
    'ready',
    'normal',
    'aina',
    8,
    [],
    ['art', 'ui'],
    'Bubble art and the text treatment for monologue lines.',
  ],
  [
    'EMB-8',
    'Main and secondary quest display',
    'ui',
    'ready',
    'normal',
    'onja',
    10,
    [],
    ['ui'],
    'Main quest at the top right, secondary quest beneath it and slightly further right. A completed quest is struck through with a horizontal line and a satisfying animation.',
  ],
];

export function buildSeed(now: number): ProjectData {
  const tasks: Record<string, Task> = {};
  const order: string[] = [];
  const byKey = new Map<string, string>();

  for (const row of ROWS) {
    const id = `t_${row[0].toLowerCase().replace('-', '_')}`;
    byKey.set(row[0], id);
    order.push(id);
  }

  for (const row of ROWS) {
    const [key, title, groupId, status, priority, assignee, estimate, deps, tags, notes] = row;
    const id = byKey.get(key)!;
    tasks[id] = {
      id,
      key,
      title,
      notes,
      status,
      priority,
      assignee,
      groupId,
      deps: deps.map((d) => byKey.get(d)!).filter(Boolean),
      tags,
      estimate,
      due: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      checklist: [],
      comments: [],
      logs: [],
      attachments: [],
      pos: null,
    };
  }

  const groups: Record<string, Group> = {};
  for (const g of GROUPS) groups[g.id] = g;

  return {
    version: 2,
    tasks,
    groups,
    order,
    settings: {
      startDate: new Date(now).toISOString().slice(0, 10),
      hoursPerDay: 6,
      showDoneInGraph: true,
      snapToGrid: true,
    },
    nextKey: ROWS.length + 1,
  };
}
