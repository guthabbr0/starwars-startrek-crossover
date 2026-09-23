import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Test only this project's public Vercel URLs. No authentication bypass is used.
const raw = process.env.BASE_URL || '';
if (!raw) throw new Error('BASE_URL must be supplied by the Vercel deployment event.');
const url = new URL(raw.startsWith('https://') ? raw : `https://${raw}`);
assert.equal(url.protocol, 'https:');
assert.ok(!url.username && !url.password, 'Credentials are not accepted in deployment URLs.');
assert.ok(url.hostname === 'starwars-startrek.vercel.app' || (url.hostname.startsWith('starwars-startrek-') && url.hostname.endsWith('.vercel.app')), 'Unexpected project hostname.');
const base = url.origin;
const output = 'reports/live';
await mkdir(output, { recursive: true });
const results = [], errors = [];
let browser;
async function check(name, work) {
  const started = Date.now();
  try { await work(); results.push({ name, passed: true, durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, message: error.message }); throw error; }
}
function observe(page, label) {
  page.on('pageerror', error => errors.push({ page: label, message: error.message }));
  page.on('response', response => {
    if (response.url().startsWith(base + '/') && response.status() >= 400 && /\/(assets|textures)\//.test(response.url())) errors.push({ page: label, status: response.status(), url: response.url() });
  });
}
async function load(page) {
  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.ok(response?.ok(), `Deployment returned HTTP ${response?.status()}. Protected deployments need an authorized public production URL.`);
  assert.equal(new URL(page.url()).origin, base, 'Deployment redirected away from the application.');
  await page.waitForFunction(() => window.__gameDebug?.ready, null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => __gameDebug.stats().assetErrors), []);
  await page.selectOption('#quality-select', 'low');
}
async function waitMode(page, desired) {
  try { await page.waitForFunction(mode => window.__gameDebug?.state().mode === mode, desired, { timeout: 30000 }); }
  catch (error) { throw new Error(`Expected ${desired}; application status: ${await page.locator('#status-text').textContent()}`, { cause: error }); }
}
try {
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const a = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await a.newPage(), guest = await b.newPage();
  observe(host, 'host'); observe(guest, 'guest');
  await check('Public HTTPS deployment boots WebGL and loads its textures', async () => {
    await load(host); await host.waitForTimeout(600);
    assert.ok((await host.evaluate(() => __gameDebug.stats())).draws > 0);
    await host.screenshot({ path: `${output}/desktop.png` });
  });
  await check('Live practice supports movement, weapons and menu recovery', async () => {
    await host.click('#solo-btn'); await waitMode(host, 'solo');
    const before = await host.evaluate(() => __gameDebug.state().state.ships.find(s => s.id === 'host').x);
    await host.keyboard.down('d'); await host.waitForTimeout(650); await host.keyboard.up('d');
    const after = await host.evaluate(() => __gameDebug.state().state.ships.find(s => s.id === 'host').x);
    assert.ok(after > before + 1);
    await host.keyboard.down(' '); await host.waitForTimeout(300); await host.keyboard.up(' ');
    assert.ok(await host.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'shot')));
    await host.click('#pause-btn'); await host.click('#leave-btn'); await waitMode(host, 'menu');
  });
  let room;
  await check('Public PeerJS signalling connects two independent browser sessions', async () => {
    await host.fill('#player-name', 'CI-Host'); await host.selectOption('#faction-select', 'fleet'); await host.click('#host-btn'); await waitMode(host, 'host');
    room = await host.evaluate(() => __gameDebug.state().code); assert.match(room, /^[A-Z0-9]{6}$/);
    await load(guest); await guest.fill('#player-name', 'CI-Wing'); await guest.selectOption('#faction-select', 'armada'); await guest.fill('#room-input', room); await guest.click('#join-btn'); await waitMode(guest, 'client');
    await guest.waitForFunction(() => __gameDebug.state().state?.ships.filter(s => !s.bot).length === 2);
    assert.equal(await host.evaluate(() => __gameDebug.state().connectionCount), 1);
  });
  await check('Live multiplayer replicates movement and firing', async () => {
    const id = await guest.evaluate(() => __gameDebug.state().localId);
    const before = await host.evaluate(id => __gameDebug.state().state.ships.find(s => s.id === id).x, id);
    await guest.keyboard.down('a'); await guest.waitForTimeout(900); await guest.keyboard.up('a'); await host.waitForTimeout(200);
    const after = await host.evaluate(id => __gameDebug.state().state.ships.find(s => s.id === id).x, id);
    assert.ok(after < before - 2);
    await guest.keyboard.down(' '); await guest.waitForTimeout(400); await guest.keyboard.up(' ');
    assert.ok(await host.evaluate(() => __gameDebug.state().state.events.some(e => e.type === 'shot' && e.faction === 'armada')));
    await host.screenshot({ path: `${output}/multiplayer-host.png` }); await guest.screenshot({ path: `${output}/multiplayer-client.png` });
  });
  await check('Closing the host recovers the live client cleanly', async () => {
    await host.click('#pause-btn'); await host.click('#leave-btn'); await waitMode(guest, 'menu');
    assert.match(await guest.locator('#status-text').textContent(), /host left/i);
  });
  await a.close(); await b.close();
  await check('Live mobile layout and touch-enabled practice boot', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage(); observe(page, 'mobile'); await load(page);
    assert.ok(await page.evaluate(() => document.getElementById('overlay').scrollWidth <= innerWidth + 1));
    await page.click('#solo-btn'); await waitMode(page, 'solo'); assert.ok(await page.locator('#touch-controls').isVisible());
    await page.screenshot({ path: `${output}/mobile.png` }); await context.close();
  });
  await check('No uncaught application errors or failed game assets', async () => assert.deepEqual(errors, []));
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ url: base, testedAt: new Date().toISOString(), results, errors, browserVersion: browser?.version(), note: 'Uses the deployed application and public PeerJS signalling. Peers run in separate browser contexts on one runner; this does not prove connectivity through every external NAT or firewall.' }, null, 2));
  console.log(`Tested deployment: ${base}`);
  await browser?.close();
}
