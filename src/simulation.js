export const RULES = Object.freeze({ radius: 240, core: 12, step: 1 / 60, players: 8, ships: 16, bullets: 160, duration: 300, target: 25 });
// World distances are metres and speeds are metres per second.
export const BALANCE = Object.freeze({ humanHull: 100, botHull: 72, playerDamage: 25, botDamage: 10, playerInterval: 0.28, botInterval: 0.46, burstShots: 3, burstRest: 1.8, acquisition: 1.15, turnRate: 0.9, attackRange: 76, botSpeed: 16, botBoost: 25, grace: 3, attackers: 2 });
export const COVER = Object.freeze([
  { x: -68, z: -48, r: 12 }, { x: 68, z: 48, r: 12 },
  { x: -32, z: 75, r: 10 }, { x: 32, z: -75, r: 10 }
]);
export const DOCKS = Object.freeze([{ x: -160, z: 65, faction: 'fleet' }, { x: 160, z: -65, faction: 'armada' }]);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export function profile(value = {}) {
  return { name: String(value.name || 'Rift pilot').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 16) || 'Rift pilot', faction: value.faction === 'armada' ? 'armada' : 'fleet' };
}
export function cleanInput(value = {}) {
  return { x: clamp(finite(value.x), -1, 1), z: clamp(finite(value.z), -1, 1), ax: clamp(finite(value.ax), -1, 1), az: clamp(finite(value.az, 1), -1, 1), fire: value.fire === true, boost: value.boost === true, pulse: clamp(Math.floor(finite(value.pulse)), 0, 2147483647) };
}
export function segmentDistance2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, n = dx * dx + dz * dz;
  const t = n ? clamp(((px - ax) * dx + (pz - az) * dz) / n, 0, 1) : 0;
  return (px - ax - t * dx) ** 2 + (pz - az - t * dz) ** 2;
}
export class World {
  constructor(seed = 42) {
    this.seed = seed >>> 0 || 42; this.ships = new Map(); this.bullets = [];
    this.time = 0; this.score = { fleet: 0, armada: 0 }; this.events = []; this.eventId = 0; this.bulletId = 0; this.winner = ''; this.god = false;
  }
  random() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }
  add(id, info, bot = false) {
    if (this.ships.has(id)) return this.ships.get(id);
    if (this.ships.size >= RULES.ships) return null;
    const p = profile(info);
    const s = { id, ...p, bot, x: 0, z: 0, vx: 0, vz: 0, angle: p.faction === 'fleet' ? Math.PI / 2 : -Math.PI / 2, hp: 100, energy: 100, cooldown: 0, pulseCooldown: 0, lastPulse: 0, respawn: 0, invulnerable: 1.5, hit: 0, kills: 0, deaths: 0, target: '', think: 0, lock: 0, aimX: 0, aimZ: 1, burstLeft: 3, burstRest: 0, lastHurt: -100, maxHp: bot ? BALANCE.botHull : BALANCE.humanHull, input: cleanInput(), inputAt: this.time };
    this.ships.set(id, s); this.respawn(s); return s;
  }
  bots(count = 6) {
    for (let i = 0; i < count && this.ships.size < RULES.ships; i++) {
      const id = `bot-${this.ships.size}-${i}`;
      this.add(id, { name: i % 2 ? 'Imperial sentinel' : 'Starfleet escort', faction: i % 2 ? 'armada' : 'fleet' }, true);
    }
  }
  remove(id) { this.ships.delete(id); }
  setInput(id, value) { const s = this.ships.get(id); if (!s || s.bot) return; s.input = cleanInput(value); s.inputAt = this.time; }
  respawn(s) {
    // Pick a separated spawn in friendly space, not in the nearest crossfire.
    let best = -1, x = 0, z = 0;
    for (let i = 0; i < 16; i++) {
      const a = this.random() * Math.PI * 2, r = 16 + this.random() * 34;
      const px = (s.faction === 'fleet' ? -118 : 118) + Math.cos(a) * r, pz = Math.sin(a) * r;
      let clearance = Infinity;
      for (const t of this.ships.values()) if (t.id !== s.id && t.respawn <= 0) {
        clearance = Math.min(clearance, Math.hypot(t.x - px, t.z - pz) * (t.faction === s.faction ? 2 : 1));
      }
      if (clearance > best) { best = clearance; x = px; z = pz; }
    }
    s.x = x; s.z = z; s.vx = s.vz = 0; s.hp = s.maxHp; s.energy = 100;
    s.respawn = 0; s.cooldown = 0.3; s.invulnerable = BALANCE.grace;
    s.lock = 0; s.target = ''; s.think = 0; s.burstLeft = BALANCE.burstShots; s.burstRest = 0;
  }
  lineOfSight(ax, az, bx, bz) {
    if (segmentDistance2(0, 0, ax, az, bx, bz) < RULES.core ** 2) return false;
    return !COVER.some(c => segmentDistance2(c.x, c.z, ax, az, bx, bz) < c.r ** 2);
  }

  emit(type, s, extra = {}) {
    this.events.push({ id: ++this.eventId, type, x: s.x, z: s.z, faction: s.faction, ...extra });
    if (this.events.length > 36) this.events.shift();
  }
  hurt(s, damage, owner) {
    if (s.respawn > 0 || s.invulnerable > 0 || (this.god && !s.bot)) return;
    s.hp = Math.max(0, s.hp - damage); s.hit = 0.18; s.lastHurt = this.time;
    this.emit('hit', s, { shipId: s.id, ownerId: owner?.id, damage });
    if (s.hp > 0) return;
    s.respawn = 2.5; s.vx = s.vz = 0; s.deaths++;
    if (owner && owner.faction !== s.faction) { owner.kills++; this.score[owner.faction]++; }
    this.emit('explosion', s, { shipId: s.id, ownerId: owner?.id, message: owner ? `${owner.name} destroyed ${s.name}` : `${s.name} lost in the Rift` });
  }
  botInput(s, dt) {
    s.think -= dt; s.burstRest = Math.max(0, s.burstRest - dt);
    let target = this.ships.get(s.target);
    if (s.think <= 0 || !target || target.respawn > 0 || Math.hypot(target.x - s.x, target.z - s.z) > 150) {
      let nearest = Infinity, next = null;
      for (const t of this.ships.values()) {
        if (t.faction === s.faction || t.respawn > 0 || t.invulnerable > 0) continue;
        // Other bots hold or engage escorts instead of a whole squad focus-firing one pilot.
        let pursuing = 0;
        for (const ally of this.ships.values()) if (ally.bot && ally.id !== s.id && ally.target === t.id && ally.respawn <= 0) pursuing++;
        if (pursuing >= BALANCE.attackers) continue;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        const cost = d + pursuing * 28 - (t.id === s.target ? 22 : 0);
        if (d < 150 && cost < nearest) { nearest = cost; next = t; }
      }
      if (next?.id !== s.target) { s.lock = 0; s.burstLeft = BALANCE.burstShots; s.burstRest = Math.max(s.burstRest, 0.4); }
      target = next; s.target = next?.id || ''; s.think = 0.35 + this.random() * 0.15;
      if (target) {
        // Sampled, imperfect aim. The bot does not read fresh velocity every frame.
        s.aimX = target.x - s.x + (this.random() - 0.5) * 11;
        s.aimZ = target.z - s.z + (this.random() - 0.5) * 11;
      }
    }
    if (!target) {
      s.lock = 0;
      // Patrol the approaches rather than stacking on the central obstacle.
      const px = s.faction === 'fleet' ? -46 : 46, pz = Math.sin(this.time * 0.11 + s.x) * 48;
      const n = Math.max(12, Math.hypot(px - s.x, pz - s.z));
      return cleanInput({ x: (px - s.x) / n * 0.65, z: (pz - s.z) / n * 0.65 });
    }
    let dx = target.x - s.x, dz = target.z - s.z;
    const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist;
    const clear = this.lineOfSight(s.x, s.z, target.x, target.z);
    s.lock = clear && dist < BALANCE.attackRange && target.invulnerable <= 0 ? Math.min(BALANCE.acquisition, s.lock + dt) : 0;
    const drift = Math.sin(this.time * 0.65 + s.x * 0.013) * 0.22;
    const advance = dist > 48 ? 0.8 : dist < 29 ? -0.45 : 0;
    let x = dx * advance + dz * drift, z = dz * advance - dx * drift;
    // Steer around real cover. A fixed handedness breaks radial deadlocks.
    for (const c of [{ x: 0, z: 0, r: RULES.core }, ...COVER]) {
      const ox = s.x - c.x, oz = s.z - c.z, n = Math.hypot(ox, oz) || 1;
      if (n < c.r + 22) { const k = (c.r + 22 - n) / 16; x += ox / n * k + oz / n * 0.45; z += oz / n * k - ox / n * 0.45; }
    }
    const aim = Math.atan2(s.aimX, s.aimZ), error = Math.abs(Math.atan2(Math.sin(aim - s.angle), Math.cos(aim - s.angle)));
    return { x, z, ax: Math.sin(aim), az: Math.cos(aim), fire: s.lock >= BALANCE.acquisition && s.burstRest <= 0 && error < 0.18 && clear, boost: dist > 110, pulse: s.lastPulse };
  }
  tick(dt = RULES.step) {
    if (this.winner) return;
    dt = clamp(finite(dt), 0, 0.05); this.time += dt;
    for (const s of this.ships.values()) {
      if (s.respawn > 0) { s.respawn -= dt; if (s.respawn <= 0) this.respawn(s); continue; }
      s.cooldown -= dt; s.pulseCooldown = Math.max(0, s.pulseCooldown - dt); s.invulnerable = Math.max(0, s.invulnerable - dt); s.hit = Math.max(0, s.hit - dt);
      const input = s.bot ? this.botInput(s, dt) : this.time - s.inputAt < 0.4 ? s.input : cleanInput();
      const n = Math.max(1, Math.hypot(input.x, input.z));
      const boost = input.boost && s.energy > 5 && n > 0;
      const speed = s.bot ? (boost ? BALANCE.botBoost : BALANCE.botSpeed) : (boost ? 42 : 26);
      const blend = 1 - Math.exp(-7 * dt);
      s.vx += (input.x / n * speed - s.vx) * blend; s.vz += (input.z / n * speed - s.vz) * blend;
      s.x += s.vx * dt; s.z += s.vz * dt;
      const r = Math.hypot(s.x, s.z);
      if (r > RULES.radius - 3 || r < RULES.core + 3) {
        const edge = r > RULES.radius - 3 ? RULES.radius - 3 : RULES.core + 3;
        s.x = (r ? s.x / r : 1) * edge; s.z = (r ? s.z / r : 0) * edge; s.vx *= -0.2; s.vz *= -0.2;
      }
      for (const c of COVER) {
        const dx = s.x - c.x, dz = s.z - c.z, n = Math.hypot(dx, dz);
        if (n < c.r + 3) { s.x = c.x + (n ? dx / n : 1) * (c.r + 3); s.z = c.z + (n ? dz / n : 0) * (c.r + 3); }
      }
      if (Math.hypot(input.ax, input.az) > 0.1) {
        const angle = Math.atan2(input.ax, input.az);
        const delta = Math.atan2(Math.sin(angle - s.angle), Math.cos(angle - s.angle));
        s.angle += s.bot ? clamp(delta, -BALANCE.turnRate * dt, BALANCE.turnRate * dt) : delta;
      }
      for (const dock of DOCKS) if (s.faction === dock.faction && Math.hypot(s.x - dock.x, s.z - dock.z) < 22 && this.time - s.lastHurt > 5) s.hp = Math.min(s.maxHp, s.hp + 12 * dt);
      s.energy = clamp(s.energy + (boost ? -22 : 13) * dt, 0, 100);
      if (input.fire && s.cooldown <= 0 && this.bullets.length < RULES.bullets) {
        const ax = Math.sin(s.angle), az = Math.cos(s.angle);
        this.bullets.push({ id: ++this.bulletId, owner: s.id, faction: s.faction, x: s.x + ax * 5, z: s.z + az * 5, vx: ax * (s.bot ? 64 : 125), vz: az * (s.bot ? 64 : 125), life: s.bot ? 1.4 : 1.6, damage: s.bot ? BALANCE.botDamage : BALANCE.playerDamage });
        s.cooldown = s.bot ? BALANCE.botInterval : BALANCE.playerInterval;
        if (s.bot && --s.burstLeft <= 0) { s.burstLeft = BALANCE.burstShots; s.burstRest = BALANCE.burstRest; }
        this.emit('shot', s, { shipId: s.id });
      }
      if (input.pulse > s.lastPulse) {
        s.lastPulse = input.pulse;
        if (s.pulseCooldown <= 0 && s.energy >= 35) {
          s.energy -= 35; s.pulseCooldown = 5.5; this.emit('pulse', s);
          for (let i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].faction !== s.faction && Math.hypot(this.bullets[i].x - s.x, this.bullets[i].z - s.z) < 20) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); }
          for (const t of this.ships.values()) if (t.bot && t.target === s.id && Math.hypot(t.x - s.x, t.z - s.z) < 30) { t.lock = 0; t.burstRest = Math.max(1.5, t.burstRest); }
          for (const t of this.ships.values()) if (t.faction !== s.faction && Math.hypot(t.x - s.x, t.z - s.z) < 15) this.hurt(t, 32, s);
        }
      }
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], ox = b.x, oz = b.z;
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      let dead = b.life <= 0 || Math.hypot(b.x, b.z) > RULES.radius + 10 || segmentDistance2(0, 0, ox, oz, b.x, b.z) < RULES.core ** 2 || COVER.some(c => segmentDistance2(c.x, c.z, ox, oz, b.x, b.z) < c.r ** 2);
      if (!dead) for (const s of this.ships.values()) {
        if (s.faction === b.faction || s.respawn > 0) continue;
        if (segmentDistance2(s.x, s.z, ox, oz, b.x, b.z) < 3 ** 2) { this.hurt(s, b.damage ?? 20, this.ships.get(b.owner)); dead = true; break; }
      }
      if (dead) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); }
    }
    if (this.score.fleet >= RULES.target || this.score.armada >= RULES.target || this.time >= RULES.duration) this.winner = this.score.fleet === this.score.armada ? 'draw' : this.score.fleet > this.score.armada ? 'fleet' : 'armada';
  }
  snapshot() {
    return { time: this.time, score: { ...this.score }, winner: this.winner, ships: [...this.ships.values()].map(s => ({ id: s.id, name: s.name, faction: s.faction, bot: s.bot, maxHp: s.maxHp, target: s.target, lock: s.lock, burstRest: s.burstRest, x: s.x, z: s.z, vx: s.vx, vz: s.vz, angle: s.angle, hp: s.hp, energy: s.energy, respawn: s.respawn, invulnerable: s.invulnerable, hit: s.hit, kills: s.kills, deaths: s.deaths, pulseCooldown: s.pulseCooldown })), bullets: this.bullets.map(b => ({ id: b.id, x: b.x, z: b.z, vx: b.vx, vz: b.vz, faction: b.faction })), events: this.events.slice() };
  }
}
