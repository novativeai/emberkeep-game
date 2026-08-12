/**
 * Plays Emberkeep from a fresh save to Keeper level 3 using ONLY real game
 * intents (the same the UI emits): drag-to-merge, tap-to-harvest, deliver-order,
 * spend-key-on-fog, and idling for Warmth regen + passive dragon gifts. Every
 * XP point is awarded by the game's own systems — nothing is injected. Logs each
 * action with the running level/XP and shoots the board at each level-up.
 *   node tools/checks/playthrough.mjs
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
// Clean boot: clear any save, reload so beginRun() runs fresh, then start the board.
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.waitForTimeout(500);
await page.evaluate(() => window.__emberkeep.game.scene.getScene('TitleScene').scene.start('BoardScene'));
await page.waitForTimeout(1500);
// Guarantee a fresh, populated board even if a save auto-loaded before we cleared.
await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  if (ctx.state.items.size === 0) {
    ctx.systems.board.newGame();
    ctx.systems.tutorial.begin();
    ctx.systems.order.announceProgress();
  }
});
await page.waitForTimeout(400);

// ---- inject the auto-player helpers into the page (all act on the real ctx) ----
await page.evaluate(() => {
  const ctx = window.__emberkeep.game.registry.get('ctx');
  const S = ctx.state, bus = ctx.bus, clock = ctx.clock;
  const genCfg = (chain, tier) =>
    ctx.data.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.generator;

  const counts = () => {
    const c = {};
    for (const i of S.items.values()) if (i.kind === 'item') c[`${i.chain}_${i.tier}`] = (c[`${i.chain}_${i.tier}`] || 0) + 1;
    return c;
  };
  const read = () => {
    const o = ctx.systems.order.activeOrder;
    let order = null;
    if (o) { const p = ctx.systems.order.progressFor(o); order = { id: o.id, req: o.requires[0], have: p.have, need: p.need, deliverable: p.deliverable, xp: o.rewards.xp }; }
    const dragons = [...S.items.values()].filter((i) => i.kind === 'item' && i.readyAt !== undefined);
    const now = clock.now();
    return {
      level: S.level, xp: S.xp, coins: S.coins, keys: S.keys, energy: S.energyCurrent,
      tutorialDone: S.tutorialDone, counts: counts(), order,
      dragons: dragons.length, dragonsReady: dragons.filter((d) => now >= d.readyAt).length
    };
  };

  const freeAdj = (cluster) => {
    for (const c of cluster) for (const n of S.neighbors(c.col, c.row))
      if (S.isTileActive(n.col, n.row) && S.itemIdAt(n.col, n.row) === null) return n;
    return null;
  };
  // Gather three of (chain,tier) onto orthogonally-connected free tiles; the
  // third drop forms a group of 3 and the MergeSystem merges them.
  const mergeOne = (chain, tier) => {
    const items = [...S.items.values()].filter((i) => i.kind === 'item' && i.chain === chain && i.tier === tier && S.isTileActive(i.col, i.row));
    if (items.length < 3) return { ok: false, have: items.length };
    const xpBefore = S.xp;
    const anchor = items[0];
    const cluster = [{ col: anchor.col, row: anchor.row }];
    let placed = 1;
    for (let k = 1; k < items.length && placed < 3; k++) {
      const it = items[k];
      const target = freeAdj(cluster);
      if (!target) return { ok: false, reason: 'no free adjacent tile' };
      bus.emit('drag:dropped', { itemId: it.id, from: { col: it.col, row: it.row }, to: target });
      cluster.push(target);
      placed++;
    }
    if (placed < 3) return { ok: false, reason: 'could not gather 3' };
    return { ok: true, xpGained: S.xp - xpBefore };
  };

  const harvestOne = () => {
    const now = clock.now();
    for (const d of S.items.values()) {
      if (d.kind !== 'item' || d.readyAt === undefined) continue;
      const g = genCfg(d.chain, d.tier);
      if (!g) continue;
      if (now >= d.readyAt && S.energyCurrent >= g.energyCost && S.freeActiveNeighbors(d.col, d.row).length > 0) {
        bus.emit('item:tapped', { itemId: d.id });
        return { ok: true, dragonTier: d.tier };
      }
    }
    return { ok: false };
  };

  const deliver = () => {
    const o = ctx.systems.order.activeOrder;
    if (!o) return { ok: false };
    if (!ctx.systems.order.progressFor(o).deliverable) return { ok: false };
    const xpBefore = S.xp;
    bus.emit('ui:deliver_requested', { orderId: o.id });
    return { ok: true, orderId: o.id, xpGained: S.xp - xpBefore, rewards: o.rewards };
  };

  const unlockGate = () => {
    if (S.keys < 1) return { ok: false };
    const region = ctx.data.map.regions.find((r) => r.unlock && r.unlock.keys && S.regionStatus.get(r.id) === 'unlockable');
    if (!region) return { ok: false };
    bus.emit('fog:tapped', { regionId: region.id });
    return { ok: S.regionStatus.get(region.id) === 'active', regionId: region.id };
  };

  const advanceBubble = () => {
    if (S.tutorialDone) return;
    const step = ctx.data.tutorial.steps[S.tutorialIndex];
    if (step && step.gate && step.gate.type === 'tap') bus.emit('tutorial:advance_requested', { stepId: step.id });
  };

  window.__AP = { read, mergeOne, harvestOne, deliver, unlockGate, advanceBubble, advance: (ms) => window.advanceTime(ms) };
});

// ----------------------------- the play loop -----------------------------
const log = [];
const labels = {
  sparkweed: ['', 'Spark Weed', 'Ember Bloom', 'Flame Lily'],
  ember_dragon: ['', 'Speckled Egg', 'Ember Hatchling', 'Ember Whelp'],
  flame_gem: ['', 'Gem Shard', 'Flame Gem', 'Radiant Gem']
};
let n = 0, lastLevel = 1;
const shots = [];
const ap = (fn, args = []) =>
  page.evaluate(([f, a]) => window.__AP[f](...a), [fn, Array.isArray(args) ? args : [args]]);
const record = async (action, detail) => {
  const s = await ap('read');
  n++;
  log.push({ n, action, detail, level: s.level, xp: s.xp, coins: s.coins, keys: s.keys, energy: s.energy });
  console.log(`#${String(n).padStart(2)}  L${s.level} ${String(s.xp).padStart(3)}xp  ${(s.energy + '⚡').padEnd(4)} ${action.padEnd(14)} ${detail}`);
  if (s.level > lastLevel) {
    lastLevel = s.level;
    const path = `/tmp/PLAY-level-${s.level}.png`;
    await page.screenshot({ path });
    shots.push(path);
    console.log(`     ════ reached Keeper level ${s.level} (shot: ${path}) ════`);
  }
  return s;
};

let s = await ap('read');
console.log(`start: L${s.level} ${s.xp}xp | weeds ${s.counts.sparkweed_1 || 0}, eggs ${s.counts.ember_dragon_1 || 0}, shards ${s.counts.flame_gem_1 || 0}\n`);

if (!s.counts.ember_dragon_1 && !s.counts.sparkweed_1 && !s.counts.flame_gem_1) {
  console.log('ABORT: board is empty (no starting items) — newGame did not populate.');
  await browser.close();
  process.exit(1);
}

let guard = 0, idleStreak = 0, lastXp = -1;
while (s.level < 3 && guard < 300) {
  guard++;
  if (s.xp !== lastXp) { idleStreak = 0; lastXp = s.xp; }
  if (idleStreak > 12) { console.log('ABORT: stuck (no XP progress over 12 idles).'); break; }
  await ap('advanceBubble');

  // 1. deliver a completable order (biggest XP beats)
  if (s.order && s.order.deliverable) {
    const r = await ap('deliver');
    s = await record('DELIVER', `«${s.order.id}» → +${r.rewards.xp} XP, +${r.rewards.coins} gold${r.rewards.keys ? `, +${r.rewards.keys} key` : ''}`);
    continue;
  }
  // 2. spend a key to burn the fog gate (reveals eggs + room)
  if (s.keys > 0) {
    const r = await ap('unlockGate');
    if (r.ok) { s = await record('SPEND KEY', `cleared «${r.regionId}» fog → eggs + nest + room revealed`); continue; }
  }
  // 3. hatch a clutch of eggs (a new dragon + XP)
  if ((s.counts.ember_dragon_1 || 0) >= 3) {
    const r = await ap('mergeOne', ['ember_dragon', 1]);
    if (r.ok) { s = await record('HATCH', `merged 3 Speckled Eggs → Ember Hatchling (+${r.xpGained} XP, a new dragon)`); continue; }
  }
  // 4. tidy spare weeds for a little XP + room
  if ((s.counts.sparkweed_1 || 0) >= 3) {
    const r = await ap('mergeOne', ['sparkweed', 1]);
    if (r.ok) { s = await record('MERGE', `3× Spark Weed → Ember Bloom (+${r.xpGained} XP)`); continue; }
  }
  // 5. produce toward the active order: merge the highest available precursor up
  let merged = false;
  if (s.order) {
    const { chain, tier } = s.order.req;
    for (let t = tier - 1; t >= 1; t--) {
      if ((s.counts[`${chain}_${t}`] || 0) >= 3) {
        const r = await ap('mergeOne', [chain, t]);
        if (r.ok) { s = await record('MERGE', `3× ${labels[chain][t]} → ${labels[chain][t + 1]} (+${r.xpGained} XP)`); merged = true; }
        break;
      }
    }
  }
  if (merged) continue;
  // 6. harvest a ready dragon for a Gem Shard (spends 1 Warmth)
  if (s.dragonsReady > 0 && s.energy > 0) {
    const r = await ap('harvestOne');
    if (r.ok) { s = await record('HARVEST', `tapped a dragon → Gem Shard (−1 Warmth)`); continue; }
  }
  // 7. nothing to do — let time pass: Warmth regenerates and dragons gift shards
  await ap('advance', 90000);
  idleStreak++;
  s = await record('IDLE 90s', `Warmth regen + passive dragon gifts (dragons: ${s.dragons})`);
}

console.log(`\nFINISHED at Keeper level ${s.level} in ${n} actions · ${s.xp} XP · ${s.coins} gold · ${s.keys} keys`);
await page.screenshot({ path: '/tmp/PLAY-final.png' });

// dump a compact action table + milestones
import('node:fs').then((fs) => {
  fs.writeFileSync('/tmp/PLAY-log.json', JSON.stringify({ actions: log, finalLevel: s.level, totalActions: n }, null, 2));
});
const levelUps = log.filter((e, i) => i === 0 || e.level > log[i - 1].level);
console.log('level-up moments:', levelUps.map((e) => `#${e.n} L${e.level}@${e.xp}xp`).join('  '));

await browser.close();
