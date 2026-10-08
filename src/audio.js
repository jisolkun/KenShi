export function createAudio() {
  let context, master, noiseBuffer, wind, windGain;
  let enabled = true;
  let ambientClock = 0;
  let lastSlash = 0;
  let lastEnemy = 0;

  const ready = () => enabled && context?.state === 'running';
  function unlock() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = enabled ? 0.32 : 0;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -17;
      compressor.knee.value = 14;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      master.connect(compressor);
      compressor.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      wind = context.createBufferSource();
      wind.buffer = noiseBuffer;
      wind.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      windGain = context.createGain();
      windGain.gain.value = 0.035;
      wind.connect(filter);
      filter.connect(windGain);
      windGain.connect(master);
      wind.start();
    }
    if (context.state === 'suspended' && !document.hidden) context.resume().catch(() => {});
  }

  function tone(frequency, endFrequency, duration, volume, type = 'sine', delay = 0) {
    if (!ready()) return;
    const now = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(25, frequency), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + Math.min(0.012, duration / 5));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  function noise(duration, volume, frequency, endFrequency = frequency, type = 'bandpass', delay = 0) {
    if (!ready()) return;
    const now = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = type === 'bandpass' ? 0.8 : 0.5;
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.02, duration / 5));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now, Math.random() * 0.5);
    source.stop(now + duration + 0.02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  function slash(combo = 0) {
    if (!ready()) return;
    const now = context.currentTime;
    if (now - lastSlash < 0.065) return;
    lastSlash = now;
    const variation = 1 + (combo % 3) * 0.12 + Math.random() * 0.05;
    noise(0.13, 0.52, 2200 * variation, 900, 'highpass');
    tone(1450 * variation, 390 * variation, 0.13, 0.07, 'triangle', 0.015);
    tone(3300 * variation, 1500, 0.09, 0.035, 'sine');
  }

  function hit(strength = 1) {
    const weight = typeof strength === 'number' ? Math.min(2.2, Math.max(0.45, strength)) : strength === 'heavy' ? 1.8 : 1;
    tone(145 + weight * 15, 40, 0.16 + weight * 0.025, 0.38 * weight, 'sine');
    noise(0.1 + weight * 0.02, 0.38 * weight, 1800, 300, 'lowpass');
    tone(600 + Math.random() * 240, 170, 0.1, 0.085, 'triangle');
    if (weight > 1.3) tone(64, 30, 0.25, 0.22, 'sine', 0.015);
  }

  function roll() {
    noise(0.24, 0.3, 800, 180, 'bandpass');
    tone(170, 55, 0.15, 0.09, 'sine', 0.12);
  }

  function skill(index = 0) {
    if (!ready()) return;
    noise(0.16, 0.22, 300, 2200, 'bandpass');
    tone(150, 600 + index * 70, 0.16, 0.11, 'triangle');
    const delay = 0.1;
    if (index === 3) {
      [880, 1320, 1760, 2200].forEach((pitch, i) => tone(pitch, pitch * 0.95, 0.48, 0.1, 'sine', delay + i * 0.045));
      noise(0.55, 0.42, 4200, 850, 'highpass', delay);
      tone(100, 35, 0.28, 0.38, 'sine', delay);
    } else if (index === 1 || index === 4) {
      for (let i = 0; i < 3; i++) {
        noise(0.16, 0.42, 2200 + i * 350, 450, 'bandpass', delay + i * 0.095);
        tone(700 + i * 90, 140, 0.14, 0.1, 'triangle', delay + i * 0.095);
      }
      tone(110, 38, 0.28, 0.45, 'sine', delay);
    } else {
      noise(index === 2 ? 0.38 : 0.23, 0.7, 2800, 230, 'lowpass', delay);
      tone(index === 2 ? 150 : 110, 30, 0.32, 0.6, 'sine', delay);
      tone(1200, 250, 0.19, 0.13, 'triangle', delay);
    }
  }

  function enemy() {
    if (!ready() || context.currentTime - lastEnemy < 0.13) return;
    lastEnemy = context.currentTime;
    tone(95, 45, 0.2, 0.18, 'sawtooth');
    noise(0.18, 0.17, 850, 210, 'bandpass');
  }

  function win() {
    [392, 493.88, 587.33, 783.99].forEach((pitch, i) => {
      tone(pitch, pitch, 1.1, 0.14, 'sine', i * 0.15);
      tone(pitch * 2.01, pitch * 2, 0.65, 0.028, 'sine', i * 0.15);
    });
    noise(0.5, 0.13, 2200, 500, 'bandpass');
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (master) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.32 : 0, context.currentTime, 0.03);
    }
    if (enabled) unlock();
  }

  function update(dt) {
    if (!ready()) return;
    ambientClock += Math.min(dt || 0, 0.1);
    windGain.gain.setTargetAtTime(0.028 + Math.sin(ambientClock * 0.13) * 0.009, context.currentTime, 1);
    if (ambientClock > 26) {
      ambientClock = 0;
      tone(196, 195, 2.6, 0.055, 'sine');
      tone(393, 391, 1.7, 0.018, 'sine', 0.015);
      tone(546, 544, 0.9, 0.008, 'sine', 0.035);
    }
  }
  const visibility = () => {
    if (!context) return;
    if (document.hidden) context.suspend().catch(() => {});
    else if (enabled) context.resume().catch(() => {});
  };
  document.addEventListener('visibilitychange', visibility);
  return { unlock, slash, hit, roll, skill, enemy, win, setEnabled, update,
    destroy() { document.removeEventListener('visibilitychange', visibility); wind?.stop(); context?.close(); },
  };
}
