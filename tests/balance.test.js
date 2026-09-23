import test from 'node:test';
import assert from 'node:assert/strict';
import { World, RULES, BALANCE, COVER, DOCKS } from '../src/simulation.js';
const run = (w, seconds, input) => { for (let i = 0; i < seconds * 60; i++) { if (input) w.setInput('host', input); w.tick(); } };
function encounter() {
  const w = new World(82), player = w.add('host', { faction: 'fleet' }), bot = w.add('enemy', { faction: 'armada' }, true);
  Object.assign(player, { x: 90, z: -20, invulnerable: 0 }); Object.assign(bot, { x: 90, z: 26, invulnerable: 0, angle: Math.PI });
  return { w, player, bot };
}
test('sector diameter is 480 m with more than seven times the former usable area', () => { assert.equal(RULES.radius * 2, 480); assert.ok((RULES.radius ** 2 - RULES.core ** 2) / (85 ** 2 - 12 ** 2) > 7); });
test('AI cannot fire before the acquisition delay, even already facing a target', () => { const { w } = encounter(); run(w, 1); assert.ok(!w.events.some(e => e.type === 'shot')); run(w, 2); assert.ok(w.events.some(e => e.type === 'shot')); });
test('AI aim turn is bounded instead of snapping 180 degrees', () => { const { w, bot } = encounter(); bot.angle = 0; const old = bot.angle; w.tick(); assert.ok(Math.abs(bot.angle - old) <= BALANCE.turnRate / 60 + 1e-8); });
test('enemy fires three-shot bursts with a genuine reload gap', () => {
  const { w, bot, player } = encounter(); player.hp = player.maxHp = 10000; const times = []; let id = 0;
  for (let i = 0; i < 600; i++) { w.tick(); for (const e of w.events) if (e.id > id && e.type === 'shot' && e.shipId === bot.id) times.push(w.time); id = w.eventId; }
  assert.ok(times.length >= 4 && times.length <= 12, JSON.stringify(times)); assert.ok(times[1] - times[0] >= 0.45); assert.ok(times[3] - times[2] >= 1.79);
});
test('three confirmed human shots kill a bot; no hidden invulnerability', () => { const { w, player, bot } = encounter(); assert.equal(bot.hp, 72); w.hurt(bot, 25, player); w.hurt(bot, 25, player); assert.equal(bot.hp, 22); w.hurt(bot, 25, player); assert.equal(bot.hp, 0); assert.equal(player.kills, 1); });
test('ten bot hits, not five, are needed to remove a full human hull', () => { const { w, player, bot } = encounter(); for (let i = 0; i < 9; i++) w.hurt(player, BALANCE.botDamage, bot); assert.equal(player.hp, 10); w.hurt(player, BALANCE.botDamage, bot); assert.equal(player.hp, 0); });
test('no more than two AI opponents acquire one human at once', () => { const { w, player } = encounter(); for (let i = 0; i < 5; i++) { const b = w.add(`e${i}`, { faction: 'armada' }, true); Object.assign(b, { x: 80 + i * 4, z: 25 + i * 5, invulnerable: 0 }); } run(w, 3); assert.ok([...w.ships.values()].filter(b => b.bot && b.target === player.id).length <= 2); });
test('cover blocks targeting line of sight and physical projectiles', () => {
  const { w, player, bot } = encounter(), c = COVER[0];
  Object.assign(player, { x: c.x, z: c.z - 25 }); Object.assign(bot, { x: c.x, z: c.z + 25 });
  assert.equal(w.lineOfSight(player.x, player.z, bot.x, bot.z), false);
  // Freeze only the target's movement to isolate actual projectile-cover collision.
  w.botInput = () => ({ x: 0, z: 0, ax: 0, az: -1, fire: false, pulse: 0 }); run(w, 2, { ax: 0, az: 1, fire: true }); assert.equal(bot.hp, 72);
});
test('repair dock heals only allies after disengagement', () => { const { w, player } = encounter(), dock = DOCKS[0]; w.remove('enemy'); Object.assign(player, { x: dock.x, z: dock.z, hp: 30, lastHurt: 0 }); run(w, 4); assert.equal(player.hp, 30); run(w, 3); assert.ok(player.hp >= 53); player.faction = 'armada'; const hp = player.hp; run(w, 2); assert.equal(player.hp, hp); });
test('spawn protection lasts three seconds and keeps damage out', () => { const { w, player, bot } = encounter(); w.respawn(player); assert.equal(player.invulnerable, 3); w.hurt(player, 100, bot); assert.equal(player.hp, 100); });
test('deflector pulse clears hostile projectiles and interrupts nearby AI locks', () => { const { w, player, bot } = encounter(); bot.x = player.x + 20; bot.z = player.z; bot.target = 'host'; bot.lock = BALANCE.acquisition; w.bullets.push({ id: 1, x: player.x + 10, z: player.z, vx: 0, vz: 0, life: 2, faction: 'armada', owner: 'enemy', damage: 10 }); run(w, 1 / 60, { pulse: 1 }); assert.equal(w.bullets.length, 0); assert.ok(bot.burstRest > 1); });
test('stationary frontline pilot survives the initial three seconds without god mode', () => { for (let seed = 1; seed <= 30; seed++) { const { w, player } = encounter(); w.seed = seed; run(w, 3); assert.equal(w.god, false); assert.equal(player.deaths, 0, `seed ${seed}`); assert.ok(player.hp >= 60); } });
