import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

const UI_DIR = join(__dirname, '../../src/ui');
const UI_SCENE = readFileSync(join(__dirname, '../../src/scenes/UIScene.ts'), 'utf8');

/**
 * A view's subscription outlives the view unless something ends it, and the
 * scenes that own these views RESTART: Reset → Title → Play stops UIScene and
 * creates it again. Anything still listening from the previous run is an object
 * whose scene, camera and children are gone.
 *
 * That is not a leak you notice as slowness. The stale copy subscribed FIRST, so
 * it is called first, and it throws on its own dead `scene` — which used to end
 * the emit before the live view was reached. The naming prompt failed exactly
 * this way: the panel never opened after a reset, and its tutorial beat gates on
 * a name, so the run could not continue at all.
 */
describe('every UI view releases its bus subscriptions', () => {
  const sources = readdirSync(UI_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(join(UI_DIR, f), 'utf8')] as const)
    .filter(([, src]) => /bus\.on\(|bus\.once\(/.test(src));

  it.each(sources.map(([name]) => name))('%s ends what it started', (name) => {
    const src = sources.find(([f]) => f === name)![1];
    // Three acceptable shapes: the view releases itself when its game object is
    // destroyed, when its scene shuts down, or it exposes teardown() and UIScene
    // calls it on SHUTDOWN.
    const selfReleasing = /Events\.DESTROY|Scenes\.Events\.SHUTDOWN/.test(src);
    const torndownByScene =
      /\bteardown\(\)/.test(src) && new RegExp(`\\.teardown\\(\\)`).test(UI_SCENE);
    expect(selfReleasing || torndownByScene).toBe(true);
  });

  it('UIScene calls teardown on every panel that exposes one', () => {
    for (const [name, src] of sources) {
      if (!/^\s*teardown\(\): void/m.test(src)) continue;
      const cls = name.replace('.ts', '');
      // The field UIScene holds it in is the class name, lower-cased at the
      // front (`this.questTracker = new QuestTracker(...)`).
      const field = UI_SCENE.match(new RegExp(`this\\.(\\w+) = new ${cls}\\(`))?.[1];
      if (!field) continue;
      expect(UI_SCENE, `${cls} is never torn down`).toContain(`this.${field}.teardown()`);
    }
  });
});

describe('one broken subscriber cannot silence the rest', () => {
  it('calls every handler and reports the one that threw', () => {
    const bus = new EventBus();
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard: string[] = [];

    // Registration order is arbitrary — whoever built first. A view left over
    // from a previous scene is always FIRST, which is the worst possible place
    // for a thrower to sit.
    bus.on('dragon:named', () => {
      throw new Error('dead scene');
    });
    bus.on('dragon:named', () => heard.push('live panel'));

    expect(() => bus.emit('dragon:named', { itemId: 1, chain: 'ember_dragon', name: 'Cinder' })).not.toThrow();
    expect(heard).toEqual(['live panel']);
    expect(errs).toHaveBeenCalled();
    errs.mockRestore();
  });

  it('a throwing view does not strand the tutorial mid-advance', () => {
    const bus = new EventBus();
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let after = false;

    bus.on('ui:name_dragon_requested', () => {
      throw new TypeError("Cannot read properties of undefined (reading 'tweens')");
    });
    bus.emit('ui:name_dragon_requested', { itemId: 7 });
    after = true;

    expect(after).toBe(true);
    errs.mockRestore();
  });
});
