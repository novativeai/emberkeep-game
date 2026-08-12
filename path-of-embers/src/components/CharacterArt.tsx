'use client';

import { useStore } from '@/lib/store';
import { userStats } from '@/lib/selectors';
import { USER_PROFILE } from '@/lib/types';

/**
 * Selyna on the left, Eleanor on the right — the two figures that frame the
 * screen. They are scenery, not avatars: both stay present whichever developer
 * is active.
 *
 * The orb floats just above Selyna's open palm and carries the active
 * developer's remaining task count, in their colour. Switching developer swaps
 * both the number and the colour.
 */
export function CharacterArt() {
  const data = useStore((s) => s.data);
  const activeUser = useStore((s) => s.activeUser);
  const profile = USER_PROFILE[activeUser];
  const remaining = userStats(data, activeUser).open;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* ── Selyna, left edge ─────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 h-[76vh] max-h-[820px] translate-x-[-30%] select-none">
        <div className="relative h-full">
          <img
            src="/art/selyna.webp"
            alt=""
            className="h-full w-auto object-contain object-bottom"
            style={{
              opacity: 0.9,
              filter:
                'drop-shadow(0 0 60px rgba(95,208,255,0.16)) saturate(0.78) brightness(0.82) contrast(1.04)',
              maskImage:
                'linear-gradient(to bottom, black 0%, black 74%, rgba(0,0,0,0.55) 90%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, black 0%, black 74%, rgba(0,0,0,0.55) 90%, transparent 100%)',
            }}
          />

          {/*
            Anchored to the palm measured off the artwork (84% / 56.5% of the
            image box), which puts it hovering a little above her open hand
            rather than resting in it.
          */}
          <div
            className="absolute"
            style={{ left: '84%', top: '56.5%', transform: 'translate(-50%, -50%)' }}
          >
            <div className="orb-float relative grid h-[clamp(76px,8.6vh,108px)] w-[clamp(76px,8.6vh,108px)] place-items-center">
              {/* Smoke aura — two counter-drifting veils in the orb's colour. */}
              <span
                className="orb-smoke absolute rounded-full"
                style={{
                  inset: '-58%',
                  background: `radial-gradient(circle at 50% 55%, ${profile.glow} 0%, color-mix(in srgb, ${profile.accent} 22%, transparent) 34%, transparent 68%)`,
                  filter: 'blur(14px)',
                }}
              />
              <span
                className="orb-smoke-slow absolute rounded-full"
                style={{
                  inset: '-38%',
                  background: `radial-gradient(circle at 42% 46%, color-mix(in srgb, ${profile.accentSoft} 34%, transparent) 0%, transparent 62%)`,
                  filter: 'blur(9px)',
                }}
              />

              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.72), color-mix(in srgb, ${profile.accentSoft} 55%, transparent) 38%, color-mix(in srgb, ${profile.accentDeep} 70%, transparent) 72%, rgba(6,12,19,0.72) 100%)`,
                  boxShadow: `0 0 44px ${profile.glow}, 0 0 90px color-mix(in srgb, ${profile.accent} 30%, transparent), inset 0 0 26px color-mix(in srgb, ${profile.accentSoft} 45%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${profile.accentSoft} 70%, transparent)`,
                }}
              />
              <span
                className="relative text-[clamp(27px,3.3vh,42px)] font-semibold leading-none text-white"
                style={{ textShadow: `0 0 20px ${profile.accent}, 0 1px 3px rgba(0,0,0,0.6)` }}
                title={`${profile.name}: ${remaining} task${remaining === 1 ? '' : 's'} remaining`}
              >
                {remaining}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Eleanor, right edge ───────────────────────────────────────── */}
      <div className="absolute right-0 top-0 h-[52vh] max-h-[560px] translate-x-[6%] select-none">
        <img
          src="/art/eleanor.webp"
          alt=""
          className="h-full w-auto object-contain object-right-top"
          style={{
            opacity: 0.88,
            filter:
              'drop-shadow(0 0 70px rgba(255,120,60,0.14)) saturate(0.8) brightness(0.8) contrast(1.04)',
            maskImage:
              'linear-gradient(to bottom, black 0%, black 66%, rgba(0,0,0,0.45) 88%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 0%, black 66%, rgba(0,0,0,0.45) 88%, transparent 100%)',
          }}
        />
      </div>

    </div>
  );
}
