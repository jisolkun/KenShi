import { getWeapon } from './weapons.js';

export function createAudio() {
  let context, master, noiseBuffer, wind, windGain;
  let enabled = true;
  let ambientClock = 0;
  let lastSlash = 0;
  let lastEnemy = 0;
  let lastHit = -Infinity, lastHitWeight = 0, hitSide = 0;
  let lastFootstep = -Infinity, lastKill = -Infinity, lastSkillImpact = -Infinity;

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
    'yanling-dao':[3100,1920,0.85,'cut'], 'miao-dao':[1500,970,1.5,'cut'],
    'ring-dao':[2100,2420,1.15,'ring'], 'pu-dao':[1200,820,1.65,'cut'],
    'longquan-jian':[3300,2250,0.7,'point'], 'dual-jian':[3500,2140,0.7,'double'],
    guandao:[980,680,1.9,'heavy'], qiang:[3800,1580,1,'point'],
    shemao:[2850,1450,1.05,'snake'], 'fangtian-ji':[1750,1160,1.55,'hook'],
    'dual-ji':[2400,1370,1.1,'double'], staff:[780,260,1.1,'wood'],
    'three-section-staff':[1150,760,1.2,'chain'], 'nine-section-whip':[3200,2860,0.8,'chain'],
    'iron-whip':[1600,840,1.4,'metal'], 'dual-jian-maces':[1350,610,1.55,'double-heavy'],
    'wolf-club':[700,340,1.9,'heavy'], 'dual-axes':[1800,940,1.35,'double-heavy'],
    'war-hammer':[560,220,2,'heavy'], 'hook-swords':[2600,1840,0.85,'hook'],
    'emei-piercers':[4600,3100,0.5,'point'], 'mandarin-yue':[3600,2540,0.7,'double'],
    'meteor-hammer':[950,480,1.8,'chain'], 'judge-brush':[4100,2740,0.55,'brush'],
    'battle-yue':[1050,550,1.85,'heavy'],
  };
  function weaponSlash(id, combo = 0) {
    if (!ready() || context.currentTime - lastSlash < 0.06) return;
    lastSlash = context.currentTime;
    const [air, metal, weight, kind] = weaponVoices[id] || weaponVoices['tang-dao'];
    const pitch = [1.04,0.94,1.12,0.86][Math.abs(combo)%4];
    const shape=getWeapon(id).moves[((combo%4)+4)%4].shape;
    const duration = (0.085 + weight * 0.035)*(shape==='thrust'?0.72:shape==='radial'?1.3:1);
    if(shape==='crush')tone(110,37,0.14,0.065,'sine',0.015,0.005);
    if(shape==='thrust')noise(0.045,0.09,air*1.3,air*0.8,'highpass',0,0.002);
    noise(duration,0.19+weight*0.04,air*pitch,air*0.32,weight>1.5?'bandpass':'highpass',0,0.006);
    tone(metal*pitch,metal*0.45,duration,0.025,'triangle',0.005,0.003);
    if (kind.includes('double')) {
      noise(duration*0.75,0.16,air/pitch,air*0.4,'highpass',0.037,0.004);
      tone(metal*1.2,metal*0.6,0.09,0.018,'triangle',0.04,0.003);
    }
    if (kind==='chain' || kind==='ring') {
      for(let i=0;i<3;i++)tone(metal*(1+i*0.37),metal*(0.98+i*0.37),0.055,0.026/(i+1),'sine',i*0.025,0.002);
    } else if (kind==='wood' || kind==='heavy') {
      tone(100+weight*35,48,duration,0.07,'sine',0,0.006);
    } else if (kind==='snake') {
      noise(0.07,0.12,air*1.35,air*0.7,'bandpass',0.05,0.004);
    } else if (kind==='hook') {
      tone(metal*1.5,metal*0.8,0.12,0.027,'sine',0.035,0.003);
    } else if (kind==='brush') {
      noise(0.1,0.095,5100,2200,'highpass',0.025,0.015);
    }
  }
  function weaponHit(id, strength = 1, combo = 0) {
    if (!ready()) return;
    const [air,metal,weight,kind] = weaponVoices[id] || weaponVoices['tang-dao'];
    const force=Math.min(2,Math.max(0.45,typeof strength==='number'?strength:1));
    if(context.currentTime-lastHit<0.035 && force<=lastHitWeight*1.3)return;
    lastHit=context.currentTime;lastHitWeight=force;
    const pitch=combo%2?0.94:1.06, mass=Math.min(2.2,weight*force);
    tone((90+weight*30)*pitch,32,0.09+mass*0.045,0.2+mass*0.075,'sine',0,0.002);
    noise(0.035+mass*0.016,0.19+mass*0.055,kind==='wood'?820:air,220,'lowpass',0,0.002);
    if(kind==='wood') {
      tone(240,95,0.045,0.09,'triangle',0.003,0.002);
    } else if(kind==='heavy' || kind==='double-heavy') {
      noise(0.12,0.13,650,90,'lowpass',0.009,0.003);
      tone(58,27,0.18,0.085,'sine',0.007,0.003);
      if(kind==='double-heavy')tone(metal*1.23,metal*0.5,0.07,0.035,'triangle',0.024,0.002);
    } else {
      tone(metal*pitch,metal*0.62,kind==='point'?0.055:0.095,kind==='point'?0.08:0.05,'triangle',0,0.002);
      if(kind==='chain'||kind==='ring'||kind==='metal'||kind==='hook') {
        tone(metal*2.03,metal*1.99,0.14,0.028,'sine',0.007,0.002);
        tone(metal*2.7,metal*2.63,0.08,0.013,'sine',0.017,0.002);
      }
    }
  }
  function weaponSkill(id,index=0) {
    skill(index);
    const voice=weaponVoices[id]||weaponVoices['tang-dao'];
    tone(voice[1]*0.3,voice[1]*0.65,0.17,0.025,'sine',0.025,0.01);
    if(voice[3]==='chain')noise(0.13,0.09,2200,3400,'highpass',0.04,0.005);
  }

  function roll() {
    noise(0.24, 0.3, 800, 180, 'bandpass');
    tone(170, 55, 0.15, 0.09, 'sine', 0.12);
  }

  function skill(index = 0) {
    if (!ready()) return;
    // Only the draw/charge sound belongs at cast start. Contact is skillImpact().
    noise(index === 2 ? 0.24 : 0.18, 0.17, 300, 2100, 'bandpass', 0, 0.025);
    tone(220, 530 + index * 65, 0.15, 0.055, 'triangle');
    if (index === 3) {
      tone(1174, 1200, 0.23, 0.026, 'sine', 0.03);
      tone(1760, 1810, 0.18, 0.019, 'sine', 0.055);
    } else noise(0.16, 0.15, 1100, 2400, 'highpass', 0.07, 0.018);
  }

  function skillImpact(index = 0) {
    if (!ready() || context.currentTime - lastSkillImpact < 0.055) return;
    lastSkillImpact = context.currentTime;
    hit(index === 2 ? 1.9 : index === 0 ? 1.45 : 1.1, index);
    if (index === 3) {
      [880,1320,1760].forEach((pitch,i) => tone(pitch, pitch * 0.97, 0.36, 0.042, 'sine', i * 0.024, 0.003));
      noise(0.23, 0.23, 4300, 1200, 'highpass', 0, 0.003);
    } else if (index === 1) {
      for (let i = 0; i < 3; i++) {
        noise(0.09, 0.14, 2400 + i * 200, 900, 'bandpass', i * 0.075, 0.004);
      }
    } else if (index === 4) {
      noise(0.09, 0.17, 3600, 1100, 'highpass', 0, 0.003);
      tone(2040, 930, 0.07, 0.047, 'triangle', 0, 0.002);
    } else {
      noise(index === 2 ? 0.18 : 0.12, 0.23, 1500, 180, 'lowpass', 0.01, 0.003);
      if (index === 2) tone(52, 27, 0.24, 0.11, 'sine', 0.015, 0.005);
    }
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
  return { unlock, slash, hit, weaponSlash, weaponHit, weaponSkill, roll, skill, skillImpact, footstep, kill, enemy, win, setEnabled, update,
    destroy() { document.removeEventListener('visibilitychange', visibility); wind?.stop(); context?.close(); },
  };
}
