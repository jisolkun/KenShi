/** Procedural blade foley: air movement, body impact, metal and a restrained room tail. */
export class GameAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.master = null;
    this.lastHit = -1;
    this.noise = null;
    this.voices = new Set();
    this.maxVoices = 48;
  }
  unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext({ latencyHint: 'interactive' });
      const c = this.context;
      this.master = c.createGain();
      this.master.gain.value = this.enabled ? 0.25 : 0;
      const compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 14;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      this.master.connect(compressor).connect(c.destination);
      // A quiet, filtered two-tap reflection gives steel weight without a bright wash.
      this.echoSend = c.createGain(); this.echoSend.gain.value = 0.075;
      this.echoFilter = c.createBiquadFilter(); this.echoFilter.type = 'lowpass'; this.echoFilter.frequency.value = 1800;
      const delay = c.createDelay(0.5); delay.delayTime.value = 0.085;
      const delay2 = c.createDelay(0.5); delay2.delayTime.value = 0.13;
      const tail = c.createGain(); tail.gain.value = 0.4;
      this.master.connect(this.echoFilter).connect(delay).connect(this.echoSend).connect(compressor);
      delay.connect(delay2).connect(tail).connect(this.echoSend);
      this.noise = c.createBuffer(1, Math.ceil(c.sampleRate * 1.2), c.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? 0.25 : 0, this.context.currentTime, 0.035);
    if (!this.enabled) this.stopAll();
    return this.enabled;
  }
  ready() {
    return this.context && this.enabled && this.context.state === 'running' && this.voices.size < this.maxVoices;
  }
  track(source, nodes, t, duration) {
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    source.start(t);
    source.stop(t + duration + 0.025);
  }
  tone(frequency, duration, volume = 0.2, type = 'sine', endFrequency = frequency, delay = 0) {
    if (!this.ready()) return;
    const c = this.context, t = c.currentTime + delay;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, Math.min(volume, 0.48)), t + Math.min(.003, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    // Roll off the harsh oscillator harmonics while keeping the metal transient audible.
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = type === 'sawtooth' ? 1400 : 4200;
    osc.connect(filter).connect(gain).connect(this.master);
    this.track(osc, [gain, filter], t, duration);
  }
  hiss(duration = 0.12, volume = 0.3, frequency = 2400, delay = 0, endFrequency = frequency) {
    if (!this.ready()) return;
    const c = this.context, t = c.currentTime + delay;
    const source = c.createBufferSource(); source.buffer = this.noise;
    const filter = c.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(Math.max(40, frequency), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), t + duration);
    const gain = c.createGain(); gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, Math.min(0.4, volume)), t + .003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(gain).connect(this.master);
    this.track(source, [filter, gain], t, duration);
  }
  impact(strength = 1, delay = 0) {
    const weight = Math.min(1.7, Math.max(0.5, strength));
    const detune = 0.94 + Math.random() * 0.12;
    // All contact layers start together; no delayed thump after the blade connects.
    this.tone(138 * detune, .115 + weight * .015, .29 * weight, 'sine', 43, delay);
    this.tone(286 * detune, .045, .10 * weight, 'triangle', 78, delay);
    this.hiss(.042, .23 * weight, 3300, delay, 1150);
    this.tone(1180 * detune, .072, .035 * weight, 'sine', 820, delay);

  }
  play(name, strength = 1) {
    if (!this.context || !this.enabled || this.context.state !== 'running') return;
    if (this.echoSend) this.echoSend.gain.setTargetAtTime(0.075, this.context.currentTime, 0.025);
    const variation = 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'draw':
        this.hiss(.065, .05, 950, 0, 1650);
        break;
      case 'seal':
        this.hiss(.1, .035, 1700, 0, 2200);
        break;
      case 'slash':
        this.hiss(.085, .13 * strength, 1050 * variation, 0, 3300);
        this.tone(420 * variation, .07, .035 * strength, 'triangle', 155);
        break;
      case 'hit':
        if (this.context.currentTime - this.lastHit < .028) return;
        this.lastHit = this.context.currentTime;
        this.impact(strength);
        break;
      case 'heavy':
        this.hiss(.13, .2, 650, 0, 2700);
        this.tone(245, .11, .065, 'triangle', 70);
        break;
      case 'charge':
        this.hiss(0.4, 0.085, 280, 0, 1200);
        this.tone(90, 0.44, 0.11, 'triangle', 280);
        this.tone(180, 0.4, 0.04, 'sine', 560, 0.04);
        break;
      case 'finisher':
        this.hiss(.075, .12, 3600, 0, 1100);
        this.tone(74, .22, .13, 'sine', 32);
        this.tone(780, .13, .025, 'sine', 540);
        break;
      case 'hurt':
        this.hiss(0.17, 0.17, 400, 0, 130);
        this.tone(115, 0.23, 0.23, 'triangle', 42);
        break;
      case 'roll': this.hiss(0.2, 0.13, 580, 0, 230); break;
      case 'dash':
        this.hiss(.13, .13, 540, 0, 2200);
        this.tone(170, .1, .055, 'triangle', 380);
        break;
      case 'whirl':
        for (let i = 0; i < 3; i++) {
          this.hiss(0.2, 0.15, 850 + i * 280, i * 0.16, 1900);
          this.tone(150 + i * 25, 0.17, 0.1, 'triangle', 68, i * 0.16 + 0.035);
        }
        break;
      case 'burst':
        this.tone(74, 0.6, 0.4, 'sine', 30);
        this.hiss(0.4, 0.22, 720, 0, 170);
        this.impact(1.15, 0.016);
        this.tone(330, 0.46, 0.06, 'triangle', 165, 0.05);
        break;
      case 'frost':
        this.hiss(0.34, 0.12, 1900, 0, 650);
        [740, 1110, 1480].forEach((f, i) => this.tone(f, 0.25, 0.025, 'sine', f * 0.94, i * 0.045));
        this.tone(80, 0.2, 0.16, 'sine', 45);
        break;
      case 'blades':
        for (let i = 0; i < 3; i++) {
          this.hiss(0.12, 0.095, 1300 + i * 200, i * 0.035, 2400);
          this.tone(580 + i * 90, 0.13, 0.025, 'triangle', 350, i * 0.035);
        }
        break;
      case 'boss':
        this.tone(60, 0.65, 0.27, 'sine', 32);
        this.tone(89, 0.55, 0.085, 'triangle', 57);
        this.hiss(0.44, 0.16, 320, 0.02, 120);
        break;
      case 'pickup':
        this.tone(660, 0.15, 0.085);
        this.tone(990, 0.23, 0.06, 'sine', 1100, 0.07);
        break;
      case 'wave':
        this.tone(110, 0.7, 0.13);
        this.tone(165, 0.65, 0.05, 'sine', 162);
        this.tone(220, 0.45, 0.03);
        break;
      case 'win':
        [261.63, 329.63, 392, 523.25].forEach((f, i) => this.tone(f, 0.6, 0.1, 'triangle', f, i * 0.18));
        break;
      case 'lose':
        [220, 196, 146.83].forEach((f, i) => this.tone(f, 0.55, 0.11, 'triangle', f, i * 0.2));
        break;
    }
  }
  stopAll() {
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear(); this.lastHit = -1;
    if (this.echoSend) this.echoSend.gain.setValueAtTime(0, this.context.currentTime);
  }
  clear() { this.stopAll(); }
  suspend() {
    if (this.context?.state === 'running') this.context.suspend().catch(() => {});
  }
  resume() {
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }
}
