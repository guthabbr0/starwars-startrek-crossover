import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
assert.ok(['http://127.0.0.1:4173', 'https://starwars-startrek.vercel.app'].includes(new URL(base).origin));
const out = 'reports/horizon'; await mkdir(out, { recursive: true });
const results = [], errors = []; let browser, server;
const check = async (name, fn) => { try { const details = await fn(); results.push({ name, passed: true, details }); } catch (e) { results.push({ name, passed: false, error: e.message }); process.exitCode = 1; } };
try {
  if (!process.env.BASE_URL) { server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'ignore' }); for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); } }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.tracing.start({ screenshots: true, snapshots: true });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(base); await p.waitForFunction(() => window.__gameDebug?.ready);
  await check('Broken Horizon release boots with the new sector', async () => { assert.match(await p.locator('.version').textContent(), /03/); assert.equal(await p.evaluate(() => __gameDebug.state().release), '0.3.0-broken-horizon'); await p.screenshot({ path: `${out}/01-command.png` }); });
  await p.selectOption('#quality-select', 'medium'); await p.fill('#player-name', 'Horizon QA'); await p.click('#solo-btn');
  await check('Fresh pilot is not destroyed during the first three seconds', async () => { await p.waitForTimeout(3000); const s = await p.evaluate(() => __gameDebug.state().state.ships.find(s => s.id === 'host')); assert.equal(s.deaths, 0); assert.equal(s.hp, 100); return { hp: s.hp, deaths: s.deaths }; });
  await check('Default tactical camera shows threats throughout the bot engagement radius', async () => {
    await p.waitForTimeout(1200); const points = await p.evaluate(() => { const s = __gameDebug.state().state.ships.find(s => s.id === 'host'); return Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return __gameDebug.project(s.x + Math.sin(a) * 76, s.z + Math.cos(a) * 76); }); });
    for (const point of points) assert.ok(point.visible && point.x > 24 && point.x < 1416 && point.y > 100 && point.y < 760, JSON.stringify(point));
    return { radiusMetres: 76, sampledDirections: 12 };
  });
  await check('Practice actually pauses simulation while the tactical menu is open', async () => { await p.keyboard.press('Escape'); const before = await p.evaluate(() => __gameDebug.state().state.time); await p.waitForTimeout(500); const after = await p.evaluate(() => __gameDebug.state().state.time); assert.equal(before, after); await p.click('#resume-btn'); });
  await check('Tactical zoom changes the camera projection and remains bounded', async () => { const before = await p.evaluate(() => __gameDebug.project(-70, 0)); for (let i = 0; i < 3; i++) await p.click('#zoom-out'); await p.waitForTimeout(800); const after = await p.evaluate(() => __gameDebug.project(-70, 0)); assert.ok(Math.abs(before.x - after.x) + Math.abs(before.y - after.y) > 2); for (let i = 0; i < 3; i++) await p.click('#zoom-in'); });
  await check('Real mouse-fired projectiles can kill active AI without god mode', async () => {
    await p.evaluate(() => __gameDebug.combatScenario()); await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/02-active-combat.png` }); await p.mouse.move(720, 450); await p.mouse.down();
    let kills = 0;
    for (let i = 0; i < 110; i++) {
      const aim = await p.evaluate(() => { const d = __gameDebug.state(), me = d.state.ships.find(s => s.id === d.localId); const enemies = d.state.ships.filter(s => s.faction !== me.faction && s.respawn <= 0).sort((a,b) => Math.hypot(a.x-me.x,a.z-me.z)-Math.hypot(b.x-me.x,b.z-me.z)); const t = enemies[0]; return { kills: me.kills, hp: me.hp, point: t ? __gameDebug.project(t.x + t.vx * 0.3, t.z + t.vz * 0.3) : null }; });
      kills = aim.kills; if (aim.point?.visible) await p.mouse.move(aim.point.x, aim.point.y);
      if (i === 30) await p.screenshot({ path: `${out}/02-active-combat.png` });
      if (kills >= 1) break; await p.waitForTimeout(120);
    }
    await p.mouse.up(); assert.ok(kills >= 1, `No eliminations after sustained aimed fire: ${kills}`); await p.screenshot({ path: `${out}/03-confirmed-kill.png` }); return { kills, fixture: 'Positions set by combatScenario; active AI, normal HP, ordinary mouse input; no god mode. Aim is automated, not a novice usability study.' };
  });
  await check('Wide tactical view and readable HUD are present', async () => { for (let i = 0; i < 5; i++) await p.click('#zoom-out'); await p.waitForTimeout(900); assert.ok(await p.locator('#target-readout').isVisible()); assert.ok(await p.locator('#combat-banner').isVisible()); await p.screenshot({ path: `${out}/04-wide-sector.png` }); return await p.evaluate(() => __gameDebug.stats()); });
  await ctx.tracing.stop({ path: `${out}/desktop-trace.zip` }); await ctx.close();
  await check('An outdated client is rejected instead of joining incompatible balance rules', async () => {
    const hc = await browser.newContext(), gc = await browser.newContext();
    await gc.addInitScript(() => {
      const original = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function(data) {
        try { const text = typeof data === 'string' ? data : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? new TextDecoder().decode(data) : ''; const p = JSON.parse(text); if (p.type === 'hello') { p.protocol = 'legacy-2'; const encoded = JSON.stringify(p); data = typeof data === 'string' ? encoded : new TextEncoder().encode(encoded); window.__protocolFaultInjected = true; } } catch {}
        return original.call(this, data);
      };
    });
    const hp = await hc.newPage(), gp = await gc.newPage();
    try {
      await hp.goto(base); await hp.waitForFunction(() => window.__gameDebug?.ready); await hp.click('#host-btn');
      await hp.waitForFunction(() => __gameDebug.state().mode === 'host', null, { timeout: 25000 });
      const code = await hp.evaluate(() => __gameDebug.state().code);
      await gp.goto(base); await gp.waitForFunction(() => window.__gameDebug?.ready); await gp.fill('#room-input', code); await gp.click('#join-btn');
      await gp.waitForFunction(() => document.getElementById('status-text').textContent.includes('Update required'), null, { timeout: 25000 });
      assert.equal(await gp.evaluate(() => __gameDebug.state().mode), 'menu'); assert.equal(await gp.evaluate(() => window.__protocolFaultInjected), true);
      await hp.waitForFunction(() => __gameDebug.state().connectionCount === 0);
      return { fault: 'Only this test browser rewrites hello.protocol to legacy-2; actual WebRTC signalling and host validation are used.' };
    } finally { await hc.close(); await gc.close(); }
  });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const m = await mobile.newPage(); m.on('pageerror', e => errors.push(e.message)); await m.goto(base); await m.waitForFunction(() => window.__gameDebug?.ready); await m.selectOption('#quality-select', 'low'); await m.click('#solo-btn');
  await check('Mobile touch controls and zoom remain usable', async () => { assert.ok(await m.locator('#move-stick').isVisible()); assert.ok(await m.locator('#zoom-out').isVisible()); await m.tap('#zoom-out'); await m.evaluate(() => __gameDebug.combatScenario()); await m.waitForTimeout(1200); await m.screenshot({ path: `${out}/05-mobile-combat.png` }); assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); });
  await mobile.close(); await check('No uncaught JavaScript errors in the new combat paths', async () => assert.deepEqual(errors, []));
} catch (e) { results.push({ name: 'Harness', passed: false, error: e.stack }); process.exitCode = 1; }
finally { await writeFile(`${out}/results.json`, JSON.stringify({ url: base, release: '0.3.0-broken-horizon', results, errors, browser: browser?.version(), note: 'Software-rendered Chromium. Combat fixture is explicit; not a physical-device benchmark or a human playtest.' }, null, 2)); console.log(JSON.stringify(results, null, 2)); await browser?.close(); server?.kill('SIGTERM'); }
