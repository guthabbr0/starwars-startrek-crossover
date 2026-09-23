import { Peer } from 'peerjs';
import { profile, cleanInput, RULES } from './simulation.js';
const CODE = /^[A-Z0-9]{6}$/;
const PROTOCOL = 'broken-horizon-3';
const UPDATE = 'Update required. Reload both browsers and create a new room.';
export class Network {
  constructor(onEvent) { this.onEvent = onEvent; this.connections = new Map(); this.peer = null; this.role = ''; this.code = ''; this.id = ''; this.rtt = 0; this.generation = 0; }
  options() {
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const port = Number(new URLSearchParams(location.search).get('signal'));
    return local && port > 1024 && port < 65536 ? { host: '127.0.0.1', port, path: '/', secure: false, debug: 0, config: { iceServers: [] } } : { debug: 0 };
  }
  async open(id) {
    const generation = this.generation;
    const peer = this.peer = new Peer(id, this.options());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('Signalling service timed out. Practice remains available.')); }, 12000);
      peer.on('open', () => { clearTimeout(timer); if (generation === this.generation) resolve(peer); });
      peer.on('error', error => { clearTimeout(timer); const e = new Error(error.type === 'peer-unavailable' ? 'Room not found. Check the code and keep the host tab open.' : `Connection failed: ${error.type || 'network error'}`); reject(e); if (this.role && generation === this.generation) this.onEvent('notice', e.message); });
      peer.on('disconnected', () => { if (generation === this.generation && this.role) this.onEvent('notice', 'Signalling disconnected. Existing peer connections may continue.'); });
    });
  }
  async host(info) {
    this.stop(); const generation = this.generation;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const random = crypto.getRandomValues(new Uint8Array(6));
    this.code = Array.from(random, n => alphabet[n % alphabet.length]).join('');
    const peer = await this.open(`stellar-rift-${this.code}`);
    this.role = 'host'; this.id = 'host';
    peer.on('connection', conn => {
      if (generation !== this.generation) return conn.close();
      if (this.connections.size >= RULES.players - 1) { conn.on('open', () => { conn.send({ type: 'reject', reason: 'Room is full (8 pilots).' }); setTimeout(() => conn.close(), 100); }); return; }
      let accepted = false, lastInput = 0;
      const timeout = setTimeout(() => { if (!accepted) conn.close(); }, 8000);
      this.connections.set(conn.peer, conn);
      conn.on('data', packet => {
        if (!packet || typeof packet !== 'object' || generation !== this.generation) return;
        if (packet.type === 'hello' && !accepted) {
          if (packet.protocol !== PROTOCOL) { clearTimeout(timeout); conn.send({ type: 'reject', reason: UPDATE }); setTimeout(() => conn.close(), 100); return; }
          accepted = true; clearTimeout(timeout);
          this.onEvent('join', { id: conn.peer, profile: profile(packet.profile) });
          conn.send({ type: 'welcome', protocol: PROTOCOL, id: conn.peer, code: this.code });
        } else if (accepted && packet.type === 'input' && performance.now() - lastInput >= 20) {
          lastInput = performance.now(); this.onEvent('input', { id: conn.peer, input: cleanInput(packet.input) });
        } else if (accepted && packet.type === 'ping') { conn.send({ type: 'pong', at: packet.at }); }
      });
      conn.on('close', () => { clearTimeout(timeout); if (generation !== this.generation) return; this.connections.delete(conn.peer); if (accepted) this.onEvent('leave', conn.peer); });
      conn.on('error', () => conn.close());
    });
    return { id: this.id, code: this.code, profile: profile(info) };
  }
  async join(rawCode, info) {
    this.stop(); const generation = this.generation;
    const code = String(rawCode).trim().toUpperCase();
    if (!CODE.test(code)) throw new Error('Enter the 6-character room code.');
    const peer = await this.open();
    const conn = peer.connect(`stellar-rift-${code}`, { reliable: false, serialization: 'json' });
    this.connections.set('host', conn);
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { if (!ready) { this.stop(); reject(new Error('Peer connection timed out. Your network may require a TURN relay.')); } }, 15000);
      conn.on('open', () => conn.send({ type: 'hello', protocol: PROTOCOL, profile: profile(info) }));
      conn.on('data', packet => {
        if (generation !== this.generation || !packet || typeof packet !== 'object') return;
        if (packet.type === 'welcome') { clearTimeout(timer); if (packet.protocol !== PROTOCOL) { this.stop(); reject(new Error(UPDATE)); return; } ready = true; this.role = 'client'; this.code = code; this.id = packet.id; resolve({ id: this.id, code }); }
        else if (packet.type === 'reject') { clearTimeout(timer); this.stop(); reject(new Error(packet.reason)); }
        else if (ready && packet.type === 'snapshot' && Array.isArray(packet.state?.ships) && packet.state.ships.length <= RULES.ships) this.onEvent('snapshot', packet.state);
        else if (packet.type === 'pong' && Number.isFinite(packet.at)) this.rtt = Math.round(performance.now() - packet.at);
        else if (ready && packet.type === 'restart') this.onEvent('restart');
      });
      const lost = () => { clearTimeout(timer); if (generation !== this.generation) return; if (!ready) { this.stop(); reject(new Error('Could not reach the host. Check the room code.')); } else { this.stop(); this.onEvent('lost', 'The host left. This room has ended.'); } };
      conn.on('close', lost); conn.on('error', lost);
      peer.on('error', error => { if (!ready && error.type === 'peer-unavailable') lost(); });
    });
  }
  send(packet) {
    const conn = this.connections.get('host');
    if (this.role === 'client' && conn?.open && (conn.dataChannel?.bufferedAmount || 0) < 65536) conn.send(packet);
  }
  broadcast(packet) {
    if (this.role !== 'host') return;
    for (const conn of this.connections.values()) if (conn.open && (conn.dataChannel?.bufferedAmount || 0) < 65536) conn.send(packet);
  }
  stop() {
    this.generation++; this.role = ''; for (const c of this.connections.values()) c.close(); this.connections.clear(); this.peer?.destroy(); this.peer = null; this.id = ''; this.code = ''; this.rtt = 0;
  }
}
