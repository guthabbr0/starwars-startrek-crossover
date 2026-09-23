# Broken Horizon / release 0.3

This revision addresses the reported instant-lock, continuous-fire, low-survivability combat and cramped arena. Passing the previous functional suite did not establish fun or fair balance.

## Gameplay changes

- Arena radius 85 m to 240 m; diameter 170 m to 480 m. Cruise and boost for humans remain 26 m/s and 42 m/s.
- Bots use a 1.15 s acquisition delay, aim sampled every 0.35 to 0.5 s with inaccuracy, and a 0.9 rad/s turning limit.
- Three-shot bursts: 0.46 s shot spacing, 1.8 s recovery after the third shot. Bot damage is 10 instead of 20. At most two bots pursue a single target.
- Human weapons deal 25 damage at 0.28 s spacing; bot hull is 72. Three confirmed hits destroy an unshielded bot. Human hull remains 100.
- Bot cruise/boost is 16/25 m/s; human manoeuvres can break contact.
- Three-second spawn shields and separated friendly-area spawns.
- Four physical asteroid covers block both shots and targeting. Two faction-specific repair docks heal after 5 s without damage.
- Deflector pulse clears nearby hostile shots and interrupts nearby AI targeting. Solo tactical menu now pauses the simulation; multiplayer remains live.

## Presentation

Larger camera framing, tactical zoom controls, per-ship hull bars, acquiring/firing/reloading indicators, incoming-lock banner, nearest-contact range, confirmed-hit reticle, damage numbers and elimination confirmation. The battlefield adds repair facilities, capital ships, a jump gate, a ringed background planet, denser instanced debris, atmospheric glow and engine exhaust. Existing generated textures are retained.

## Validation scope

27 simulation tests include 12 new balance regressions. The new Playwright suite tests normal spawn survival, solo pause, zoom, real mouse-fired eliminations against active AI, desktop captures and mobile controls. Its close-combat fixture only arranges ships; it does not enable god mode. Automated aim is not a human usability study. Existing multiplayer, live-public-deployment and deterministic rendering suites remain in CI.

A local deterministic comparison used 30 seeds, one stationary human and one active bot at identical positions 46 m apart, no grace or god mode, and a 30 s ceiling. Median first hit changed from 0.617 s to 1.783 s; median death time from 1.383 s to 15.983 s. All 30 idle targets eventually died in each version. These are scenario-specific simulation measurements, not promises about every multiplayer encounter.

Rendering follows the supplied profiling skill's budget/scenario/measure/compare loop. The existing Chromium harness compares separate versus merged geometry in the same 16-ship, 160-projectile, 240-particle scene at DPR 1 and 2, and gates draw calls at 150 and triangles at 300000. Software GPU timings are not physical-device benchmarks.
