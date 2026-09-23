import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sector } from './sector.js';
import { RULES, clamp } from './simulation.js';
const COLORS = { fleet: 0x66dfff, armada: 0xff7447 };
export class View {
  constructor(canvas) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.35;
    this.scene = new T.Scene(); this.camera = new T.PerspectiveCamera(56, 1, 0.2, 1600);
    this.scene.fog = new T.FogExp2(0x050a13, 0.0035);
    this.camera.position.set(0, 44, 66); this.camera.lookAt(0, 0, 0);
    this.ships = new Map(); this.fx = []; this.pulses = []; this.quality = 'auto'; this.scale = 1; this.slow = 0; this.fast = 0;
    this.v = new T.Vector3(); this.dummy = new T.Object3D(); this.ray = new T.Raycaster(); this.mouse = new T.Vector2(); this.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    this.assetErrors = []; this.optimized = new URLSearchParams(location.search).get('baseline') !== '1';
  }
  async init() {
    const loader = new T.TextureLoader(); this.textures = {};
    await Promise.all(['fleetHull', 'armadaHull', 'nebula', 'lava'].map(async name => {
      try { const t = await loader.loadAsync(`/textures/${name}.webp`); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); this.textures[name] = t; }
      catch { this.assetErrors.push(name); }
    }));
    this.sector = new Sector(this);
    this.parts = {}; this.materials = {}; this.merged = {};
    for (const faction of ['fleet', 'armada']) {
      this.parts[faction] = this.makeParts(faction);
      this.merged[faction] = this.parts[faction].map(parts => mergeGeometries(parts));
      this.materials[faction] = [new T.MeshStandardMaterial({ map: this.textures[faction + 'Hull'], color: faction === 'fleet' ? 0xe0e7ec : 0xa3aab4, metalness: 0.55, roughness: 0.45 }), new T.MeshStandardMaterial({ color: COLORS[faction], emissive: COLORS[faction], emissiveIntensity: 2.2, roughness: 0.5 })];
    }
    this.plumeGeo = {};
    this.plumeMat = {};
    for (const faction of ['fleet', 'armada']) {
      const cones = (faction === 'fleet' ? [-2.9, 2.9] : [-1.6, 0, 1.6]).map(x => { const g = new T.ConeGeometry(0.48, 4, 8, 1, true).toNonIndexed(); g.rotateX(-Math.PI / 2); g.translate(x, 0, -2); return g; });
      this.plumeGeo[faction] = mergeGeometries(cones); cones.forEach(g => g.dispose());
      this.plumeMat[faction] = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { tint: { value: new T.Color(COLORS[faction]) } }, vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'uniform vec3 tint;varying vec2 v;void main(){gl_FragColor=vec4(tint*1.5,pow(1.-v.y,1.4)*.55);}' });
    }
    this.shieldGeo = new T.IcosahedronGeometry(4.6, 1);
    this.bullets = new T.InstancedMesh(new T.BoxGeometry(0.28, 0.28, 4), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), RULES.bullets); this.bullets.instanceMatrix.setUsage(T.DynamicDrawUsage); this.bullets.frustumCulled = false; this.bullets.count = 0; this.scene.add(this.bullets);
    this.particles = new T.InstancedMesh(new T.IcosahedronGeometry(0.25, 0), new T.MeshBasicMaterial({ color: 0xffca74, toneMapped: false }), 240); this.particles.instanceMatrix.setUsage(T.DynamicDrawUsage); this.particles.frustumCulled = false; this.particles.count = 0; this.scene.add(this.particles);
    for (let i = 0; i < 6; i++) { const mesh = new T.Mesh(new T.RingGeometry(0.95, 1, 48), new T.MeshBasicMaterial({ color: 0x7cdbff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false })); mesh.rotation.x = -Math.PI / 2; mesh.visible = false; this.scene.add(mesh); this.pulses.push({ mesh, age: 1 }); }
    this.hero = this.shipModel('fleet'); this.hero.position.set(19, 3, 14); this.hero.scale.setScalar(2.5); this.hero.rotation.y = -0.6; this.scene.add(this.hero);
    this.enemyHero = this.shipModel('armada'); this.enemyHero.position.set(-22, 0, -22); this.enemyHero.scale.setScalar(1.8); this.enemyHero.rotation.y = 1.5; this.scene.add(this.enemyHero);
    this.sector.decorate();
    this.colorCache = { fleet: new T.Color(COLORS.fleet), armada: new T.Color(COLORS.armada) };
    this.setQuality('auto');
  }
  makeParts(faction) {
    const out = [[], []];
    const add = (g, x, y, z, sx = 1, sy = 1, sz = 1, material = 0, rx = 0, rz = 0) => { g.rotateX(rx); g.rotateZ(rz); g.scale(sx, sy, sz); g.translate(x, y, z); const b = g.index ? g.toNonIndexed() : g; if (g.index) g.dispose(); out[material].push(b); };
    if (faction === 'fleet') {
      add(new T.CylinderGeometry(3.1, 3.5, 0.65, 32), 0, 0, 1.7, 1, 1, 1.05);
      add(new T.SphereGeometry(1, 12, 8), 0, 0.55, 1.7, 1, 0.35, 1);
      add(new T.BoxGeometry(0.7, 0.6, 3), 0, -0.2, -1.1);
      add(new T.CapsuleGeometry(0.75, 2.5, 4, 12), 0, -0.4, -2.3, 1, 1, 1, 0, Math.PI / 2);
      for (const x of [-2.9, 2.9]) { add(new T.BoxGeometry(2.9, 0.22, 0.4), x / 2, -0.1, -2.5); add(new T.CapsuleGeometry(0.4, 3, 4, 10), x, 0, -2.7, 1, 1, 1, 0, Math.PI / 2); add(new T.BoxGeometry(0.18, 0.23, 2.5), x, 0.3, -2.7, 1, 1, 1, 1); add(new T.SphereGeometry(0.34, 8, 6), x, 0, -4.3, 1, 1, 1, 1); }
      for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; add(new T.BoxGeometry(0.08, 0.09, 0.18), Math.sin(a) * 3.05, 0.14, 1.7 + Math.cos(a) * 3.16, 1, 1, 1, 1); }
      for (const z of [-1.6, -2.4, -3.2]) add(new T.BoxGeometry(1.4, 0.15, 0.13), 0, 0.1, z);
      add(new T.TorusGeometry(2.75, 0.035, 4, 32), 0, 0.36, 1.7, 1, 1, 1, 1, Math.PI / 2);
    } else {
      const shape = new T.Shape(); shape.moveTo(-4.1, -3.4); shape.lineTo(0, 6); shape.lineTo(4.1, -3.4); shape.closePath();
      const wedge = new T.ExtrudeGeometry(shape, { depth: 0.65, bevelEnabled: false, steps: 1 }); wedge.rotateX(Math.PI / 2); add(wedge, 0, 0.4, 0);
      add(new T.BoxGeometry(2.2, 0.8, 2.9), 0, 0.6, -1.9); add(new T.BoxGeometry(1.1, 0.7, 0.6), 0, 1.3, -2.1);
      for (const x of [-2.5, -1.25, 0, 1.25, 2.5]) add(new T.CylinderGeometry(0.28, 0.4, 0.4, 8), x, 0, -3.5, 1, 1, 1, 1, Math.PI / 2);
      for (const x of [-1.8, -1.2, 1.2, 1.8]) { add(new T.BoxGeometry(0.32, 0.4, 3.2), x, 0.5, -1); add(new T.BoxGeometry(0.09, 0.06, 2.7), x, 0.73, -1, 1, 1, 1, 1); }
      for (const x of [-0.7, 0.7]) add(new T.SphereGeometry(0.3, 8, 6), x, 1.7, -2.1);
      add(new T.BoxGeometry(0.12, 0.05, 6), 0, 0.48, 1, 1, 1, 1, 1);
    }
    return out;
  }
  shipModel(faction) {
    const group = new T.Group();
    if (this.optimized) for (let i = 0; i < 2; i++) group.add(new T.Mesh(this.merged[faction][i], this.materials[faction][i]));
    else for (let i = 0; i < 2; i++) for (const geo of this.parts[faction][i]) group.add(new T.Mesh(geo, this.materials[faction][i]));
    return group;
  }
  addShip(data) {
    const group = this.shipModel(data.faction); group.position.set(data.x, 0, data.z);
    const shield = new T.Mesh(this.shieldGeo, new T.MeshBasicMaterial({ color: COLORS[data.faction], wireframe: true, transparent: true, opacity: 0.18, depthWrite: false })); shield.visible = false; group.add(shield);
    const plume = new T.Mesh(this.plumeGeo[data.faction], this.plumeMat[data.faction]); plume.position.z = data.faction === 'fleet' ? -4.3 : -3.6; group.add(plume);
    this.scene.add(group); const item = { group, shield, plume }; this.ships.set(data.id, item); return item;
  }
  clear() { this.sector.flashes.length = 0; this.sector.hitTime = this.sector.killTime = this.sector.damageTime = 0; for (const item of this.ships.values()) { this.scene.remove(item.group); item.shield.material.dispose(); } this.ships.clear(); this.fx.length = 0; this.bullets.count = this.particles.count = 0; for (const p of this.pulses) p.mesh.visible = false; }
  effect(e) {
    if (e.type === 'explosion' || e.type === 'hit') {
      const count = e.type === 'explosion' ? 32 : 5;
      for (let i = 0; i < count && this.fx.length < 240; i++) { const a = i * 2.39996, speed = e.type === 'explosion' ? 4 + i % 8 : 3; this.fx.push({ x: e.x, y: 0.4, z: e.z, vx: Math.cos(a) * speed, vy: (i % 5 - 1) * 1.4, vz: Math.sin(a) * speed, life: e.type === 'explosion' ? 0.85 : 0.22 }); }
    }
    if (e.type === 'pulse' || e.type === 'explosion') { const p = this.pulses.find(p => p.age >= 0.65); if (p) { p.age = 0; p.mesh.position.set(e.x, 0.15, e.z); p.mesh.material.color.setHex(e.type === 'explosion' ? 0xffc477 : COLORS[e.faction]); p.mesh.visible = true; } }
  }
  aim(clientX, clientY, ship) {
    this.mouse.set(clientX / innerWidth * 2 - 1, 1 - clientY / innerHeight * 2); this.ray.setFromCamera(this.mouse, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.v) || !ship) return { ax: 0, az: 1 };
    const x = this.v.x - ship.x, z = this.v.z - ship.z, n = Math.hypot(x, z) || 1; return { ax: x / n, az: z / n };
  }
  setQuality(q) { this.quality = q; this.scale = q === 'low' ? 0.75 : 1; this.resize(); }
  resize() { const cap = this.quality === 'low' ? 1 : this.quality === 'high' ? 1.75 : 1.25; this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap) * this.scale); this.renderer.setSize(innerWidth, innerHeight, false); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  frame(state, localId, dt, elapsed, frameMs) {
    this.hero.visible = this.enemyHero.visible = !state;
    if (!state) { this.hero.position.y = 3 + Math.sin(elapsed * 0.5) * 0.6; this.camera.position.lerp(this.v.set(0, 44, 66), 0.03); this.camera.lookAt(0, 0, 0); }
    else {
      const seen = new Set();
      for (const data of state.ships) { seen.add(data.id); const item = this.ships.get(data.id) || this.addShip(data); item.group.visible = data.respawn <= 0; item.group.position.lerp(this.v.set(data.x, Math.sin(elapsed * 2 + data.x) * 0.15, data.z), Math.min(1, dt * 18)); const delta = Math.atan2(Math.sin(data.angle - item.group.rotation.y), Math.cos(data.angle - item.group.rotation.y)); item.group.rotation.y += delta * Math.min(1, dt * 20); item.plume.scale.z = 0.4 + Math.hypot(data.vx, data.vz) / 30; item.shield.visible = data.hit > 0 || data.invulnerable > 0; item.shield.material.opacity = data.hit > 0 ? 0.45 : 0.12; }
      for (const [id, item] of this.ships) if (!seen.has(id)) { this.scene.remove(item.group); item.shield.material.dispose(); this.ships.delete(id); }
      const local = state.ships.find(s => s.id === localId);
      if (local) { const item = this.ships.get(localId); this.camera.position.lerp(this.v.set(item.group.position.x + local.vx * 0.25, 79 * this.sector.zoom, item.group.position.z + 58 * this.sector.zoom + local.vz * 0.25), 1 - Math.exp(-3 * dt)); this.camera.lookAt(item.group.position.x, 0, item.group.position.z); }
      this.bullets.count = Math.min(RULES.bullets, state.bullets.length);
      this.dummy.scale.set(1, 1, 1);
      for (let i = 0; i < this.bullets.count; i++) { const b = state.bullets[i]; this.dummy.position.set(b.x, 0.5, b.z); this.dummy.rotation.set(0, Math.atan2(b.vx, b.vz), 0); this.dummy.updateMatrix(); this.bullets.setMatrixAt(i, this.dummy.matrix); this.bullets.setColorAt(i, this.colorCache[b.faction]); }
      if (this.bullets.count) { this.bullets.instanceMatrix.needsUpdate = true; this.bullets.instanceColor.needsUpdate = true; }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.life -= dt; if (f.life <= 0) { this.fx[i] = this.fx[this.fx.length - 1]; this.fx.pop(); continue; } f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt; }
    this.particles.count = this.fx.length;
    for (let i = 0; i < this.fx.length; i++) { const f = this.fx[i]; this.dummy.position.set(f.x, f.y, f.z); this.dummy.scale.setScalar(Math.min(1.4, f.life * 3)); this.dummy.updateMatrix(); this.particles.setMatrixAt(i, this.dummy.matrix); }
    if (this.fx.length) this.particles.instanceMatrix.needsUpdate = true;
    for (const p of this.pulses) { p.age += dt; if (p.age < 0.65) { p.mesh.scale.setScalar(1 + p.age / 0.65 * 15); p.mesh.material.opacity = (1 - p.age / 0.65) * 0.7; } else p.mesh.visible = false; }
    if (this.quality === 'auto' && frameMs < 250) { this.slow = frameMs > 24 ? this.slow + 1 : 0; this.fast = frameMs < 17.5 ? this.fast + 1 : 0; if (this.slow > 40 && this.scale > 0.65) { this.scale = Math.max(0.65, this.scale - 0.1); this.slow = 0; this.resize(); } else if (this.fast > 240 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.05); this.fast = 0; this.resize(); } }
    this.sector.frame(state, localId, dt);
    this.renderer.render(this.scene, this.camera);
  }
  stats() { const i = this.renderer.info; return { draws: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, scale: this.scale, width: this.renderer.domElement.width, height: this.renderer.domElement.height, optimized: this.optimized, assetErrors: this.assetErrors }; }
}
