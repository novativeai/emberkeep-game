import { describe, expect, it } from 'vitest';
import { mergeElementPatch, prunePatch, sanitizeCustom, sanitizeSequences, sanitizeThemeDoc } from '../../src/ui/themeCore';

describe('ui theme — sanitizeThemeDoc', () => {
  it('coerces garbage into a valid empty doc', () => {
    for (const bad of [null, 42, 'x', [], { textures: 3, elements: 'no' }]) {
      const doc = sanitizeThemeDoc(bad);
      expect(doc).toEqual({ version: 1, textures: {}, elements: {}, custom: {}, assets: {}, sequences: {}, replacements: {} });
    }
  });

  it('keeps only #RRGGBB texture params', () => {
    const doc = sanitizeThemeDoc({
      textures: { ui_pill: { fill: '#3A2B38', border: 'red', evil: 12 }, junk: 'x' }
    });
    expect(doc.textures).toEqual({ ui_pill: { fill: '#3A2B38' } });
  });

  it('passes element patches through', () => {
    const doc = sanitizeThemeDoc({ elements: { 'hud.energy': { dx: 4 } } });
    expect(doc.elements['hud.energy']).toEqual({ dx: 4 });
  });
});

describe('ui theme — custom components (the composer JSON)', () => {
  it('sanitize keeps valid components and drops broken layers', () => {
    const out = sanitizeCustom({
      banner: {
        label: 'Banner',
        x: 1280,
        y: 300,
        layers: [
          { kind: 'image', name: 'bg', x: 0, y: 0, texture: 'ui_card' },
          { kind: 'text', name: 'title', x: 0, y: -40, text: 'Hi' },
          { kind: 'rig', name: 'dragon', x: -200, y: 60, character: 'dragon-red', body: 'hover', face: 'talk' },
          { kind: 'nope', name: 'bad', x: 0, y: 0 },
          { kind: 'image', name: 'noCoords' },
          'garbage'
        ]
      },
      broken: 'not-an-object',
      noLayers: { label: 'x', x: 0, y: 0 }
    });
    expect(Object.keys(out)).toEqual(['banner']);
    expect(out['banner']!.layers.map((l) => l.name)).toEqual(['bg', 'title', 'dragon']);
    expect(out['banner']!.layers[2]).toMatchObject({ kind: 'rig', character: 'dragon-red', body: 'hover', face: 'talk' });
  });

  it('keeps uploaded assets (data URLs only) and replacements', () => {
    const doc = sanitizeThemeDoc({
      assets: { hand2: 'data:image/png;base64,AAA', evil: 'https://x/y.png', bad: 7 },
      replacements: { ui_hand: { src: 'hand2', anchorX: 0.31, anchorY: 0.1 }, junk: 'x' }
    });
    expect(Object.keys(doc.assets)).toEqual(['hand2']);
    expect(doc.replacements['ui_hand']).toEqual({ src: 'hand2', anchorX: 0.31, anchorY: 0.1 });
    expect(doc.replacements['junk']).toBeUndefined();
  });

  it('keeps scalable-frame layer fields (w/h/slice/scaleX/scaleY)', () => {
    const out = sanitizeCustom({
      promo: { label: 'p', x: 0, y: 0, layers: [{ kind: 'image', name: 'f', x: 0, y: 0, texture: 'ui_panel', w: 1400, h: 900, slice: true, scaleX: 2, scaleY: 0.5 }] }
    });
    expect(out['promo']!.layers[0]).toMatchObject({ w: 1400, h: 900, slice: true, scaleX: 2, scaleY: 0.5 });
  });

  it('sanitizeThemeDoc carries the custom section', () => {
    const doc = sanitizeThemeDoc({
      custom: { c1: { label: 'C', x: 1, y: 2, layers: [{ kind: 'text', name: 't', x: 0, y: 0, text: 'x' }] } }
    });
    expect(doc.custom['c1']!.layers).toHaveLength(1);
  });

  it('keeps anim layers (uploaded PNG sequences) with their playback fields', () => {
    const out = sanitizeCustom({
      guide: { label: 'Guide', x: 0, y: 0, layers: [
        { kind: 'anim', name: 'talk', x: 0, y: 0, sequence: 'laurah_talk_short', fps: 12, loop: false }
      ] }
    });
    expect(out['guide']!.layers[0]).toMatchObject({ kind: 'anim', sequence: 'laurah_talk_short', fps: 12, loop: false });
  });
});

describe('ui theme — sequences (uploaded PNG-sequence animations)', () => {
  const url = (n: number) => `data:image/png;base64,FRAME${n}`;

  it('keeps valid frames and per-frame durations that line up', () => {
    const out = sanitizeSequences({
      talk: { frames: [url(0), url(1), url(2)], durations: [90, 160, 140], fps: 12, width: 989, height: 1416 }
    });
    expect(out['talk']!.frames).toHaveLength(3);
    expect(out['talk']!.durations).toEqual([90, 160, 140]);
    expect(out['talk']).toMatchObject({ fps: 12, width: 989, height: 1416 });
  });

  it('drops non-image frames and mismatched/zero durations', () => {
    const out = sanitizeSequences({
      good: { frames: [url(0), 'https://x/y.png', url(1), 42], durations: [90] },
      bad: { frames: 'nope' },
      empty: { frames: ['https://only-remote.png'] }
    });
    expect(out['good']!.frames).toEqual([url(0), url(1)]);
    expect(out['good']!.durations).toBeUndefined(); // length mismatch → fall back to fps
    expect(out['bad']).toBeUndefined();
    expect(out['empty']).toBeUndefined();
  });

  it('sanitizeThemeDoc carries the sequences section', () => {
    const doc = sanitizeThemeDoc({ sequences: { s: { frames: [url(0)] } } });
    expect(doc.sequences['s']!.frames).toEqual([url(0)]);
  });
});

describe('ui theme — mergeElementPatch', () => {
  it('merges scalars and deep-merges parts + text', () => {
    const merged = mergeElementPatch(
      { dx: 2, parts: { value: { text: { color: '#FFF6E8' }, alpha: 0.9 } } },
      { dy: -6, parts: { value: { text: { fontSize: 48 } }, icon: { tint: '#E8503C' } } }
    );
    expect(merged.dx).toBe(2);
    expect(merged.dy).toBe(-6);
    expect(merged.parts!['value']).toEqual({ alpha: 0.9, text: { color: '#FFF6E8', fontSize: 48 } });
    expect(merged.parts!['icon']).toEqual({ tint: '#E8503C' });
  });

  it('later values win', () => {
    expect(mergeElementPatch({ dx: 2 }, { dx: 10 }).dx).toBe(10);
  });
});

describe('ui theme — prunePatch (what gets saved)', () => {
  it('drops values equal to defaults so an untouched element saves nothing', () => {
    expect(prunePatch({ dx: 0, dy: 0, scale: 1, alpha: 1, depth: null, parts: { a: { scale: 1, tint: null } } })).toBeNull();
  });

  it('keeps real overrides', () => {
    const kept = prunePatch({
      dx: 12, scale: 1.2, visible: false,
      parts: { value: { text: { color: '#FFD84D' } }, bg: { texture: 'ui_card' } }
    })!;
    expect(kept).toEqual({
      dx: 12, scale: 1.2, visible: false,
      parts: { value: { text: { color: '#FFD84D' } }, bg: { texture: 'ui_card' } }
    });
  });

  it('keeps part sequence animations (with loop) and drops cleared ones', () => {
    const kept = prunePatch({
      parts: {
        icon: { sequence: 'laurah_talk_short', loop: false },
        other: { sequence: null, loop: true } // cleared → nothing to save
      }
    })!;
    expect(kept).toEqual({ parts: { icon: { sequence: 'laurah_talk_short', loop: false } } });
  });
});
