/** Small synthesized score and combat foley; no downloaded audio assets. */
export class GameAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.master = null;
    this.lastHit = -1;
    this.noise = null;
    this.voices = new Set();
  }
  unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.28 : 0;
      this.master.connect(this.context.destination);
      this.noise = this.context.createBuffer(1, this.context.sampleRate * 0.5, this.context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? 0.28 : 0, this.context.currentTime, 0.04);
    return this.enabled;
  }
  tone(frequency, duration, volume = 0.2, type = 'sine', endFrequency = frequency, delay = 0) {
    if (!this.context || !this.enabled || this.context.state !== 'running') return;
    const c = this.context;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    this.voices.add(osc);
    osc.onended = () => { this.voices.delete(osc); osc.disconnect(); gain.disconnect(); };
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
  hiss(duration = 0.12, volume = 0.3, frequency = 2400, delay = 0) {
    if (!this.context || !this.enabled || this.context.state !== 'running') return;
    const c = this.context;
    const t = c.currentTime + delay;
    const source = c.createBufferSource();
    source.buffer = this.noise;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(this.master);
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(t);
    source.stop(t + duration + 0.02);
  }
  play(name) {
    if (!this.context || !this.enabled) return;
    switch (name) {
      case 'slash':
        this.hiss(0.15, 0.20, 1900);
        this.tone(290, 0.09, 0.10, 'triangle', 100);
        break;
      case 'hit':
        if (this.context.currentTime - this.lastHit < 0.055) return;
        this.lastHit = this.context.currentTime;
        this.hiss(0.10, 0.19, 4400);
        this.tone(125, 0.13, 0.25, 'triangle', 45);
        this.tone(1300, 0.065, 0.05, 'sine', 510);
        break;
      case 'hurt':
        this.hiss(0.24, 0.2, 300);
        this.tone(110, 0.22, 0.25, 'sawtooth', 45);
        break;
      case 'roll': this.hiss(0.22, 0.15, 520); break;
      case 'dash':
        this.hiss(0.32, 0.26, 1700);
        this.tone(190, 0.3, 0.18, 'triangle', 760);
        break;
      case 'whirl':
        for (let i = 0; i < 3; i++) {
          this.hiss(0.18, 0.19, 1600 + i * 500, i * 0.18);
          this.tone(210 + i * 70, 0.2, 0.12, 'triangle', 80, i * 0.18);
        }
        break;
      case 'burst':
        this.tone(72, 0.8, 0.5, 'sine', 35);
        this.hiss(0.65, 0.24, 600);
        this.tone(440, 0.65, 0.12, 'triangle', 165);
        break;
      case 'pickup':
        this.tone(660, 0.15, 0.10);
        this.tone(990, 0.25, 0.08, 'sine', 1100, 0.07);
        break;
      case 'wave':
        this.tone(110, 1, 0.18);
        this.tone(220, 0.8, 0.08, 'sine', 216);
        this.tone(330, 0.6, 0.05);
        break;
      case 'win':
        [261.63, 329.63, 392, 523.25].forEach((f, i) => this.tone(f, 0.65, 0.14, 'triangle', f, i * 0.18));
        break;
      case 'lose':
        [220, 196, 146.83].forEach((f, i) => this.tone(f, 0.6, 0.15, 'triangle', f, i * 0.2));
        break;
    }
  }
  clear() {
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear();
    this.lastHit = -1;
  }
  suspend() {
    if (this.context?.state === 'running') this.context.suspend().catch(() => {});
  }
  resume() {
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }
}
