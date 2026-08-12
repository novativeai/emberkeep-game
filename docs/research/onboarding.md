# Onboarding research — what the evidence says

Sourced craft study for `.claude/skills/tutorial-design`. Everything here is
someone else's finding; the rules derived from it live in the skill.

## The numbers

- **~20% of players never finish the first quest of a tutorial** (deltaDNA,
  across a multi-game sample). The tutorial is the single largest drop-off
  surface in a F2P game — ahead of difficulty, ahead of monetisation.
- A tutorial losing ~40% before the core loop is "a UX problem hiding as a
  retention problem", not a difficulty problem. The fix is found by emitting a
  start/complete event **per step** and reading the funnel: the step with the
  largest absolute drop is the one to fix first.
- Push-style interruption — information delivered before the player has a reason
  to want it — is skipped often and **does not reliably improve task
  performance**. People don't retain instructions for a problem they don't have
  yet.

## The craft consensus

1. **Teach one mechanic at a time, inside play**, not on a screen in front of
   play. Interactive mini-tasks beat tutorial screens.
2. **Just-in-time beats up-front.** Contextual lessons spread across the session
   outperform a front-loaded block, because each lands when its subject is on
   screen and wanted.
3. **Trigger on the player, not the clock.** Tooltips and highlights fired by
   what the player just did (or just failed at) read as help; the same text on a
   timer reads as an ad.
4. **Reward completion.** PUBG Mobile's beginner missions teach while paying out
   — the lesson is a quest, not homework.
5. **Let the experienced leave**, but make staying worth it.

## What this does NOT license

The consensus is about *pacing and trigger*, not about removing structure. The
same sources are clear that the first minutes decide the install, and that a
player left to discover a core verb alone mostly does not discover it. "Teach
later" means *teach at the moment of use*; it never means *don't teach*.

## Sources

- [How to Measure and Reduce Tutorial Drop-Off — Bugnet](https://bugnet.io/blog/how-to-measure-and-reduce-tutorial-drop-off)
- [First-Time User Experience (FTUE) in Mobile Games — Udonis](https://www.blog.udonis.co/mobile-marketing/mobile-games/first-time-user-experience)
- [Best Practices For Mobile Game Onboarding — Adrian Crook & Associates](https://adriancrook.com/best-practices-for-mobile-game-onboarding/)
- [Soft Landing to Conversion — GameRefinery](https://www.gamerefinery.com/soft-landing-to-conversion-introducing-onboarding-best-practices-part-3/)
- [Onboarding and FTUE Design: The AAA Production Playbook — Nasty Rodent](https://nastyrodent.com/onboarding-and-ftue-design/)
- [Onboarding — Roblox Creator Hub](https://create.roblox.com/docs/production/game-design/onboarding)
- [Optimising onboarding to reduce drop-off — Zigpoll](https://www.zigpoll.com/content/how-can-we-optimize-the-onboarding-experience-to-reduce-player-dropoff-rates-in-our-mobile-game)
