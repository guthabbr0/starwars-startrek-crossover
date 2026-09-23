# STELLAR RIFT: Crossover War

A Three.js space-combat fan game: Starfleet versus the Galactic Empire, with real WebRTC multiplayer, room codes, solo practice, procedural audio and image-generated textures. Unofficial and not affiliated with the franchise owners.

## Play

**Live game: https://starwars-startrek.vercel.app/**

Create a war room, share its six-character code or copy the invite link, and let other pilots join. The host must keep the tab open. Up to eight human pilots can join a room. Solo practice includes AI wingmates and opponents.

Move with WASD, aim with the mouse, fire with the primary mouse button or Space, boost with Shift, and trigger a deflector pulse with E. Escape opens the tactical menu. Touch controls are provided on mobile. Matches end at 25 faction eliminations or the time limit; the host can launch a rematch without recreating the room.

## Development

Requires Node.js 22 or later.

```sh
npm ci
node scripts/assets.mjs
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## CI/CD

Vercel project: `guthabbr0/starwars-startrek`. The project is connected to this repository through Vercel's native Git integration. No repository Vercel token is needed for this deployment path.

- `.github/workflows/verify.yml`: locked dependency installation, simulation tests, production build, real-browser multiplayer tests, deterministic rendering comparison, screenshots, CPU profiles and source packaging. Runs on relevant pushes to main (including workflow changes), pull requests and manual dispatch. It has read-only repository permissions and does not create additional commits or deployments.
- `vercel.json`: `npm ci --no-fund`, followed by `npm test && npm run build`, publishing `dist`. A failed simulation test stops the Vercel build.
- `.github/workflows/vercel-smoke.yml`: receives `vercel.deployment.success` for this project's production environment and tests the public production domain with public PeerJS signalling. It can also be dispatched manually with an explicit project URL. No authentication cookies or protection bypass tokens are used.

The post-deployment smoke test observes the current production alias, not an immutable deployment, and is not a production promotion gate. The full GitHub browser suite runs separately from Vercel's build. Configure Vercel Deployment Checks separately when requiring all browser checks before promotion.

### Verified status on 2026-09-23

Verified source revision: `70177398a331f2dd79827f7d9823395318c05463`.

- [Source verification](https://github.com/guthabbr0/starwars-startrek-crossover/actions/runs/35916491045): all 15 simulation tests and all 11 browser/performance checks passed. These include real WebRTC data channels, client movement and firing, authoritative damage and respawn replication, rematches, disconnect recovery and mobile boot. The production build and source packaging passed too.
- [Public production verification](https://github.com/guthabbr0/starwars-startrek-crossover/actions/runs/35916520081): all 7 live browser checks passed at `https://starwars-startrek.vercel.app`, with no uncaught application errors or failed game assets. Two independent browser contexts connected through public PeerJS signalling, exchanged movement and firing, and recovered correctly when the host left. Mobile touch-enabled practice also booted successfully.
- Vercel deployment `dpl_AhmudiVX28BbET5BbqcyQEAwLFtu` was READY for the verified revision through the native Git integration. The ChatGPT Vercel connector was re-authorized and can now access the project.

The earlier red live check targeted an immutable generated deployment URL that redirected to Vercel login. It now targets the public production domain instead. Deployment protection was not disabled, and the tests do not use an authentication bypass. Use the live game URL above to invite players; the Vercel dashboard URL is for administration, not gameplay.

The linked workflow artifacts contain screenshots, results and CPU profiles. Artifact retention is 7 days.

## Browser verification

```sh
npx playwright install --with-deps chromium
npm run test:browser
```

The local test harness starts Vite Preview and a local PeerServer, then drives actual WebRTC data channels in Chromium. It does not replace the transport with a mock or BroadcastChannel. Results, screenshots and CPU profiles are saved in `reports/` and uploaded as GitHub Actions artifacts.

For the public deployment:

```sh
BASE_URL=https://starwars-startrek.vercel.app node tests/live.mjs
```

The live harness restricts targets to this project's Vercel hostname prefix, uses no authentication bypass, and fails when it cannot reach the application. It tests public signalling separately from the local PeerServer suite.

## Measured performance

A deterministic heavy scene contains 16 ships, 160 projectiles and 240 particles. Merging each ship's primitive geometry reduced submissions from **189 to 41 draw calls**, a **78.3% reduction**, with the same **26,384 triangles**. The low preset maintained the same 960 by 600 drawing buffer at device pixel ratios 1 and 2. The comparison and regression gates passed again for the verified revision above.

These measurements were made with Chromium and the SwiftShader software GPU on a GitHub runner. They are work-count and relative CPU comparisons, not a promise of hardware frame rate. The supplied profiling skill's budget/scenario/measure/classify/fix/prove/gate method was followed using application renderer counters and CDP CPU profiles. The original bundled probe could not navigate in the managed local browser. This harness does not measure every raw GL synchronization or upload counter.

## Architecture and limits

The host owns the fixed-step simulation, validates numeric movement input, runs bots and broadcasts world snapshots at approximately 20 Hz. Clients submit input; rendering interpolates snapshots. Projectiles and effects have bounded counts. Audio uses cached procedural buffers and a bounded voice pool. Generated hull, nebula and planet artwork is shipped as optimized WebP textures.

This is a trusted-host friends' game, not a dedicated anti-cheat service. PeerJS cloud signalling is an external dependency. Restrictive NATs and firewalls may require a TURN relay, which is not provisioned here. The successful public multiplayer test used separate browser contexts on one runner; it does not establish connectivity across every pair of external networks. Closing the host ends the room; there is no host migration or persistent match server.

Never commit account credentials, Vercel tokens or private signalling secrets to the repository.
