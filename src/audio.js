import { getWeapon } from './weapons.js';

export function createAudio() {
  let context, master, noiseBuffer, wind, windGain;
  let enabled = true;
  let ambientClock = 0;
  let lastSlash = 0;
  let lastEnemy = 0;
  let lastHit = -Infinity, lastHitWeight = 0, hitSide = 0;
  let lastFootstep = -Infinity, lastKill = -Infinity;

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

  function tone(frequency, endFrequency, duration, volume, type = 'sine', delay = 0, attack = 0.012) {
    if (!ready()) return;
    const now = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(25, frequency), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + Math.min(attack, duration / 5));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  function noise(duration, volume, frequency, endFrequency = frequency, type = 'bandpass', delay = 0, attack = 0.02) {
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
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(attack, duration / 5));
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
    const variation = [1.07, 0.92, 1.14, 0.84][Math.abs(combo) % 4];
    noise(combo === 3 ? 0.16 : 0.11, 0.36, 2200 * variation, 900, 'highpass', 0, 0.007);
    tone(1450 * variation, 470 * variation, 0.1, 0.045, 'triangle', 0.009, 0.004);
    tone(3000 * variation, 1600, 0.075, 0.023, 'sine', 0, 0.003);
  }

  function hit(strength = 1, combo) {
    if (!ready()) return;
    const weight = typeof strength === 'number' ? Math.min(2, Math.max(0.45, strength)) : strength === 'heavy' ? 1.7 : 1;
    const now = context.currentTime;
    // A multi-enemy contact is one impact cluster, not ten stacked loud strikes.
    if (now - lastHit < 0.032 && weight <= lastHitWeight * 1.3) return;
    lastHit = now; lastHitWeight = weight;
    const side = combo === undefined ? hitSide++ : combo;
    const pitch = side % 2 ? 0.93 : 1.07;
    tone((145 + weight * 22) * pitch, 43, 0.13 + weight * 0.024, 0.29 + weight * 0.1, 'sine', 0, 0.003);
    noise(0.043 + weight * 0.012, 0.22 + weight * 0.08, 3100 * pitch, 760, 'lowpass', 0, 0.002);
    tone(1680 * pitch, 620, 0.052, 0.095, 'triangle', 0, 0.002);
    tone(2780 * pitch, 2170, 0.071, 0.022, 'sine', 0.003, 0.002);
    noise(0.065, 0.07, 3500, 1800, 'highpass', 0.01, 0.004);
    if (weight > 1.25) {
      tone(70, 32, 0.21, 0.15 + weight * 0.02, 'sine', 0.005, 0.004);
      noise(0.095, 0.14, 800, 170, 'lowpass', 0.005, 0.003);
    }
  }

  // Air, metal resonance, body weight and articulation are tuned per weapon.
  const weaponVoices = {
    'dual-dao':[2700,1320,0.8,'double'], 'tang-dao':[2450,1710,1,'cut'],
    'great-dao':[1280,780,1.8,'heavy-cut'],
  };
  function weaponSlash(id, combo = 0, technique = null) {
    if (!ready() || context.currentTime - lastSlash < 0.06) return;
    lastSlash = context.currentTime;
    const [air, metal, weight, kind] = weaponVoices[id] || weaponVoices['tang-dao'];
    const pitch = [1.04,0.94,1.12,0.86][Math.abs(combo)%4];
    const shape=technique === 'thrust' ? 'thrust' : technique === 'chop' ? 'crush'
      : technique === 'cut' ? 'arc' : getWeapon(id).moves[((combo%4)+4)%4].shape;
    if(id==='great-dao') {
      const heavy=shape==='crush',stage=[.94,1.04,1.16,1.32][((combo%4)+4)%4];
      // The wind surges abruptly with the released blade, then ends cleanly
      // before the next cut; a high edge transient keeps the low rush sharp.
      noise(heavy?.13:.105,.24*stage,410,1420*pitch,'bandpass',0,.004);
      noise(heavy?.085:.065,.10*stage,3200*pitch,950,'highpass',.003,.002);
      tone(heavy?110:145,heavy?36:50,heavy?.115:.09,heavy?.085:.052,'triangle',.002,.003);
      tone(metal*pitch,metal*.46,heavy?.095:.075,.031,'triangle',.005,.003);
      return;
    }
    const duration = (0.085 + weight * 0.035)*(shape==='thrust'?0.72:shape==='radial'?1.3:1);
    if(shape==='crush')tone(110,37,0.14,0.065,'sine',0.015,0.005);
    if(shape==='thrust')noise(0.045,0.09,air*1.3,air*0.8,'highpass',0,0.002);
    noise(duration,0.19+weight*0.04,air*pitch,air*0.32,weight>1.5?'bandpass':'highpass',0,0.006);
    tone(metal*pitch,metal*0.45,duration,0.025,'triangle',0.005,0.003);
    if (kind.includes('double') && !technique) {
      noise(duration*0.75,0.16,air/pitch,air*0.4,'highpass',0.037,0.004);
      tone(metal*1.2,metal*0.6,0.09,0.018,'triangle',0.04,0.003);
    }
  }

  function weaponHit(id, strength = 1, combo = 0, technique = null) {
    if (!ready()) return;
    const [air,metal,weight,kind] = weaponVoices[id] || weaponVoices['tang-dao'];
    const force=Math.min(2,Math.max(0.45,typeof strength==='number'?strength:1));
    if(context.currentTime-lastHit<0.035 && force<=lastHitWeight*1.3)return;
    lastHit=context.currentTime;lastHitWeight=force;
    const pitch=combo%2?0.94:1.06, mass=Math.min(2.2,weight*force);
    if(id==='great-dao') {
      const finisher=((combo%4)+4)%4===3||technique==='chop';
      // A tight low strike plus a brief edge crack carries force without a
      // long bass tail masking the increasingly fast follow-up swings.
      tone((finisher?102:132)*pitch,31,finisher?.14:.105,.26+mass*.055,'sine',0,.002);
      noise(finisher?.065:.047,.22+mass*.035,finisher?980:1450,155,'lowpass',0,.002);
      noise(.028,finisher?.15:.105,3200*pitch,1300,'highpass',.001,.001);
      tone(metal*pitch,metal*.42,finisher?.085:.058,finisher?.065:.047,'triangle',.002,.002);
      tone(finisher?57:83,28,finisher?.155:.085,finisher?.16:.05,'sine',.002,.002);
      return;
    }
    tone((90+weight*30)*pitch,32,0.09+mass*0.045,0.2+mass*0.075,'sine',0,0.002);
    noise(0.035+mass*0.016,0.19+mass*0.055,kind==='wood'?820:air,220,'lowpass',0,0.002);
    tone(metal*pitch,metal*0.62,0.095,0.05,'triangle',0,0.002);
  }
  function roll() {
    noise(0.24, 0.3, 800, 180, 'bandpass');
    tone(170, 55, 0.15, 0.09, 'sine', 0.12);
  }

  function footstep(weight = 1) {
    if (!ready() || context.currentTime - lastFootstep < 0.13) return;
    lastFootstep = context.currentTime;
    const volume = Math.min(1.5, Math.max(0.3, weight));
    noise(0.038, 0.034 * volume, 620, 140, 'lowpass', 0, 0.003);
    tone(90, 47, 0.045, 0.021 * volume, 'sine', 0, 0.003);
  }

  function kill() {
    if (!ready() || context.currentTime - lastKill < 0.08) return;
    lastKill = context.currentTime;
    noise(0.13, 0.075, 480, 110, 'lowpass', 0, 0.004);
    tone(75, 30, 0.16, 0.062, 'sine', 0.01, 0.006);
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
  return { unlock, slash, hit, weaponSlash, weaponHit, roll, footstep, kill, enemy, win, setEnabled, update,
    destroy() { document.removeEventListener('visibilitychange', visibility); wind?.stop(); context?.close(); },
  };
}
