/**
 * ONE LIGHT TICK, WHEN THE HAND CLOSES ON A PIECE.
 *
 * Haptics are a flourish, never a dependency: every path here is wrapped, and
 * a platform with nothing to offer simply stays silent.
 *
 *   Android (and any browser with the Vibration API): a 12 ms pulse — short
 *   enough to read as a tick, not a buzz.
 *
 *   iOS Safari has NO Vibration API at any version. What it does have, since
 *   iOS 18, is a system haptic on flipping a native switch control — and a
 *   programmatic toggle of an `<input type="checkbox" switch>` during a user
 *   gesture fires that same haptic. The element is created once, parked
 *   off-screen and inert to every other input. On iOS releases before the
 *   switch control existed the toggle is just a silent checkbox — the correct
 *   degradation.
 */
import { IS_IOS } from './Constants';

let iosSwitch: HTMLInputElement | null = null;

const iosTick = (): void => {
  if (!iosSwitch) {
    iosSwitch = document.createElement('input');
    iosSwitch.type = 'checkbox';
    iosSwitch.setAttribute('switch', '');
    iosSwitch.style.cssText =
      'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none';
    iosSwitch.tabIndex = -1;
    iosSwitch.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iosSwitch);
  }
  // The toggle IS the haptic. It must happen inside a user gesture — the
  // caller's contract, and drag-start is always one.
  iosSwitch.click();
};

/** A light confirmation tick. Safe to call anywhere; throws never. */
export function lightHaptic(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(12);
      return;
    }
    if (IS_IOS && typeof document !== 'undefined') iosTick();
  } catch {
    // A missing haptic is not a problem worth a console line.
  }
}
