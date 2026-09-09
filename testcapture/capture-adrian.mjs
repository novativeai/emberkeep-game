/**
 * ADRIAN'S THREE — the picture the numbers could not take.
 *
 *   node testcapture/capture-adrian.mjs [--out testcapture/adrian-gameplay] [--headed]
 *
 * WHY THIS EXISTS
 * ---------------
 * Three of the six things Adrian reported are GAMEPLAY, and gameplay was the
 * half with no picture: the account wall and the policy links were shot on the
 * live site, and the three real bugs were proved by unit tests only. A test
 * says a number moved. It does not say the player can see it move, and two of
 * these three bugs were exactly that — the rule was right and the screen never
 * showed it.
 *
 * So this boots the last recorded beat (`free_play`, the board handed back) and
 * plays the three gestures a tester would, shooting each one:
 *
 *   A  the task counts the satchel   a piece POCKETED still counts toward the
 *                                    quest — spawned and pocketed ONE AT A TIME,
 *                                    which is the order that used to read 0/2
 *   B  one arm, many gives           the piece stays in hand while the stack
 *                                    lasts: armed ONCE, handed over twice, the
 *                                    satchel emptying between frames
 *   C  every hatch asks its name     a SECOND red dragon hatches and the game
 *                                    asks what to call her — the first was named
 *                                    by the tutorial, and every later one had
 *                                    silently stopped being asked
 *
 * IT PLAYS, IT DOES NOT ASSERT. Every frame prints the state it was taken in
 * (satchel, tracker, whether a give is still armed), so the ledger under the
 * pictures is measured rather than described. `pnpm test` is what proves the
 * rules; this proves they reach the screen.
 *
 * Staging is honest about being staging: `board:spawn` puts the pieces on the
 * board rather than grinding for them, and the one quest ahead of the
 * interesting one is completed the same way. Nothing here fakes a satchel, a
 * tracker or a give — those are the gestures under test and they go through the
 * player's own path (`ui:store_requested`, `ui:bag_give_requested`, a real
 * mouse drag).
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, resolveUrl, bootAt, sleep, settleBubble } from '../scripts/game-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, flag('out', 'testcapture/adrian-gameplay'));
const FROM = flag('from', 'free_play');
const HEADED = argv.includes('--headed');

mkdirSync(OUT, { recursive: true });

const bus = (page, event, payload) =>
  page.evaluate(([e, p]) => window.__emberkeep.game.registry.get('ctx').bus.emit(e, p), [event, payload]);

/**
 * WHAT THE FRAME IS OF — read off the live systems, not narrated.
 *
 * `armed` reaches into BoardScene's private `pendingGive` on purpose: whether a
 * give is still in hand is the whole of fix B and it is the one thing a still
 * image cannot show (the recipients PULSE, which is a tween, not a pixel). TS
 * privacy is a compile-time fence; at runtime the field is simply there, and a
 * harness that has to describe the invisible should read it rather than infer it.
 */
const readout = (page) =>
  page.evaluate(() => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    const board = window.__emberkeep.game.scene.getScene('BoardScene');
    const q = ctx.systems.quests;
    const quest = q.activeQuestFor('eleanor');
    const step = quest?.steps.find((s) => !q.stepDone(s)) ?? quest?.steps[0];
    const p = step ? q.progressFor(step) : null;
    const onBoard = {};
    for (const it of ctx.state.items.values()) {
      if (it.kind !== 'item') continue;
      onBoard[`${it.chain}:${it.tier}`] = (onBoard[`${it.chain}:${it.tier}`] ?? 0) + 1;
    }
    return {
      quest: quest ? q.titleFor(quest) : null,
      step: p ? `${p.label} — ${p.have}/${p.need}${p.done ? ' ✓' : ''}` : null,
      satchel: ctx.state.bag.map((s) => `${s.chain}:${s.tier}×${s.count}`).join(' ') || '(empty)',
      armed: board?.pendingGive ? `${board.pendingGive.chain}:${board.pendingGive.tier}` : null,
      onBoard,
      order: ctx.systems.order.activeOrders[0]?.title ?? null,
      coins: ctx.state.coins,
      errors: window.__emberkeep.errors().length
    };
  });


/**
 * GET THE RING OFF THE BOARD FIRST.
 *
 * A dialogue card does not merely cover the board — while it is up UIScene owns
 * the pointer, and every tap aimed at a character or a piece lands on the card
 * instead. The first run of this capture lost both of its last two chapters to
 * exactly that: the give stayed armed, the eggs never merged, and the frames
 * looked like the fixes had failed when nothing had been tapped at all.
 *
 * So dismiss it the way a player does — tap it until it is gone — and note that
 * this board TALKS: generators finish, the chest opens, the Ember Gate speaks.
 * Lines queue up, so this is called immediately before each gesture, never once
 * at the top.
 */
async function clearBubbles(page, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const up = await page.evaluate(() => {
      const b = window.__emberkeep.game.scene.getScene('UIScene')?.bubble;
      return !!(b && b.visible);
    });
    if (!up) return true;
    await settleBubble(page);
    // Where UIScene seats the card: (W/2 + 220, H - 150) in the 2560x1600 game
    // space, which the fixed UI camera maps straight through.
    await page.mouse.click(750, 725);
    await sleep(420);
  }
  return false;
}


/**
 * AIM AT ELEANOR — after putting her back on screen.
 *
 * She is anchored at (8,0) and drawn 591px ABOVE her own cell, so on the
 * board's resting framing her body sits off the top edge: the first run of this
 * capture read her at y = -2 and clicked open sky, which is why two gives
 * looked like none. The camera can show her (centred, she lands mid-frame) but
 * it does not STAY there — the board re-frames itself on its own events — so
 * the centring belongs immediately before each aim, not once per chapter.
 *
 * Refuses rather than guesses: a point off the top is a capture that would
 * quietly photograph the wrong thing.
 */
async function aimEleanor(page) {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.__emberkeep.centerCell(8, 0));
    await sleep(500);
    const at = await page.evaluate(() => window.__emberkeep.characterToPage('eleanor'));
    if (at && at.y > 30 && at.y < 770 && at.x > 20 && at.x < 1260) return at;
  }
  throw new Error('Eleanor never came into frame');
}

const shot = async (page, name, note) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const r = await readout(page);
  console.log(`\n  ${name}  ${note}`);
  console.log(`    quête     ${r.quest ?? '—'} · ${r.step ?? '—'}`);
  console.log(`    satchel   ${r.satchel}`);
  console.log(`    en main   ${r.armed ?? '(rien)'}`);
  // THE CLAIM IS ABOUT THE BOARD BEING EMPTY, so print the board. "1/2 with one
  // pocketed" only proves the fix if the other one is not simply lying on the
  // ground, where the old rule would have counted it anyway.
  const gems = Object.entries(r.onBoard).filter(([k]) => k.startsWith('flame_gem'));
  console.log(`    plateau   ${gems.length ? gems.map(([k, n]) => `${k}×${n}`).join(' ') : 'aucune Fire Gem posée'}`);
  console.log(`    commande  ${r.order ?? '—'} · ${r.coins} or${r.errors ? ` · ${r.errors} ERREURS` : ''}`);
  return r;
};

/** The id of the newest board piece of this form — what `ui:store_requested` needs. */
const newestId = (page, chain, tier) =>
  page.evaluate(
    ([c, t]) => {
      const st = window.__emberkeep.game.registry.get('ctx').state;
      let best = null;
      for (const it of st.items.values()) {
        if (it.kind === 'item' && it.chain === c && it.tier === t && (!best || it.id > best.id)) best = it;
      }
      return best ? { id: best.id, col: best.col, row: best.row } : null;
    },
    [chain, tier]
  );

const tapAt = async (page, p) => {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(500);
};
const dragTo = async (page, a, b) => {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await sleep(80);
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
    await sleep(16);
  }
  await sleep(80);
  await page.mouse.up();
  await sleep(600);
};

/** Spawn one piece and pocket it — Adrian's own gesture, in his own order. */
async function spawnAndPocket(page, chain, tier) {
  await bus(page, 'board:spawn', { chain, tier, count: 1, cause: 'debug' });
  await sleep(700);
  const it = await newestId(page, chain, tier);
  if (!it) throw new Error(`nothing spawned for ${chain}:${tier}`);
  await bus(page, 'ui:store_requested', { itemId: it.id });
  await sleep(700);
}

const url = await resolveUrl(null);
const { browser, page } = await launch({ headed: HEADED });
try {
  console.log(`· booting "${FROM}" on ${url}`);
  await bootAt(page, url, FROM);
  await sleep(1500);
  await clearBubbles(page);

  /* ---------------------------------------------------------------- staging */
  // The tracker is on "Make Emberberry Jam" (one jar, which a single spawn
  // finishes). Retire it so the frames land on the quest that can actually
  // COUNT — two Fire Gems, which is also what Eleanor's live order wants.
  await bus(page, 'board:spawn', { chain: 'emberberry', tier: 3, count: 1, cause: 'debug' });
  await sleep(1200);
  await clearBubbles(page);

  /* -------------------------------------- A · the task counts the satchel */
  await shot(page, 'A0-the-task-asks-for-two', 'la tache demande 2 Fire Gems, le plateau n en a aucune');
  await spawnAndPocket(page, 'flame_gem', 2);
  await clearBubbles(page);
  await shot(page, 'A1-one-gem-pocketed', 'UNE gemme fabriquee puis empochee — la tache compte 1/2 (avant : 0/2)');
  await spawnAndPocket(page, 'flame_gem', 2);
  await clearBubbles(page);
  await shot(page, 'A2-both-in-the-satchel', 'les DEUX dans la besace, plateau vide — la tache est faite');

  /* -------------------------------------------- B · one arm, many gives */
  await clearBubbles(page);
  await bus(page, 'ui:bag_give_requested', { chain: 'flame_gem', tier: 2 });
  await sleep(800);
  let she = await aimEleanor(page);
  await shot(page, 'B0-armed-once', 'le don est arme UNE fois — « Tap who it is for »');
  console.log(`  · Eleanor a l ecran: ${Math.round(she.x)},${Math.round(she.y)}`);
  await tapAt(page, she);
  she = await aimEleanor(page);
  await shot(page, 'B1-first-given-still-in-hand', 'premiere donnee — la besace tombe a 1 et la piece RESTE en main');
  await tapAt(page, she);
  await shot(page, 'B2-second-given-order-done', 'seconde donnee sans rouvrir la besace — la commande se termine');

  /* ------------------------------------- C · every hatch asks its name */
  // ADRIAN'S OWN BREED. He watched an Ash Dragon arrive already called "Ash
  // Dragon"; two eggs make one, so this is the shortest true version of what he
  // did — and the second ash dragon of the save, which is the case that had
  // stopped being asked.
  await sleep(1000);
  await clearBubbles(page);
  await page.evaluate(() => window.__emberkeep.centerCell(6, 6));
  await sleep(700);
  await bus(page, 'board:spawn', { chain: 'ashdrake', tier: 1, count: 3, cause: 'debug' });
  await sleep(1400);
  await clearBubbles(page);
  const eggs = await page.evaluate(() => {
    const st = window.__emberkeep.game.registry.get('ctx').state;
    return [...st.items.values()]
      .filter((i) => i.kind === 'item' && i.chain === 'ashdrake' && i.tier === 1)
      .map((i) => ({ id: i.id, col: i.col, row: i.row }));
  });
  console.log(`\n  · ${eggs.length} oeufs de cendre: ${eggs.map((e) => `${e.col},${e.row}`).join(' · ')}`);
  await shot(page, 'C0-ash-eggs', 'des Ash Dragon Eggs sur le plateau — la race exacte du rapport');
  const cellPage = (c, r) => page.evaluate(([a, b]) => window.__emberkeep.itemToPage(a, b), [c, r]);
  const liveCell = (id) =>
    page.evaluate((i) => {
      const it = window.__emberkeep.game.registry.get('ctx').state.items.get(i);
      return it ? { col: it.col, row: it.row } : null;
    }, id);
  // THE DROP IS THE VERB: gather the strays beside the first, then the last drop
  // onto the pile is what merges them. Re-read each cell before dragging — a
  // gather MOVES the piece.
  for (const egg of eggs.slice(1)) {
    const from = await liveCell(egg.id);
    const onto = await liveCell(eggs[0].id);
    if (!from || !onto) continue;
    await dragTo(page, await cellPage(from.col, from.row), await cellPage(onto.col, onto.row));
    await clearBubbles(page);
  }
  await sleep(1500);
  await shot(page, 'C1-she-hatches', 'les oeufs fusionnent — une SECONDE dragonne de cendre eclot');
  await sleep(2500);
  await shot(page, 'C2-the-game-asks-her-name', 'et le jeu demande son nom (avant : il ne demandait plus)');

  const errs = await page.evaluate(() => window.__emberkeep.errors());
  console.log(errs.length ? `\n! ${errs.length} erreur(s) page: ${JSON.stringify(errs).slice(0, 500)}` : '\n✓ aucune erreur page');
  console.log(`\n→ ${path.relative(ROOT, OUT)}`);
} finally {
  await browser.close();
}
