export class AudioEngine {
  constructor() { this.ctx = null; this.muted = false; this.voices = []; this.lastShot = -1; }
  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const c = this.ctx = new Ctx();
      this.master = c.createGain(); this.master.gain.value = 0.35;
      const limiter = c.createDynamicsCompressor(); limiter.threshold.value = -16; limiter.ratio.value = 8;
      this.master.connect(limiter); limiter.connect(c.destination);
      this.buffers = {};
      const make = (name, seconds, sample) => {
        const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate), data = b.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = sample(i / c.sampleRate, i / data.length);
        this.buffers[name] = b;
      };
      make('shot', 0.18, (t, u) => Math.sin(2 * Math.PI * (700 * t - 1300 * t * t)) * Math.exp(-u * 6) * 0.5);
      make('hit', 0.12, (t, u) => (Math.random() * 2 - 1) * (1 - u) ** 3 * 0.2);
      make('explosion', 0.7, (t, u) => ((Math.random() * 2 - 1) * 0.6 + Math.sin(t * 160) * 0.4) * (1 - u) ** 3);
      make('pulse', 0.6, (t, u) => Math.sin(2 * Math.PI * (160 * t - 90 * t * t)) * Math.sin(Math.PI * u) * 0.7);
      make('music', 8, t => {
        const notes = [110, 130.8128, 164.8138, 146.8324, 110, 164.8138, 195.9977, 146.8324];
        const beat = Math.floor(t * 4), u = t * 4 - beat, note = notes[beat % 8];
        const arp = Math.sin(t * Math.PI * 2 * note * 2) * Math.exp(-u * 5) * 0.08;
        const bass = Math.sin(t * Math.PI * 110) * 0.055 + Math.sin(t * Math.PI * 165) * 0.025;
        const drum = beat % 2 === 0 ? Math.sin(2 * Math.PI * (65 * u - 18 * u * u)) * Math.exp(-u * 16) * 0.18 : 0;
        return arp + bass + drum;
      });
      for (let i = 0; i < 10; i++) {
        const gain = c.createGain(), pan = c.createStereoPanner(); gain.connect(pan); pan.connect(this.master);
        this.voices.push({ gain, pan, until: 0 });
      }
      this.music = c.createBufferSource(); this.music.buffer = this.buffers.music; this.music.loop = true; this.music.connect(this.master); this.music.start();
    }
    if (!this.muted && this.ctx.state === 'suspended') await this.ctx.resume();
  }
  effect(type, pan = 0) {
    const c = this.ctx; if (!c || this.muted || !this.buffers[type]) return;
    if (type === 'shot' && c.currentTime - this.lastShot < 0.1) return;
    const v = this.voices.find(v => v.until <= c.currentTime); if (!v) return;
    if (type === 'shot') this.lastShot = c.currentTime;
    const source = c.createBufferSource(); source.buffer = this.buffers[type]; source.connect(v.gain);
    v.pan.pan.value = Math.max(-1, Math.min(1, pan)); v.gain.gain.value = type === 'explosion' ? 0.65 : 0.5;
    v.until = c.currentTime + source.buffer.duration; source.onended = () => source.disconnect(); source.start();
  }
  async toggle() { this.muted = !this.muted; if (this.ctx) { if (this.muted) await this.ctx.suspend(); else await this.ctx.resume(); } return this.muted; }
}
