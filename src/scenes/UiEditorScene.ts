import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, SCENES } from '../core/Constants';
import { renderScale } from '../core/render-scale';
import { CharacterBubble } from '../entities/CharacterBubble';
import { CustomUiManager } from '../ui/customUi';
import { Hud } from '../ui/Hud';
import { LedgerPanel } from '../ui/LedgerPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { Tooltip } from '../ui/Tooltip';
import { initUiEdit } from '../ui/uiEdit';

/**
 * The UI Builder's document window — what `?uiedit=1` boots into INSTEAD of
 * the game. Nothing simulates here: BoardScene never starts, `ctx.beginRun()`
 * is never called (no save load, no tutorial, no clock consumers, no systems
 * activity). The scene only CONSTRUCTS the real UI components so they register
 * with the theme registry and can be staged, styled and rearranged — a plain
 * canvas of assets, the way Photoshop shows a document, not a running app.
 * The only motion is component-owned art (rig layers previewing their chosen
 * body/face animation), never game logic.
 */
export class UiEditorScene extends Phaser.Scene {
  constructor() {
    super(SCENES.uiEditor);
  }

  create(): void {
    const ctx = this.registry.get('ctx') as GameContext;
    this.cameras.main.setOrigin(0).setZoom(renderScale.value);

    // Real components, inert: no system ever emits, so their bus handlers
    // never fire. Depths mirror UIScene so stacking reads faithfully.
    const hud = new Hud(this, ctx.bus, ctx.state, {
      onLedger: () => {},
      onGear: () => {},
      onBag: () => {},
      onStore: () => {}
    });
    hud.ledgerButton.setDepth(10);
    hud.bagButton.setDepth(10);
    hud.storeButton.setDepth(10);
    hud.gearButton.setDepth(10);
    hud.setRegenText('2:59'); // sample content for the countdown label

    const tooltip = new Tooltip(this, ctx.data.chains);
    tooltip.setDepth(55);

    const ledger = new LedgerPanel(this, ctx.bus, ctx.systems.order, ctx.systems.tasks, ctx.state, ctx.systems.regard);
    ledger.setDepth(60);

    const shop = new ShopPanel(this, ctx.bus, ctx.state);
    shop.setDepth(68);

    const bubble = new CharacterBubble(this, ctx.bus);
    bubble.setPosition(GAME_WIDTH / 2 + 220, LIVE_GAME_HEIGHT - 150);
    bubble.setDepth(100);
    bubble.registerUi();

    // Tool-authored components (their rig layers animate — that's the asset's
    // own preview, the single intentional motion on this canvas).
    const customUi = new CustomUiManager(this);
    customUi.buildAll();

    initUiEdit(this, customUi);
  }
}
