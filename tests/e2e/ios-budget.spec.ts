import { expect, test } from '@playwright/test';

/**
 * THE iOS MEMORY BUDGET, ENFORCED.
 *
 * Boots the production build on the iPhone profile (touch + iOS UA, so the
 * game's IS_IOS / IS_LOW_END paths are the ones measured), plays into the
 * board, waits for the streamed play wave to finish, and asserts the decoded
 * texture plateau stays under `IOS_TEXTURE_BUDGET_MB` (Constants documents
 * the derivation from the worst supported device's WebKit kill ceiling).
 *
 * This is the regression gate for the class of crash that shipped twice: art
 * additions that are individually reasonable and collectively push the iOS
 * renderer process past its cap ~10 seconds into a session. A new texture
 * that breaks this test would have broken a 3 GB iPhone.
 */
test.use({
  viewport: { width: 414, height: 896 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});

test('decoded texture plateau stays under the iOS budget', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.waitForFunction(() => !!window.__emberkeep, null, { timeout: 90_000 });
  await page.waitForFunction(
    () => window.__emberkeep.game.registry.get('bootload:ready') === true,
    null,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(500);

  // Tap Play where a player would — the Title button position is part of the
  // instrumentation contract, but on the phone profile the live space moves,
  // so aim via the scene like the panel probes do.
  const play = await page.evaluate(() => {
    const t = window.__emberkeep.game.scene.getScene('TitleScene');
    const rect = document.querySelector('canvas')!.getBoundingClientRect();
    const k = rect.width / (window.__emberkeep.game.scale.gameSize.width / t.cameras.main.zoom);
    const cands = t.children.list
      .map((o) => o as unknown as { input?: unknown; x: number; y: number })
      .filter((o) => o.input && o.x > 0 && o.y > 0);
    const o = cands[cands.length - 1];
    return o ? { x: rect.left + o.x * k, y: rect.top + o.y * k } : null;
  });
  expect(play).not.toBeNull();
  await page.mouse.click(play!.x, play!.y);

  // The full stream: board art, then the play wave batching in behind it.
  await page.waitForFunction(
    () => window.__emberkeep.game.registry.get('bootload:play_ready') === true,
    null,
    { timeout: 180_000 }
  );
  await page.waitForTimeout(2_000); // let the last batch's uploads settle

  const { decoded, budget } = await page.evaluate(() => ({
    decoded: window.__emberkeep.decodedTextureMB(),
    budget: window.__emberkeep.iosTexBudgetMB
  }));
  console.log(`[ios-budget] decoded texture plateau: ${decoded} MB (budget ${budget} MB)`);
  expect(decoded).toBeLessThanOrEqual(budget);

  // THE CODEX-BEAT PEAK — where the field crash actually happened. By that
  // tutorial beat the board carries a live dragon (its clip sheets resident)
  // with the Codex open on its dossier. Seed exactly that and assert the peak
  // fits the same budget: steady state passing while the deepest tutorial
  // moment does not is precisely the regression this spec exists to catch.
  await page.evaluate(() => {
    const w = window as unknown as {
      __emberkeep: {
        game: Phaser.Game & { registry: { get(k: string): unknown }; scene: { getScene(k: string): unknown } };
      };
    };
    const ctx = w.__emberkeep.game.registry.get('ctx') as {
      state: { tutorialDone: boolean; items: Map<number, { chain: string; tier: number; dragonName?: string; care?: object }> };
      bus: { emit(e: string, p: object): void };
    };
    const ui = w.__emberkeep.game.scene.getScene('UIScene') as unknown as {
      bubble: { setVisible(v: boolean): void };
      codex: { open(): void };
    };
    ctx.state.tutorialDone = true;
    ui.bubble.setVisible(false);
    ctx.bus.emit('board:spawn', { chain: 'ember_dragon', tier: 3, count: 1 });
    ui.codex.open();
  });
  await page.waitForTimeout(8_000); // the breed's clip sheets stream in

  const peak = await page.evaluate(() => window.__emberkeep.decodedTextureMB());
  console.log(`[ios-budget] codex-beat peak: ${peak} MB (budget ${budget} MB)`);
  expect(peak).toBeLessThanOrEqual(budget);
});
