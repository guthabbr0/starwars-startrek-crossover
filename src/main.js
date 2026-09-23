import './style.css';
import { World, RULES, profile, cleanInput } from './simulation.js';
import { Network } from './network.js';
import { View } from './view.js';
import { AudioEngine } from './audio.js';
const $ = id => document.getElementById(id);
const sound = new AudioEngine();
let view, world = null, state = null, mode = 'menu', localId = 'host', code = '', lastEvent = 0, paused = false, frozen = false;
let accumulator = 0, previous = performance.now(), netClock = 0, hudClock = 0, pingClock = 0, elapsed = 0, pulse = 0, fps = 60;
const keys = new Set(), pointer = { x: innerWidth / 2, y: innerHeight / 2, firing: false }, touch = { x: 0, z: 0, ax: 0, az: 0, aiming: false, firing: false };
const samples = []; let recording = false;
const network = new Network((event, data) => {
  if (event === 'join' && world) { world.add(data.id, data.profile); notice(`${data.profile.name} joined the battle`); }
  if (event === 'leave' && world) { world.remove(data); notice('A pilot disconnected'); }
  if (event === 'input' && world) world.setInput(data.id, data.input);
  if (event === 'snapshot') { state = data; consumeEvents(); }
  if (event === 'restart') { lastEvent = 0; view.clear(); $('result').hidden = true; }
  if (event === 'lost') { leave(); status(data); }
  if (event === 'notice') notice(data);
});
function status(text, error = false) { $('status-text').textContent = text; $('status-text').classList.toggle('error', error); }
function notice(text) { if ($('event-feed').textContent !== text) $('event-feed').textContent = text; }
function readProfile() { return profile({ name: $('player-name').value, faction: $('faction-select').value }); }
function clearControls() { keys.clear(); pointer.firing = false; touch.x = touch.z = 0; touch.firing = false; }
function setText(id, text) { if ($(id).textContent !== String(text)) $(id).textContent = String(text); }
function start(sessionMode, id = 'host', room = '') {
  clearControls(); mode = sessionMode; localId = id; code = room; accumulator = 0; lastEvent = 0; frozen = false;
  view.clear(); $('overlay').hidden = true; $('hud').hidden = false; $('result').hidden = true; $('respawn').hidden = true;
  $('room-panel').hidden = !room; setText('room-code', room); $('reticle').hidden = false;
  if (sessionMode !== 'client') { world = new World(42); world.add('host', readProfile()); world.bots(6); state = world.snapshot(); } else world = null;
  view.setQuality($('quality-select').value); notice(sessionMode === 'solo' ? 'Training sortie. First faction to 25 eliminations wins.' : 'Room online. Keep the host tab open.');
  sound.start().catch(() => notice('Audio unavailable. Combat remains active.'));
  try { localStorage.setItem('rift-pilot', $('player-name').value); localStorage.setItem('rift-quality', $('quality-select').value); } catch {}
}
function leave() {
  network.stop(); world = state = null; mode = 'menu'; frozen = false; paused = false; view?.clear(); clearControls();
  $('overlay').hidden = false; $('hud').hidden = true; $('result').hidden = true; $('respawn').hidden = true; $('reticle').hidden = true; $('pause-dialog').close(); status('Choose your fleet. The Rift is waiting.');
}
function consumeEvents() {
  if (!state) return; const local = state.ships.find(s => s.id === localId);
  for (const event of state.events) if (event.id > lastEvent) {
    lastEvent = event.id; view.effect(event); if (event.message) notice(event.message);
    if (local && Math.hypot(event.x - local.x, event.z - local.z) < 55) sound.effect(event.type, (event.x - local.x) / 45);
  }
}
async function connect(kind) {
  if (mode !== 'menu') return;
  const buttons = ['solo-btn', 'host-btn', 'join-btn']; buttons.forEach(id => $(id).disabled = true);
  status(kind === 'host' ? 'Opening a room through PeerJS signalling...' : 'Finding your room...');
  try { await sound.start(); const result = kind === 'host' ? await network.host(readProfile()) : await network.join($('room-input').value, readProfile()); start(kind === 'host' ? 'host' : 'client', result.id, result.code); }
  catch (error) { network.stop(); status(error.message, true); }
  finally { buttons.forEach(id => $(id).disabled = false); }
}
function input() {
  if (paused || document.hidden) return cleanInput({ pulse });
  const local = state?.ships.find(s => s.id === localId);
  const aim = touch.aiming ? { ax: touch.ax, az: touch.az } : view.aim(pointer.x, pointer.y, local);
  return { x: (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + touch.x, z: (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0) + touch.z, ...aim, fire: pointer.firing || keys.has(' ') || touch.firing, boost: keys.has('shift'), pulse };
}
function updateHud() {
  if (!state) return;
  const s = state.ships.find(s => s.id === localId); if (!s) return;
  setText('fleet-score', state.score.fleet); setText('armada-score', state.score.armada);
  const time = Math.max(0, Math.ceil(RULES.duration - state.time)); setText('match-time', `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`);
  setText('health-text', Math.ceil(s.hp)); setText('energy-text', Math.ceil(s.energy));
  const hp = `scaleX(${Math.max(0, s.hp / 100).toFixed(2)})`, energy = `scaleX(${(s.energy / 100).toFixed(2)})`;
  if ($('health-bar').style.transform !== hp) $('health-bar').style.transform = hp;
  if ($('energy-bar').style.transform !== energy) $('energy-bar').style.transform = energy;
  setText('pulse-state', s.pulseCooldown > 0 ? `${s.pulseCooldown.toFixed(1)} s` : 'READY');
  setText('fps-text', `${Math.round(fps)} FPS`); setText('connection-text', mode === 'solo' ? 'PRACTICE' : mode === 'host' ? `${network.connections.size + 1}/8 PILOTS` : `${network.rtt} ms`);
  setText('pilot-name', `${s.name} / ${s.kills} ELIMINATIONS`);
  $('respawn').hidden = s.respawn <= 0; if (s.respawn > 0) setText('respawn-count', `Reinforcements in ${Math.ceil(s.respawn)} s`);
  if (state.winner) { $('result').hidden = false; setText('result-title', state.winner === 'draw' ? 'STALEMATE' : state.winner === s.faction ? 'VICTORY' : 'FLEET LOST'); setText('result-subtitle', `${state.score.fleet} : ${state.score.armada} / Your eliminations: ${s.kills}`); $('rematch-btn').hidden = mode === 'client'; }
  const ctx = $('radar').getContext('2d'); ctx.clearRect(0, 0, 160, 160); ctx.strokeStyle = '#466975'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(80, 80, 72, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(80, 8); ctx.lineTo(80, 152); ctx.moveTo(8, 80); ctx.lineTo(152, 80); ctx.stroke();
  for (const t of state.ships) if (t.respawn <= 0) { ctx.fillStyle = t.id === localId ? '#ffffff' : t.faction === 'fleet' ? '#66dfff' : '#ff7447'; ctx.beginPath(); ctx.arc(80 + t.x / 85 * 70, 80 + t.z / 85 * 70, t.id === localId ? 3.5 : 2, 0, Math.PI * 2); ctx.fill(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const begin = performance.now(), raw = now - previous; previous = now;
  const dt = Math.min(Math.max(raw / 1000, 0), 0.1); elapsed += dt;
  if (raw > 0 && raw < 250) fps += (1000 / raw - fps) * 0.06;
  if (mode !== 'menu') {
    const controls = input();
    if (world && !frozen) { world.setInput('host', controls); accumulator += dt; let ticks = 0; while (accumulator >= RULES.step && ticks < 6) { world.tick(); accumulator -= RULES.step; ticks++; } state = { time: world.time, score: world.score, winner: world.winner, ships: [...world.ships.values()], bullets: world.bullets, events: world.events }; consumeEvents(); }
    netClock += dt; pingClock += dt;
    if (netClock >= 0.05) { netClock = 0; if (mode === 'client') network.send({ type: 'input', input: controls }); else if (mode === 'host') network.broadcast({ type: 'snapshot', state: world.snapshot() }); }
    if (pingClock >= 2) { pingClock = 0; network.send({ type: 'ping', at: performance.now() }); }
    hudClock += dt; if (hudClock >= 0.125) { hudClock = 0; updateHud(); }
  }
  view.frame(state, localId, dt, elapsed, raw);
  if (recording && samples.length < 600) samples.push({ js: performance.now() - begin, frame: raw, ...view.stats() });
}
function pause() { if (mode === 'menu') return; paused = true; clearControls(); $('pause-dialog').showModal(); }
function resume() { paused = false; $('pause-dialog').close(); }
async function boot() {
  try {
    view = new View($('game-canvas')); await view.init();
    if (view.assetErrors.length) status(`Missing texture assets: ${view.assetErrors.join(', ')}. Rendering fallback materials.`, true); else status('Choose your fleet. The Rift is waiting.');
    ['solo-btn', 'host-btn', 'join-btn'].forEach(id => $(id).disabled = false);
    try { $('player-name').value = localStorage.getItem('rift-pilot') || ''; const q = localStorage.getItem('rift-quality'); if (['auto', 'low', 'medium', 'high'].includes(q)) $('quality-select').value = q; } catch {}
    const room = new URLSearchParams(location.search).get('room'); if (room) $('room-input').value = room.toUpperCase();
    $('solo-btn').onclick = () => start('solo'); $('host-btn').onclick = () => connect('host'); $('join-btn').onclick = () => connect('join');
    $('quality-select').onchange = () => view.setQuality($('quality-select').value);
    $('sound-btn').onclick = async () => { const muted = await sound.toggle(); $('sound-btn').textContent = muted ? 'SOUND OFF' : 'SOUND ON'; $('sound-btn').setAttribute('aria-pressed', String(!muted)); };
    $('pause-btn').onclick = pause; $('resume-btn').onclick = resume; $('leave-btn').onclick = leave; $('result-exit').onclick = leave;
    $('pause-dialog').addEventListener('cancel', () => { paused = false; });
    $('rematch-btn').onclick = () => {
      const pilots = [...world.ships.values()].filter(s => !s.bot).map(s => ({ id: s.id, name: s.name, faction: s.faction }));
      world = new World(42); for (const p of pilots) world.add(p.id, p); world.bots(6); state = world.snapshot(); lastEvent = 0; view.clear(); $('result').hidden = true; network.broadcast({ type: 'restart' });
    };
    $('copy-room').onclick = async () => { try { const url = new URL(location.href); url.searchParams.set('room', code); url.searchParams.delete('baseline'); await navigator.clipboard.writeText(url.href); notice('Invite link copied. Send it to your wingmate.'); } catch { notice(`Room code: ${code}. Share this code with your wingmate.`); } };
    addEventListener('resize', () => view.resize()); addEventListener('blur', clearControls); document.addEventListener('visibilitychange', clearControls);
    addEventListener('keydown', e => {
      if (e.target.closest('input, select, textarea')) return;
      const k = e.key.toLowerCase(); if (k === 'escape') { e.preventDefault(); if (!e.repeat) { if (paused) resume(); else pause(); } return; }
      if (mode === 'menu') return;
      if (['w', 'a', 's', 'd', ' ', 'shift', 'e'].includes(k)) e.preventDefault();
      if (k === 'e' && !e.repeat) pulse++; keys.add(k);
    });
    addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
    addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; pointer.x = e.clientX; pointer.y = e.clientY; $('reticle').style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
    $('game-canvas').addEventListener('pointerdown', e => { if (e.button === 0 && mode !== 'menu' && !paused) pointer.firing = true; }); addEventListener('pointerup', () => pointer.firing = false);
    for (const id of ['move-stick', 'aim-stick']) {
      const pad = $(id); let startPoint = null;
      pad.onpointerdown = e => { pad.setPointerCapture(e.pointerId); startPoint = { x: e.clientX, y: e.clientY }; if (id === 'aim-stick') { touch.aiming = true; touch.firing = true; } };
      pad.onpointermove = e => { if (!startPoint) return; const x = (e.clientX - startPoint.x) / 35, z = (e.clientY - startPoint.y) / 35, n = Math.max(1, Math.hypot(x, z)); if (id === 'move-stick') { touch.x = x / n; touch.z = z / n; } else { touch.ax = x / n; touch.az = z / n; } };
      const release = () => { startPoint = null; if (id === 'move-stick') touch.x = touch.z = 0; else touch.firing = false; }; pad.onpointerup = pad.onpointercancel = release;
    }
    $('touch-pulse').onclick = () => pulse++;
    $('game-canvas').addEventListener('webglcontextlost', e => { e.preventDefault(); leave(); status('Graphics context lost. Reload to restore the renderer.', true); });
    window.__gameDebug = {
      ready: true, state: () => ({ mode, localId, code, state: world ? world.snapshot() : state, connectionCount: network.connections.size, stats: view.stats() }),
      stats: () => ({ ...view.stats(), fps, audioVoices: sound.voices.length }),
      resetSamples: () => { samples.length = 0; recording = true; }, samples: () => samples.slice(),
      setQuality: q => view.setQuality(q),
      scenario: () => { if (mode === 'menu') start('solo'); world = new World(42); world.add('host', { name: 'Profiler', faction: 'fleet' }); world.bots(15); let i = 0; for (const s of world.ships.values()) { const a = i++ / 16 * Math.PI * 2; s.x = 34 + Math.cos(a) * 12; s.z = Math.sin(a) * 12; s.invulnerable = 0; } world.bullets = Array.from({ length: 160 }, (_, n) => ({ id: n, x: 25 + n % 20, z: -10 + Math.floor(n / 20) * 2, vx: 0, vz: 105, faction: n % 2 ? 'fleet' : 'armada' })); state = world.snapshot(); frozen = true; view.fx = Array.from({ length: 240 }, (_, n) => ({ x: 30 + n % 10, z: -5 + Math.floor(n / 10) * 0.4, y: 1, vx: 0, vy: 0, vz: 0, life: 10000 })); },
      setupDuel: () => { if (!world) return false; for (const s of [...world.ships.values()]) if (s.bot) world.remove(s.id); const players = [...world.ships.values()]; if (players.length < 2) return false; const a = players[0], b = players[1]; a.x = 30; a.z = -12; b.x = 30; b.z = 12; a.faction = 'fleet'; b.faction = 'armada'; for (const s of players) { s.hp = 100; s.invulnerable = 0; s.vx = s.vz = 0; s.cooldown = 0; } return true; },
      setInput: value => { if (world) world.setInput('host', value); },
      destroyRemote: () => { const s = world && [...world.ships.values()].find(s => !s.bot && s.id !== 'host'); if (s) { s.invulnerable = 0; world.hurt(s, 100, world.ships.get('host')); } },
      simulateMatchEnd: () => { if (world) { world.score.fleet = 25; world.tick(); } },
      leave
    };
    requestAnimationFrame(frame);
  } catch (error) { console.error(error); status('WebGL 2 could not start. Enable hardware acceleration or use a WebGL-capable browser.', true); $('fallback').hidden = false; }
}
boot();
