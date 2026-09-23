import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const out = 'reports'; await mkdir(out, { recursive: true });
const results = [], errors = [], children = []; let browser;
const base = 'http://127.0.0.1:4173';
function run(args) { const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', d => process.stdout.write(d)); p.stderr.on('data', d => process.stderr.write(d)); children.push(p); return p; }
async function waitServer(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(100); } throw new Error(`Server unavailable: ${url}`); }
async function test(name, fn) { const start = Date.now(); try { await fn(); results.push({ name, passed: true, durationMs: Date.now() - start }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, passed: false, error: error.stack, durationMs: Date.now() - start }); console.error(`FAIL ${name}: ${error.stack}`); throw error; } }
function track(page, label) { page.on('pageerror', e => errors.push(`${label}: ${e.message}`)); page.on('console', e => { if (e.type() === 'error' && !e.text().includes('peer-unavailable')) errors.push(`${label}: ${e.text()}`); }); }
async function ready(page, suffix = '') { await page.goto(`${base}/${suffix}`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__gameDebug?.ready, { timeout: 30000 }); assert.deepEqual(await page.evaluate(() => __gameDebug.stats().assetErrors), []); }
async function mode(page, expected) { await page.waitForFunction(m => __gameDebug.state().mode === m, expected, { timeout: 20000 }); }
const quantile = (values, fraction) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] || 0;
async function profileScene(name, dpr, baseline) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr }); const page = await ctx.newPage(); track(page, name);
  await ready(page, baseline ? '?baseline=1' : ''); await page.selectOption('#quality-select', 'low'); await page.click('#solo-btn'); await mode(page, 'solo');
  await page.evaluate(() => { __gameDebug.setQuality('low'); __gameDebug.scenario(); }); await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => __gameDebug.resetSamples()); await page.waitForTimeout(5000);
  const samples = await page.evaluate(() => __gameDebug.samples()); const stats = await page.evaluate(() => __gameDebug.stats());
  const cpu = await cdp.send('Profiler.stop'); const after = await cdp.send('Performance.getMetrics');
  await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(cpu.profile)); await page.screenshot({ path: `${out}/${name}.png` });
  assert.ok(samples.length > 5, 'Renderer must produce frames during the heavy scenario');
  const metric = (list, key) => list.metrics.find(m => m.name === key)?.value || 0;
  const row = { name, dpr, samples: samples.length, jsP50Ms: quantile(samples.map(s => s.js), .5), jsP95Ms: quantile(samples.map(s => s.js), .95), frameP95Ms: quantile(samples.map(s => s.frame), .95), draws: quantile(samples.map(s => s.draws), .5), triangles: quantile(samples.map(s => s.triangles), .5), heapBytes: metric(after, 'JSHeapUsedSize'), layouts: metric(after, 'LayoutCount') - metric(before, 'LayoutCount'), ...stats };
  await ctx.close(); return row;
}
try {
  run(['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173']);
  run(['--input-type=module', '-e', "import { PeerServer } from 'peer'; PeerServer({port:9090,path:'/',host:'127.0.0.1'});"]);
  await waitServer(base); await waitServer('http://127.0.0.1:9090/');
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostContext.newPage(), guest = await guestContext.newPage(); track(host, 'host'); track(guest, 'guest');
  await test('Desktop title renders with all generated textures', async () => { await ready(host, '?signal=9090'); await host.screenshot({ path: `${out}/desktop-title.png` }); assert.ok(await host.locator('#host-btn').isEnabled()); });
  await test('Practice starts, movement, weapons and menu controls work', async () => {
    await host.selectOption('#quality-select', 'low'); await host.click('#solo-btn'); await mode(host, 'solo');
    const before = await host.evaluate(() => __gameDebug.state().state.ships.find(s => s.id === 'host').x);
    await host.keyboard.down('d'); await host.waitForTimeout(500); await host.keyboard.up('d');
    const after = await host.evaluate(() => __gameDebug.state().state.ships.find(s => s.id === 'host').x); assert.ok(after > before + 1);
    await host.keyboard.down(' '); await host.waitForTimeout(350); await host.keyboard.up(' ');
    assert.ok(await host.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'shot')));
    await host.keyboard.press('e');
    // Assert the real state transition, not an assumed software-GPU frame duration.
    await host.waitForFunction(() => __gameDebug.state().state.ships.find(s => s.id === 'host').pulseCooldown > 0, null, { timeout: 5000 });
    assert.ok(await host.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'pulse' && e.faction === 'fleet')));
    await host.click('#pause-btn'); assert.ok(await host.locator('#pause-dialog').isVisible()); await host.click('#resume-btn'); assert.ok(!await host.locator('#pause-dialog').isVisible());
    await host.screenshot({ path: `${out}/practice-combat.png` }); await host.evaluate(() => __gameDebug.leave()); await mode(host, 'menu');
  });
  let room;
  await test('Two independent browser contexts establish a real WebRTC room', async () => {
    await host.fill('#player-name', 'Commander'); await host.selectOption('#faction-select', 'fleet'); await host.click('#host-btn'); await mode(host, 'host');
    room = await host.evaluate(() => __gameDebug.state().code); assert.match(room, /^[A-Z0-9]{6}$/);
    await ready(guest, `?signal=9090&room=${room}`); await guest.fill('#player-name', 'Wingmate'); await guest.selectOption('#faction-select', 'armada'); await guest.selectOption('#quality-select', 'low'); await guest.click('#join-btn'); await mode(guest, 'client');
    await guest.waitForFunction(() => __gameDebug.state().state?.ships.filter(s => !s.bot).length === 2);
    assert.equal(await host.evaluate(() => __gameDebug.state().connectionCount), 1);
  });
  await test('Client movement is replicated by the authoritative host', async () => {
    const id = await guest.evaluate(() => __gameDebug.state().localId);
    const before = await host.evaluate(id => __gameDebug.state().state.ships.find(s => s.id === id).x, id);
    await guest.keyboard.down('a'); await guest.waitForTimeout(700); await guest.keyboard.up('a'); await host.waitForTimeout(200);
    const after = await host.evaluate(id => __gameDebug.state().state.ships.find(s => s.id === id).x, id); assert.ok(after < before - 2, `${before} -> ${after}`);
    await guest.keyboard.down(' '); await guest.waitForTimeout(350); await guest.keyboard.up(' ');
    assert.ok(await host.evaluate(id => __gameDebug.state().state.events.some(e => e.type === 'shot' && e.faction === 'armada'), id));
  });
  await test('Authoritative damage, score and respawn synchronize to the client', async () => {
    assert.equal(await host.evaluate(() => __gameDebug.setupDuel()), true);
    await host.evaluate(() => __gameDebug.destroyRemote());
    await guest.waitForFunction(() => { const d = __gameDebug.state(); return d.state.ships.find(s => s.id === d.localId)?.hp === 0 && d.state.score.fleet >= 1; });
    await guest.screenshot({ path: `${out}/multiplayer-respawn.png` });
    await guest.waitForFunction(() => { const d = __gameDebug.state(); const s = d.state.ships.find(s => s.id === d.localId); return s && s.hp === 100 && s.respawn <= 0; }, null, { timeout: 12000 });
    await host.screenshot({ path: `${out}/multiplayer-host.png` }); await guest.screenshot({ path: `${out}/multiplayer-client.png` });
  });
  await test('Match completion and rematch preserve the room', async () => {
    await host.evaluate(() => __gameDebug.simulateMatchEnd()); await guest.waitForFunction(() => !document.getElementById('result').hidden);
    await host.waitForFunction(() => !document.getElementById('result').hidden); await host.click('#rematch-btn');
    await guest.waitForFunction(() => __gameDebug.state().state?.winner === '' && __gameDebug.state().state?.score.fleet === 0);
    assert.equal(await host.evaluate(() => __gameDebug.state().connectionCount), 1);
  });
  await test('Client leave, rejoin and host shutdown recover cleanly', async () => {
    await guest.evaluate(() => __gameDebug.leave()); await host.waitForFunction(() => __gameDebug.state().connectionCount === 0);
    await guest.fill('#room-input', room); await guest.click('#join-btn'); await mode(guest, 'client'); await guest.waitForFunction(() => __gameDebug.state().state?.ships.filter(s => !s.bot).length === 2);
    await host.evaluate(() => __gameDebug.leave()); await mode(guest, 'menu'); assert.match(await guest.locator('#status-text').textContent(), /host left/i);
  });
  await test('Invalid room code produces an error instead of entering a fake session', async () => {
    await guest.fill('#room-input', 'BAD'); await guest.click('#join-btn'); await guest.waitForFunction(() => document.getElementById('status-text').textContent.includes('6-character'));
    assert.equal(await guest.evaluate(() => __gameDebug.state().mode), 'menu');
  });
  await hostContext.close(); await guestContext.close();
  await test('Mobile layout and touch-enabled practice boot', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const page = await ctx.newPage(); track(page, 'mobile'); await ready(page);
    assert.ok(await page.evaluate(() => document.getElementById('overlay').scrollWidth <= innerWidth + 1)); await page.screenshot({ path: `${out}/mobile-title.png` });
    await page.selectOption('#quality-select', 'low'); await page.click('#solo-btn'); await mode(page, 'solo'); assert.ok(await page.locator('#touch-controls').isVisible()); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/mobile-combat.png` }); await ctx.close();
  });
  const perf = [];
  await test('Profile identical heavy scenes before and after geometry merging at DPR 1 and 2', async () => {
    perf.push(await profileScene('baseline-dpr1', 1, true)); perf.push(await profileScene('optimized-dpr1', 1, false)); perf.push(await profileScene('optimized-dpr2', 2, false));
    await writeFile(`${out}/performance.json`, JSON.stringify(perf, null, 2));
    const [a, b, c] = perf; assert.ok(b.draws < a.draws * 0.6, `Expected fewer submissions: ${a.draws} -> ${b.draws}`); assert.ok(b.draws <= 150); assert.ok(b.triangles <= 300000); assert.equal(b.width, c.width); assert.equal(b.height, c.height);
    const report = ['# Measured rendering comparison', '', 'Runner: GitHub Actions Ubuntu, Playwright Chromium, SwiftShader software GPU. GPU frame timings are relative, not physical-device performance claims.', '', 'Scenario: identical 16 ships, 160 projectiles and 240 particles. Baseline uses separate primitive meshes; optimized uses merged ship meshes. Low preset caps DPR.', '', '| Run | Draw calls | Triangles | rAF JavaScript p95 (ms) | Frame p95 (ms) | Canvas |', '|---|---:|---:|---:|---:|---|', ...perf.map(p => `| ${p.name} | ${p.draws} | ${p.triangles} | ${p.jsP95Ms.toFixed(2)} | ${p.frameP95Ms.toFixed(2)} | ${p.width} x ${p.height} |`), '', `Draw-call reduction: ${((1 - b.draws / a.draws) * 100).toFixed(1)}%.`, '', 'Method follows the supplied webgl-game-perf skill: budget, deterministic worst case, measurement, submission-cost classification, geometry merge, identical rerun, regression gates. CDP CPU profiles and screenshots are attached. The original bundled probe could not navigate in the local managed browser; this runner uses equivalent app counters and CDP measurements. GL sync-query/upload counters are not measured by this harness.'];
    await writeFile(`${out}/PERFORMANCE.md`, report.join('\n'));
  });
  await test('No JavaScript errors or missing texture errors occurred', async () => { assert.deepEqual(errors, []); });
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
} finally {
  await writeFile(`${out}/browser-results.json`, JSON.stringify({ results, errors, browserVersion: browser?.version(), note: 'WebRTC was tested with a local PeerServer and real browser data channels. Public signalling availability, external NAT and TURN traversal are separate deployment checks.' }, null, 2));
  await browser?.close(); for (const child of children) child.kill('SIGTERM');
}
