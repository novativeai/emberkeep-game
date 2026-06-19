/**
 * Persisted "mute background music" preference (a device setting, not game state).
 * The settings dialog reads it for its label + writes it on toggle; the
 * AudioManager reads it at boot and applies it to the music/ambient gains.
 */
const KEY = 'emberkeep:musicMuted';

export function getMusicMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setMusicMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? '1' : '0');
  } catch {
    /* storage unavailable (private mode) — preference just won't persist */
  }
}
