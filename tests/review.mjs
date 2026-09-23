import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Public application only; no credentials, login cookies or protection bypass.
const base = new URL(process.env.BASE_URL || 'https://starwars-startrek.vercel.app').origin;
assert.equal(base, 'https://starwars-startrek.vercel.app');
const out = 'reports/review';
await mkdir(out, { recursive: true });
const results = [], screenshots = [], errors = [], warnings = [], contexts = [];
const startedAt = new Date().toISOString();
let browser;
async function shot(page, name, caption) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, timeout: 30000 });
  screenshots.push({ file: `${name}.png`, caption, url: page.url(), capturedAt: new Date().toISOString() });
}
async function check(name, page, work) {
  const start = Date.now();
  try { await work(); results.push({ name, passed: true, durationMs: Date.now() - start }); console.log(`PASS ${name}`); return true; }
  catch (error) {
    results.push({ name, passed: false, durationMs: Date.now() - start, message: error.message, stack: error.stack });
    console.error(`FAIL ${name}: ${error.stack}`);
    if (page && !page.isClosed()) await shot(page, `failure-${results.length}`, `Failure: ${name}`).catch(() => {});
    return false;
  }
}
async function context(name, options = {}, expectedAssetFailure = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...options });
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });
  contexts.push({ name, ctx });
  // Observe actual AudioContext state and the master gain without changing routing.
  await ctx.addInitScript(() => {
    const Native = window.AudioContext;
    window.__qaAudio = [];
    if (Native) window.AudioContext = class extends Native {
      constructor(...args) { super(...args); this.__qaGains = []; window.__qaAudio.push(this); }
      createGain() { const node = super.createGain(); this.__qaGains.push(node); return node; }
    };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push({ context: name, message: e.message }));
  page.on('console', e => { if (e.type() === 'warning' || e.type() === 'error') warnings.push({ context: name, level: e.type(), message: e.text() }); });
  page.on('response', r => { if (!expectedAssetFailure && r.url().startsWith(`${base}/`) && /\/(assets|textures)\//.test(r.url()) && r.status() >= 400) errors.push({ context: name, url: r.url(), status: r.status() }); });
  return { ctx, page };
}
async function close(item) {
  const index = contexts.findIndex(x => x.ctx === item.ctx);
  if (index >= 0) {
    const [{ name, ctx }] = contexts.splice(index, 1);
    await ctx.tracing.stop({ path: `${out}/trace-${name}.zip` }).catch(e => warnings.push({ context: name, message: `Trace export: ${e.message}` }));
    await ctx.close();
  }
}
async function load(page, suffix = '', allowMissing = false) {
  const response = await page.goto(`${base}/${suffix}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.ok(response?.ok(), `HTTP ${response?.status()}`);
  assert.equal(new URL(page.url()).origin, base, 'Unexpected authentication redirect');
  await page.waitForFunction(() => window.__gameDebug?.ready, null, { timeout: 30000 });
  if (!allowMissing) assert.deepEqual(await page.evaluate(() => __gameDebug.stats().assetErrors), []);
  await page.selectOption('#quality-select', 'low');
}
async function mode(page, value) { await page.waitForFunction(v => __gameDebug.state().mode === v, value, { timeout: 30000 }); }
async function local(page) { return page.evaluate(() => { const d = __gameDebug.state(); return d.state?.ships.find(s => s.id === d.localId); }); }
async function practice(page) { await page.click('#solo-btn'); await mode(page, 'solo'); await page.waitForFunction(() => __gameDebug.state().state?.ships.length > 0); }
async function leave(page) { await page.evaluate(() => __gameDebug.leave()); await mode(page, 'menu'); }
async function touchDrag(page, selector, dx, dy, heldMs = 600) {
  const box = await page.locator(selector).boundingBox(); assert.ok(box, `Missing touch control ${selector}`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
  await page.waitForTimeout(heldMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
try {
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const desktop = await context('desktop'); const p = desktop.page;
  const boots = await check('Desktop public HTTPS, WebGL and generated textures', p, async () => {
    await load(p); assert.match(await p.title(), /STELLAR RIFT/);
    assert.ok((await p.evaluate(() => __gameDebug.stats())).draws > 0);
    await p.selectOption('#quality-select', 'medium'); await p.waitForTimeout(700);
    await shot(p, '01-desktop-command', 'Public production command screen, 1440 x 900.');
    await p.selectOption('#quality-select', 'low');
  });
  if (boots) {
    await check('Invalid room input stays in the menu with an error', p, async () => {
      await p.fill('#room-input', 'BAD'); await p.click('#join-btn');
      await p.waitForFunction(() => document.getElementById('status-text').textContent.includes('6-character'));
      assert.equal(await p.evaluate(() => __gameDebug.state().mode), 'menu');
      await shot(p, '02-invalid-room', 'Validation rejects an incomplete room code.');
    });
    await check('Solo practice, keyboard movement, boost and weapons', p, async () => {
      await p.fill('#player-name', 'QA Commander'); await practice(p);
      const before = await local(p);
      await p.keyboard.down('d'); await p.keyboard.down('Shift'); await p.waitForTimeout(650); await p.keyboard.up('Shift'); await p.keyboard.up('d');
      const after = await local(p); assert.ok(after.x > before.x + 1); assert.ok(after.energy < before.energy);
      await p.keyboard.down(' '); await p.waitForTimeout(350); await p.keyboard.up(' ');
      assert.ok(await p.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'shot')));
      await p.keyboard.press('e'); await p.waitForFunction(() => __gameDebug.state().state.ships.find(s => s.id === 'host').pulseCooldown > 0);
      await shot(p, '03-solo-combat', 'Live solo sortie after movement, boost, fire and a deflector pulse.');
    });
    await check('WebAudio activates and mute/unmute changes master gain', p, async () => {
      await p.waitForFunction(() => __qaAudio.some(c => c.state === 'running'));
      await p.click('#sound-btn'); assert.equal(await p.locator('#sound-btn').getAttribute('aria-pressed'), 'false');
      await p.waitForFunction(() => __qaAudio[0].__qaGains[0].gain.value < 0.001);
      await p.click('#sound-btn'); assert.equal(await p.locator('#sound-btn').getAttribute('aria-pressed'), 'true');
      await p.waitForFunction(() => __qaAudio[0].__qaGains[0].gain.value > 0.05);
    });
    await check('Tactical menu opens, resumes and closes with Escape', p, async () => {
      await p.click('#pause-btn'); assert.ok(await p.locator('#pause-dialog').isVisible());
      await shot(p, '04-tactical-menu', 'Tactical menu with control reference and room exit.');
      await p.click('#resume-btn'); assert.ok(!await p.locator('#pause-dialog').isVisible());
      await p.keyboard.press('Escape'); assert.ok(await p.locator('#pause-dialog').isVisible());
      await p.keyboard.press('Escape'); assert.ok(!await p.locator('#pause-dialog').isVisible());
    });
    await check('All quality presets resize without missing assets', p, async () => {
      await leave(p);
      for (const quality of ['high', 'medium', 'low', 'auto']) {
        await p.selectOption('#quality-select', quality); await p.waitForTimeout(200);
        const stats = await p.evaluate(() => __gameDebug.stats()); assert.ok(stats.width > 0 && stats.height > 0); assert.deepEqual(stats.assetErrors, []);
      }
      await p.selectOption('#quality-select', 'low');
    });
    await check('Pilot name and render quality persist across reload', p, async () => {
      await practice(p); await leave(p); await load(p);
      assert.equal(await p.locator('#player-name').inputValue(), 'QA Commander');
      assert.equal(await p.locator('#quality-select').inputValue(), 'low');
    });
    await check('Repeated practice entry and exit keeps texture count stable', p, async () => {
      const counts = [];
      for (let i = 0; i < 3; i++) { await practice(p); await p.waitForTimeout(300); await leave(p); await p.waitForTimeout(250); counts.push((await p.evaluate(() => __gameDebug.stats())).textures); }
      assert.ok(counts.every(n => n === counts[0]), `Texture counts: ${counts}`);
    });
  }
  await close(desktop);

  const host = await context('multiplayer-host', { viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const guest = await context('multiplayer-client', { viewport: { width: 1280, height: 800 } });
  let room, invite;
  const connected = await check('Real public WebRTC, copy invite and URL-based room join', host.page, async () => {
    await load(host.page); await host.page.fill('#player-name', 'QA Starfleet'); await host.page.click('#host-btn'); await mode(host.page, 'host');
    room = await host.page.evaluate(() => __gameDebug.state().code); assert.match(room, /^[A-Z0-9]{6}$/);
    await host.page.click('#copy-room'); invite = await host.page.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(invite).searchParams.get('room'), room);
    await load(guest.page, `?room=${room}`); assert.equal(await guest.page.locator('#room-input').inputValue(), room);
    await guest.page.fill('#player-name', 'QA Empire'); await guest.page.selectOption('#faction-select', 'armada'); await guest.page.click('#join-btn'); await mode(guest.page, 'client');
    await guest.page.waitForFunction(() => __gameDebug.state().state?.ships.filter(s => !s.bot).length === 2);
    assert.equal(await host.page.evaluate(() => __gameDebug.state().connectionCount), 1);
  });
  if (connected) {
    await check('Remote movement and firing reach the authoritative host', guest.page, async () => {
      const id = await guest.page.evaluate(() => __gameDebug.state().localId);
      const before = await host.page.evaluate(id => __gameDebug.state().state.ships.find(s => s.id === id).x, id);
      await guest.page.keyboard.down('a'); await guest.page.waitForTimeout(800); await guest.page.keyboard.up('a'); await host.page.waitForTimeout(250);
      const after = await host.page.evaluate(id => __gameDebug.state().state.ships.find(s => s.id === id).x, id); assert.ok(after < before - 1);
      await guest.page.keyboard.down(' '); await guest.page.waitForTimeout(500); await guest.page.keyboard.up(' ');
      assert.ok(await host.page.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'shot' && e.faction === 'armada')));
      await shot(host.page, '05-multiplayer-host', 'Live Starfleet host with a connected Empire pilot.');
      await shot(guest.page, '06-multiplayer-client', 'Independent browser session in the same live WebRTC room.');
    });
    await check('Damage, score and respawn replicate using an explicit defeat fixture', guest.page, async () => {
      assert.equal(await host.page.evaluate(() => __gameDebug.setupDuel()), true);
      await host.page.evaluate(() => __gameDebug.destroyRemote());
      await guest.page.waitForFunction(() => { const d = __gameDebug.state(); return d.state?.ships.find(s => s.id === d.localId)?.hp === 0 && d.state.score.fleet > 0; });
      await guest.page.waitForFunction(() => !document.getElementById('respawn').hidden);
      await shot(guest.page, '07-client-respawn', 'Client respawn UI after a host-authoritative defeat fixture.');
      await guest.page.waitForFunction(() => { const d = __gameDebug.state(); const s = d.state?.ships.find(s => s.id === d.localId); return s?.hp === 100 && s.respawn <= 0; }, null, { timeout: 12000 });
    });
    await check('Fixture-triggered match end and rematch retain the WebRTC room', guest.page, async () => {
      await host.page.evaluate(() => __gameDebug.simulateMatchEnd());
      await guest.page.waitForFunction(() => !document.getElementById('result').hidden);
      await shot(guest.page, '08-match-result', 'Replicated match-result screen; end condition triggered by the QA fixture.');
      await host.page.waitForFunction(() => !document.getElementById('result').hidden); await host.page.click('#rematch-btn');
      await guest.page.waitForFunction(() => __gameDebug.state().state?.winner === '' && __gameDebug.state().state?.score.fleet === 0);
      assert.equal(await host.page.evaluate(() => __gameDebug.state().connectionCount), 1);
    });
    await check('Leaving during respawn clears the defeat overlay from the menu', guest.page, async () => {
      await host.page.evaluate(() => { __gameDebug.setupDuel(); __gameDebug.destroyRemote(); });
      await guest.page.waitForFunction(() => !document.getElementById('respawn').hidden);
      await guest.page.click('#pause-btn'); await guest.page.click('#leave-btn'); await mode(guest.page, 'menu');
      assert.ok(!await guest.page.locator('#respawn').isVisible(), 'Defeat overlay remains visible over the command screen');
      await shot(guest.page, '09-clean-room-exit', 'Command screen after leaving while the ship was destroyed.');
    });
    await check('Client rejoin and host shutdown recover without a fake connection', guest.page, async () => {
      if (await guest.page.evaluate(() => __gameDebug.state().mode) !== 'menu') await leave(guest.page);
      await guest.page.fill('#room-input', room); await guest.page.click('#join-btn'); await mode(guest.page, 'client');
      await host.page.click('#pause-btn'); await host.page.click('#leave-btn'); await mode(guest.page, 'menu');
      assert.match(await guest.page.locator('#status-text').textContent(), /host left/i);
      await shot(guest.page, '10-host-disconnect', 'Client returns to command with an explicit host-disconnection message.');
    });
    await check('A closed room is rejected and the menu remains usable', guest.page, async () => {
      await guest.page.fill('#room-input', room); await guest.page.click('#join-btn');
      await guest.page.waitForFunction(() => !document.getElementById('join-btn').disabled, null, { timeout: 35000 });
      assert.equal(await guest.page.evaluate(() => __gameDebug.state().mode), 'menu');
      assert.match(await guest.page.locator('#status-text').textContent(), /host|room|connection/i);
    });
  }
  await close(host); await close(guest);

  const mobile = await context('mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const m = mobile.page;
  const mobileReady = await check('Mobile portrait menu fits and practice exposes touch controls', m, async () => {
    await load(m); assert.ok(await m.evaluate(() => document.getElementById('overlay').scrollWidth <= innerWidth + 1));
    await shot(m, '11-mobile-command', 'Mobile-emulated command screen, 390 x 844 CSS pixels, DPR 2.');
    await practice(m); assert.ok(await m.locator('#move-stick').isVisible()); assert.ok(await m.locator('#aim-stick').isVisible());
  });
  if (mobileReady) {
    await check('Real emulated touch drag moves the ship', m, async () => {
      const before = await local(m); await touchDrag(m, '#move-stick', 30, 0);
      assert.ok((await local(m)).x > before.x + 1);
    });
    await check('Touch aim/fire and pulse activate combat actions', m, async () => {
      await touchDrag(m, '#aim-stick', 0, -30);
      assert.ok(await m.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'shot')));
      await m.locator('#touch-pulse').tap();
      await m.waitForFunction(() => __gameDebug.state().state.ships.find(s => s.id === 'host').pulseCooldown > 0);
      await shot(m, '12-mobile-combat', 'Portrait combat after actual emulated touch movement, aim/fire and pulse gestures.');
    });
    await check('Mobile landscape resize keeps rendering and menu usable', m, async () => {
      await m.setViewportSize({ width: 844, height: 390 }); await m.waitForTimeout(500);
      assert.ok((await m.evaluate(() => __gameDebug.stats())).draws > 0);
      await shot(m, '13-mobile-landscape', 'Touch-enabled combat after rotation to an 844 x 390 viewport.');
      await m.locator('#pause-btn').tap(); assert.ok(await m.locator('#pause-dialog').isVisible());
      await m.locator('#resume-btn').tap();
    });
  }
  await close(mobile);

  const small = await context('small-mobile', { viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await check('Small 320 x 568 viewport can scroll to and start practice', small.page, async () => {
    await load(small.page); assert.ok(await small.page.evaluate(() => document.getElementById('overlay').scrollWidth <= innerWidth + 1));
    await shot(small.page, '14-small-mobile-command', 'Small mobile viewport; launch controls remain reachable by scrolling.');
    await practice(small.page); assert.ok(await small.page.locator('#touch-controls').isVisible());
  });
  await close(small);

  const degraded = await context('asset-fallback', {}, true);
  await check('A deliberately blocked nebula texture produces a usable fallback', degraded.page, async () => {
    await degraded.ctx.route('**/textures/nebula.webp', route => route.abort('failed'));
    await load(degraded.page, '', true);
    assert.ok((await degraded.page.evaluate(() => __gameDebug.stats())).assetErrors.length > 0);
    assert.match(await degraded.page.locator('#status-text').textContent(), /missing texture/i);
    await practice(degraded.page); assert.ok((await degraded.page.evaluate(() => __gameDebug.stats())).draws > 0);
    await shot(degraded.page, '15-texture-fallback', 'Fault injection: nebula request blocked only in this test browser; fallback combat still renders.');
  });
  await close(degraded);

  const loss = await context('context-loss');
  await check('Graphics context loss returns to a clear recovery message', loss.page, async () => {
    await load(loss.page); await practice(loss.page);
    const supported = await loss.page.evaluate(() => {
      const gl = document.getElementById('game-canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_lose_context'); if (!ext) return false; ext.loseContext(); return true;
    });
    assert.ok(supported, 'Runner does not expose context-loss simulation');
    await loss.page.waitForFunction(() => document.getElementById('status-text').textContent.includes('Graphics context lost'));
    assert.equal(await loss.page.evaluate(() => __gameDebug.state().mode), 'menu');
    await shot(loss.page, '16-context-loss-recovery', 'Fault injection: WebGL context loss produces an explicit reload instruction.');
  });
  await close(loss);
  await check('No uncaught JavaScript errors or unexpected failed game assets', null, async () => assert.deepEqual(errors, []));
} catch (error) {
  results.push({ name: 'Review harness completed', passed: false, message: error.message, stack: error.stack });
  console.error(error.stack);
} finally {
  for (const item of [...contexts]) await close(item).catch(() => {});
  const report = { url: base, startedAt, completedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null, browser: browser?.version(), results, screenshots, errors, warnings,
    limitations: ['Chromium with SwiftShader on a GitHub Actions runner; not a hardware frame-rate measurement.', 'Mobile is browser emulation with actual touch events, not physical iOS or Android hardware.', 'Multiplayer uses public PeerJS signalling and real WebRTC between two independent browser contexts on one runner; arbitrary external NAT/firewall traversal is not established.', 'Damage, respawn and match-end replication use named deterministic QA fixtures; normal weapons are exercised separately.', 'Audio checks verify running context and master gain, not subjective soundtrack quality.', 'Firefox, Safari/WebKit, eight simultaneous human clients and long-duration soak are not covered by this review.'] };
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  const rows = results.map(r => `| ${r.passed ? 'PASS' : 'FAIL'} | ${r.name.replaceAll('|', '/')} | ${r.message?.replaceAll('|', '/').replaceAll('\n', ' ') || ''} |`);
  const text = ['# STELLAR RIFT: Playwright production review', '', `URL: ${base}`, `Completed: ${report.completedAt}`, `Source commit: ${report.commit}`, `Chromium: ${report.browser}`, '', `Passed: ${results.filter(r => r.passed).length}/${results.length}`, '', '| Result | Check | Details |', '|---|---|---|', ...rows, '', '## Screenshots', '', ...screenshots.map(s => `- [${s.caption}](${s.file})`), '', '## Scope and limitations', '', ...report.limitations.map(s => `- ${s}`), '', 'Traces record browser operations and network activity. Assertions and outcomes are in results.json. Open a trace with `npx playwright show-trace trace-desktop.zip`.', ''].join('\n');
  await writeFile(`${out}/REVIEW.md`, text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
  await browser?.close();
  if (results.some(r => !r.passed)) process.exitCode = 1;
}
