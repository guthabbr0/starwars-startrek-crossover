export const RULES = Object.freeze({ radius: 85, core: 12, step: 1 / 60, players: 8, ships: 16, bullets: 160, duration: 180, target: 25 });
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
    const s = { id, ...p, bot, x: 0, z: 0, vx: 0, vz: 0, angle: p.faction === 'fleet' ? Math.PI / 2 : -Math.PI / 2, hp: 100, energy: 100, cooldown: 0, pulseCooldown: 0, lastPulse: 0, respawn: 0, invulnerable: 1.5, hit: 0, kills: 0, deaths: 0, target: '', think: 0, input: cleanInput(), inputAt: this.time };
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
    const a = this.random() * Math.PI * 2, r = 10 + this.random() * 12;
    s.x = (s.faction === 'fleet' ? -36 : 36) + Math.cos(a) * r; s.z = Math.sin(a) * r;
    s.vx = s.vz = 0; s.hp = 100; s.energy = 100; s.respawn = 0; s.cooldown = 0.3; s.invulnerable = 1.5;
  }
  emit(type, s, extra = {}) {
    this.events.push({ id: ++this.eventId, type, x: s.x, z: s.z, faction: s.faction, ...extra });
    if (this.events.length > 36) this.events.shift();
  }
  hurt(s, damage, owner) {
    if (s.respawn > 0 || s.invulnerable > 0 || (this.god && !s.bot)) return;
    s.hp = Math.max(0, s.hp - damage); s.hit = 0.18;
    this.emit('hit', s);
    if (s.hp > 0) return;
    s.respawn = 2.5; s.vx = s.vz = 0; s.deaths++;
    if (owner && owner.faction !== s.faction) { owner.kills++; this.score[owner.faction]++; }
    this.emit('explosion', s, { message: owner ? `${owner.name} destroyed ${s.name}` : `${s.name} lost in the Rift` });
  }
  botInput(s, dt) {
    s.think -= dt;
    let target = this.ships.get(s.target);
    if (s.think <= 0 || !target || target.respawn > 0) {
      let nearest = Infinity; target = null;
      for (const t of this.ships.values()) {
        if (t.faction === s.faction || t.respawn > 0) continue;
        const d = (t.x - s.x) ** 2 + (t.z - s.z) ** 2;
        if (d < nearest) { nearest = d; target = t; }
      }
      s.target = target?.id || ''; s.think = 0.4;
    }
    if (!target) return cleanInput();
    let dx = target.x + target.vx * 0.12 - s.x, dz = target.z + target.vz * 0.12 - s.z;
    const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist;
    const drift = Math.sin(this.time * 1.2 + s.x * 0.01) * 0.7;
    const advance = dist > 24 ? 0.85 : dist < 13 ? -0.65 : 0;
    let x = dx * advance + dz * drift, z = dz * advance - dx * drift;
    if (Math.hypot(s.x, s.z) < 20) { x += s.x / 12; z += s.z / 12; }
    return { x, z, ax: dx, az: dz, fire: dist < 60, boost: dist > 45, pulse: dist < 12 ? s.lastPulse + 1 : s.lastPulse };
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
      const speed = boost ? 42 : 26;
      const blend = 1 - Math.exp(-7 * dt);
      s.vx += (input.x / n * speed - s.vx) * blend; s.vz += (input.z / n * speed - s.vz) * blend;
      s.x += s.vx * dt; s.z += s.vz * dt;
      const r = Math.hypot(s.x, s.z);
      if (r > RULES.radius - 3 || r < RULES.core + 3) {
        const edge = r > RULES.radius - 3 ? RULES.radius - 3 : RULES.core + 3;
        s.x = (r ? s.x / r : 1) * edge; s.z = (r ? s.z / r : 0) * edge; s.vx *= -0.2; s.vz *= -0.2;
      }
      if (Math.hypot(input.ax, input.az) > 0.1) s.angle = Math.atan2(input.ax, input.az);
      s.energy = clamp(s.energy + (boost ? -22 : 13) * dt, 0, 100);
      if (input.fire && s.cooldown <= 0 && this.bullets.length < RULES.bullets) {
        const ax = Math.sin(s.angle), az = Math.cos(s.angle);
        this.bullets.push({ id: ++this.bulletId, owner: s.id, faction: s.faction, x: s.x + ax * 5, z: s.z + az * 5, vx: ax * 105, vz: az * 105, life: 1.7 });
        s.cooldown = 0.22; this.emit('shot', s);
      }
      if (input.pulse > s.lastPulse) {
        s.lastPulse = input.pulse;
        if (s.pulseCooldown <= 0 && s.energy >= 35) {
          s.energy -= 35; s.pulseCooldown = 5.5; this.emit('pulse', s);
          for (const t of this.ships.values()) if (t.faction !== s.faction && Math.hypot(t.x - s.x, t.z - s.z) < 15) this.hurt(t, 32, s);
        }
      }
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], ox = b.x, oz = b.z;
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      let dead = b.life <= 0 || Math.hypot(b.x, b.z) > RULES.radius + 10 || segmentDistance2(0, 0, ox, oz, b.x, b.z) < RULES.core ** 2;
      if (!dead) for (const s of this.ships.values()) {
        if (s.faction === b.faction || s.respawn > 0) continue;
        if (segmentDistance2(s.x, s.z, ox, oz, b.x, b.z) < 3 ** 2) { this.hurt(s, 20, this.ships.get(b.owner)); dead = true; break; }
      }
      if (dead) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); }
    }
    if (this.score.fleet >= RULES.target || this.score.armada >= RULES.target || this.time >= RULES.duration) this.winner = this.score.fleet === this.score.armada ? 'draw' : this.score.fleet > this.score.armada ? 'fleet' : 'armada';
  }
  snapshot() {
    return { time: this.time, score: { ...this.score }, winner: this.winner, ships: [...this.ships.values()].map(s => ({ id: s.id, name: s.name, faction: s.faction, bot: s.bot, x: s.x, z: s.z, vx: s.vx, vz: s.vz, angle: s.angle, hp: s.hp, energy: s.energy, respawn: s.respawn, invulnerable: s.invulnerable, hit: s.hit, kills: s.kills, deaths: s.deaths, pulseCooldown: s.pulseCooldown })), bullets: this.bullets.map(b => ({ id: b.id, x: b.x, z: b.z, vx: b.vx, vz: b.vz, faction: b.faction })), events: this.events.slice() };
  }
}
