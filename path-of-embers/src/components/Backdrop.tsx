'use client';

import { useMemo } from 'react';

/** Seeded so the field is identical on every render — no reflow flicker. */
function seeded(n: number): () => number {
  let s = n >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The painted sky. A generated nebula plate underneath, a live task field and a
 * slow ember drift on top, then a vignette that keeps the centre of the screen
 * quiet enough to read interface against.
 */
export function Backdrop() {
  const tasks = useMemo(() => {
    const rnd = seeded(0x5eed);
    return Array.from({ length: 70 }, () => ({
      left: `${rnd() * 100}%`,
      top: `${rnd() * 100}%`,
      size: 1 + rnd() * 1.8,
      delay: `${rnd() * 6}s`,
      dur: `${3.5 + rnd() * 5}s`,
    }));
  }, []);

  const embers = useMemo(() => {
    const rnd = seeded(0xe11b);
    return Array.from({ length: 26 }, () => ({
      left: `${rnd() * 100}%`,
      size: 1.5 + rnd() * 2.5,
      delay: `${rnd() * 26}s`,
      dur: `${20 + rnd() * 22}s`,
    }));
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/art/sky.webp)' }}
      />
      <div className="absolute inset-0 bg-void/35" />

      {tasks.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animation: `twinkle ${s.dur} ease-in-out ${s.delay} infinite`,
            boxShadow: '0 0 6px rgba(255,255,255,0.8)',
          }}
        />
      ))}

      {embers.map((e, i) => (
        <span
          key={i}
          className="absolute bottom-0 rounded-full"
          style={{
            left: e.left,
            width: e.size,
            height: e.size,
            background: '#ff9a4d',
            boxShadow: '0 0 8px rgba(255,140,60,0.9)',
            animation: `ember-rise ${e.dur} linear ${e.delay} infinite`,
          }}
        />
      ))}

      {/* Keeps the working area legible without flattening the painting. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 58% 52% at 50% 46%, rgba(6,11,18,0.86) 0%, rgba(6,11,18,0.5) 45%, rgba(6,11,18,0.12) 72%, transparent 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(6,11,18,0.82) 0%, transparent 22%, transparent 76%, rgba(6,11,18,0.88) 100%)',
        }}
      />
    </div>
  );
}
