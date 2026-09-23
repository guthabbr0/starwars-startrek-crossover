import * as T from 'three';
import { RULES, BALANCE, COVER, DOCKS, clamp } from './simulation.js';

// One forward-rendered battlefield. Lighting, halos and trails do not need a
// full-screen bloom chain; static detail shares geometry and materials.
export class Sector {
  constructor(view) {
    this.view = view; this.zoom = 1; this.clock = 0; this.hudClock = 0;
    this.projected = new T.Vector3(); this.flashes = []; this.damageTime = 0; this.hitTime = 0; this.killTime = 0;
    this.canvas = document.getElementById('tactical-overlay'); this.ctx = this.canvas.getContext('2d');
    const { scene, textures: t } = view;
    scene.fog = new T.FogExp2(0x071321, 0.0008);
    scene.add(new T.HemisphereLight(0xb6d9ff, 0x1d192d, 2.7));
    const key = new T.DirectionalLight(0xffe7c6, 4.2); key.position.set(-40, 80, 20); scene.add(key);
    const rim = new T.DirectionalLight(0x719fff, 2.1); rim.position.set(60, 10, -80); scene.add(rim);
    scene.add(new T.Mesh(new T.SphereGeometry(950, 40, 24), new T.MeshBasicMaterial({ map: t.nebula, color: 0x485b72, side: T.BackSide, fog: false })));
    this.metal = new T.MeshStandardMaterial({ map: t.fleetHull, color: 0x778896, metalness: 0.55, roughness: 0.67 });
    this.dark = new T.MeshStandardMaterial({ map: t.armadaHull, color: 0x4a5967, metalness: 0.5, roughness: 0.7 });
    this.ice = new T.MeshBasicMaterial({ color: 0x66e3ff, toneMapped: false });
    this.amber = new T.MeshBasicMaterial({ color: 0xffa568, toneMapped: false });
    this.rock = new T.MeshStandardMaterial({ map: t.lava, color: 0xa0a3a7, roughness: 0.97, bumpMap: t.lava, bumpScale: 0.3 });
    const add = (geo, mat, x, y, z, rx = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; scene.add(m); return m; };
    const floor = add(new T.CircleGeometry(RULES.radius, 96), new T.ShaderMaterial({ transparent: true, depthWrite: false, vertexShader: 'varying vec2 p;void main(){p=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: `varying vec2 p;void main(){vec2 g=abs(fract(p/20.-.5)-.5)/max(fwidth(p/20.),vec2(.001));float line=1.-min(min(g.x,g.y),1.);float a=(.018+.07*line)*(1.-smoothstep(215.,240.,length(p)));gl_FragColor=vec4(.16,.52,.65,a);}` }), 0, -5, 0, -Math.PI / 2);
    floor.renderOrder = -1;
    add(new T.TorusGeometry(RULES.radius, 0.1, 4, 180), this.ice, 0, -4, 0, Math.PI / 2);
    // Real cover corresponds exactly to collision and line-of-sight geometry.
    for (const c of COVER) {
      const geometry = new T.IcosahedronGeometry(c.r, 2), vertices = geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) { const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i), k = 0.88 + 0.11 * Math.sin(x * 1.3 + z * 0.7) * Math.cos(y * 1.9); vertices.setXYZ(i, x * k, y * k, z * k); }
      geometry.computeVertexNormals(); const asteroid = add(geometry, this.rock, c.x, -3, c.z); asteroid.scale.y = 0.78;
      add(new T.TorusGeometry(c.r + 1, 0.05, 4, 64), this.amber, c.x, -2, c.z, Math.PI / 2);
    }
    this.core = add(new T.SphereGeometry(RULES.core, 40, 24), new T.MeshStandardMaterial({ map: t.lava, color: 0xbfa78b, roughness: 0.8, emissive: 0xff450a, emissiveMap: t.lava, emissiveIntensity: 0.24 }), 0, -7, 0);
    const haloMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.BackSide, uniforms: { tint: { value: new T.Color(0xff873a) } }, vertexShader: 'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}', fragmentShader: 'uniform vec3 tint;varying vec3 n;varying vec3 v;void main(){float f=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(tint,f*.65);}' });
    add(new T.SphereGeometry(12.6, 32, 20), haloMat, 0, -7, 0);
    this.orbit = add(new T.TorusGeometry(19, 0.08, 4, 96), this.amber, 0, -5, 0, 1.3); this.orbit.rotation.z = 0.25;
    // A distant ringed world lends the arena scale without participating in combat.
    const gas = new T.ShaderMaterial({ vertexShader: 'varying vec3 p;varying vec3 n;varying vec3 v;void main(){p=normalize(position);vec4 w=modelMatrix*vec4(position,1.);n=normalize(mat3(modelMatrix)*normal);v=cameraPosition-w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}', fragmentShader: `varying vec3 p;varying vec3 n;varying vec3 v;void main(){float curl=sin(p.x*8.+p.z*4.)*.7+sin(p.z*15.+p.y*9.)*.2;float bands=.5+.5*sin(p.y*57.+curl*3.);vec3 tint=mix(vec3(.15,.25,.36),vec3(.52,.67,.71),bands);tint=mix(tint,vec3(.71,.65,.49),smoothstep(.79,.94,sin(p.y*23.+curl)*.5+.5)*.55);float light=pow(max(0.,dot(normalize(n),normalize(vec3(-.6,.8,.4)))),.65);float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(tint*(.07+light*1.8)+vec3(.15,.4,.66)*rim*.28,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` });
    const planet = add(new T.SphereGeometry(95, 48, 32), gas, 250, -180, -460);
    const ringMaterial = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, vertexShader: 'varying vec2 p;void main(){p=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'varying vec2 p;void main(){float r=length(p);float edge=smoothstep(120.,124.,r)*(1.-smoothstep(177.,181.,r));float bands=.35+.65*pow(.5+.5*sin(r*2.8),2.);float gap=1.-smoothstep(149.,151.,r)*(1.-smoothstep(154.,156.,r));gl_FragColor=vec4(vec3(.61,.68,.72),edge*bands*gap*.42);}' });
    const rings = add(new T.RingGeometry(120, 181, 144), ringMaterial, planet.position.x, planet.position.y, planet.position.z, 1.08); rings.rotation.z = 0.22;
    // Gate, trusses and aperture are deliberately open: the landmark is not a wall.
    this.gate = new T.Group(); this.gate.position.set(0, 12, -172); scene.add(this.gate);
    for (const [radius, width, material] of [[28, 1.8, this.metal], [25.7, 0.22, this.ice], [31, 0.45, this.dark]]) this.gate.add(new T.Mesh(new T.TorusGeometry(radius, width, 6, 80), material));
    const trusses = new T.InstancedMesh(new T.BoxGeometry(3, 7, 3), this.metal, 12), d = new T.Object3D();
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; d.position.set(Math.sin(a) * 29, Math.cos(a) * 29, 0); d.rotation.set(0, 0, -a); d.updateMatrix(); trusses.setMatrixAt(i, d.matrix); } this.gate.add(trusses);
    for (const dock of DOCKS) {
      const mat = dock.faction === 'fleet' ? this.ice : this.amber;
      add(new T.TorusGeometry(21, 0.22, 4, 80), mat, dock.x, -2, dock.z, Math.PI / 2);
      add(new T.RingGeometry(19.6, 20, 64), mat, dock.x, -2, dock.z, -Math.PI / 2);
      const pad = add(new T.CylinderGeometry(15, 17, 3, 32), this.dark, dock.x, -10, dock.z); pad.rotation.y = Math.PI / 6;
      for (const k of [-1, 1]) add(new T.BoxGeometry(2, 8, 7), this.metal, dock.x + k * 21, -5, dock.z);
    }
    let seed = 812; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const stars = new Float32Array(2400 * 3);
    for (let i = 0; i < 2400; i++) { const a = random() * Math.PI * 2, z = random() * 2 - 1, r = Math.sqrt(1 - z * z); stars.set([r * Math.cos(a) * 820, z * 600, r * Math.sin(a) * 820], i * 3); }
    const starGeo = new T.BufferGeometry(); starGeo.setAttribute('position', new T.BufferAttribute(stars, 3)); scene.add(new T.Points(starGeo, new T.PointsMaterial({ size: 0.9, color: 0xe4ebff, fog: false })));
    const rubble = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), this.rock, 180);
    for (let i = 0; i < 180; i++) { const a = random() * Math.PI * 2, r = 32 + random() * 270; d.position.set(Math.cos(a) * r, -18 - random() * 22, Math.sin(a) * r); d.scale.setScalar(0.5 + random() * 3); d.rotation.set(random() * 6, random() * 6, random() * 6); d.updateMatrix(); rubble.setMatrixAt(i, d.matrix); } scene.add(rubble);
    this.cursor = add(new T.RingGeometry(5.8, 6, 48), this.ice, 0, -1, 0, -Math.PI / 2); this.cursor.visible = false;
  }
  decorate() {
    const v = this.view;
    for (const faction of ['fleet', 'armada']) { const carrier = v.shipModel(faction); carrier.scale.setScalar(5); carrier.position.set(faction === 'fleet' ? -178 : 178, -23, faction === 'fleet' ? 28 : -28); carrier.rotation.y = faction === 'fleet' ? 1.3 : -1.3; v.scene.add(carrier); }
  }
  project(x, y, z) { this.projected.set(x, y, z).project(this.view.camera); return { x: (this.projected.x * 0.5 + 0.5) * innerWidth, y: (-this.projected.y * 0.5 + 0.5) * innerHeight, visible: this.projected.z < 1 && this.projected.z > -1 }; }
  event(e, localId) {
    if (e.type === 'hit' && e.shipId === localId) this.damageTime = 0.3;
    if (e.type === 'hit' && e.ownerId === localId) { this.hitTime = 0.18; if (this.flashes.length < 24) this.flashes.push({ x: e.x, z: e.z, life: 0.65, damage: e.damage }); }
    if (e.type === 'explosion' && e.ownerId === localId) this.killTime = 1.8;
  }
  frame(state, localId, dt) {
    this.clock += dt; this.hudClock += dt;
    this.gate.rotation.z = Math.sin(this.clock * 0.05) * 0.12; this.core.rotation.y = this.clock * 0.015;
    this.damageTime = Math.max(0, this.damageTime - dt); this.hitTime = Math.max(0, this.hitTime - dt); this.killTime = Math.max(0, this.killTime - dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].life -= dt; if (this.flashes[i].life <= 0) this.flashes.splice(i, 1); }
    const local = state?.ships.find(s => s.id === localId);
    this.cursor.visible = !!local && local.respawn <= 0;
    if (local) this.cursor.position.set(local.x, -1.8, local.z);
    if (this.hudClock < 0.05) return; this.hudClock = 0;
    const c = this.ctx, width = innerWidth, height = innerHeight;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    c.clearRect(0, 0, width, height); if (!local || local.respawn > 0) return;
    if (this.damageTime > 0) { c.strokeStyle = `rgba(255,88,66,${this.damageTime})`; c.lineWidth = 18; c.strokeRect(0, 0, width, height); }
    c.textAlign = 'center'; c.font = '10px monospace';
    for (const d of DOCKS) {
      const p = this.project(d.x, 1, d.z); if (!p.visible || p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
      c.fillStyle = d.faction === local.faction ? '#92e1c5' : '#9b8193'; c.fillText(d.faction === local.faction ? 'REPAIR DOCK / FRIENDLY' : 'ENEMY REPAIR DOCK', p.x, p.y + 34);
    }
    let threats = 0, closest = null, distance = Infinity;
    for (const s of state.ships) {
      if (s.id === localId || s.respawn > 0) continue;
      const enemy = s.faction !== local.faction, dist = Math.hypot(s.x - local.x, s.z - local.z);
      if (enemy && dist < distance) { closest = s; distance = dist; }
      if (enemy && s.target === localId && s.lock > 0) threats++;
      const p = this.project(s.x, 4, s.z);
      if (!p.visible) continue;
      if (p.x < 28 || p.x > width - 28 || p.y < 100 || p.y > height - 140) {
        if (enemy && dist < 140) { const x = clamp(p.x, 26, width - 26), y = clamp(p.y, 110, height - 145); c.fillStyle = '#ffac79'; c.fillText('◇', x, y); c.fillText(`${Math.round(dist)} m`, x, y + 14); } continue;
      }
      c.fillStyle = enemy ? '#ffac79' : '#9addf0'; c.fillText(enemy ? '⌖' : '◇', p.x, p.y - 18);
      if (dist < 120) {
        c.font = '9px monospace'; c.fillText(s.bot ? (enemy ? 'HOSTILE' : 'ESCORT') : s.name, p.x, p.y - 32);
        c.fillStyle = 'rgba(3,12,24,.8)'; c.fillRect(p.x - 23, p.y - 13, 46, 5);
        c.fillStyle = enemy ? '#ff9461' : '#68cde3'; c.fillRect(p.x - 22, p.y - 12, 44 * clamp(s.hp / (s.maxHp || 100), 0, 1), 3);
        if (enemy && s.target === localId && s.lock > 0) { c.fillStyle = '#ffdb8d'; c.fillText(s.burstRest > 0 ? 'RELOADING' : s.lock >= BALANCE.acquisition ? 'FIRING' : 'ACQUIRING', p.x, p.y - 45); }
      }
    }
    // A lead cue helps a human aim; it never bends projectiles or applies damage.
    if (closest && distance < 150) {
      const flight = Math.min(1.6, distance / 125), from = this.project(closest.x, 4, closest.z);
      const lead = this.project(closest.x + closest.vx * flight, 0.5, closest.z + closest.vz * flight);
      if (lead.visible && lead.x > 28 && lead.x < width - 28 && lead.y > 100 && lead.y < height - 140) {
        c.strokeStyle = 'rgba(248,227,174,.7)'; c.lineWidth = 1; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(lead.x, lead.y); c.stroke(); c.setLineDash([]);
        c.beginPath(); c.arc(lead.x, lead.y, 5, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#f4dda8'; c.font = '8px monospace'; c.fillText('LEAD', lead.x, lead.y + 17);
      }
    }
    for (const f of this.flashes) { const p = this.project(f.x, 6 + (0.65 - f.life) * 8, f.z); c.fillStyle = `rgba(240,224,159,${Math.min(1, f.life * 3)})`; c.font = 'bold 17px monospace'; c.fillText(`-${f.damage}`, p.x, p.y); }
    const reticle = document.getElementById('reticle'); reticle.classList.toggle('confirmed-hit', this.hitTime > 0);
    const banner = document.getElementById('combat-banner');
    const dock = DOCKS.find(d => d.faction === local.faction && Math.hypot(d.x - local.x, d.z - local.z) < 22);
    const text = this.killTime > 0 ? 'TARGET ELIMINATED' : local.invulnerable > 0 ? `SPAWN SHIELD / ${local.invulnerable.toFixed(1)} s` : dock ? 'FRIENDLY DOCK / HULL REPAIR AFTER 5 s CLEAR' : threats ? `${threats} HOSTILE ${threats === 1 ? 'LOCK' : 'LOCKS'} / BREAK LINE OF SIGHT` : 'OPEN SECTOR / SCROLL TO ZOOM';
    if (banner.textContent !== text) banner.textContent = text; banner.classList.toggle('danger', threats > 0 && this.killTime <= 0);
    const target = document.getElementById('target-readout'), text2 = closest ? `NEAREST HOSTILE  /  ${Math.round(distance)} m  /  HULL ${Math.ceil(closest.hp)}` : 'SECTOR CLEAR';
    if (target.textContent !== text2) target.textContent = text2;
  }
}
