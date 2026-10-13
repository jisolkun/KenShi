import { getWeapon } from './weapons.js';
import { getHammerFeedback } from './hammerFeedback.js';

export function createAudio() {
  let context, master, noiseBuffer, wind, windGain;
  let enabled = true;
  let paused = false, destroyed = false;
  const voices = new Set();
  let ambientClock = 0;
  let lastSlash = 0;
  let lastEnemy = 0;
  let lastHit = -Infinity, lastHitWeight = 0, hitSide = 0;
  let lastFootstep = -Infinity, lastKill = -Infinity;
  let lastHammerGround = -Infinity;
  let lastReady = -Infinity, lastLanding = -Infinity;

  const playbackAllowed = () => enabled && !paused && !destroyed && !document.hidden;
  const ready = () => playbackAllowed() && context?.state === 'running';
  function syncPlayback() {
    if (!context || destroyed || context.state === 'closed') return;
    // AudioContext state changes settle asynchronously. Reconcile again once
    // they finish, including a fast pause/resume or hide/show in one frame.
    if (playbackAllowed() && context.state === 'suspended') context.resume().then(syncPlayback).catch(() => {});
    else if (!playbackAllowed() && context.state === 'running') context.suspend().then(syncPlayback).catch(() => {});
  }
  function unlock() {
    if (destroyed) return;
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
    syncPlayback();
  }

  function trackVoice(source, nodes) {
    const voice = { source, nodes };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      nodes.forEach(node => node.disconnect());
    };
  }

  // Suspending a context freezes scheduled sound. Clear transient voices as
  // well, so resuming cannot replay the tail of an old attack or victory cue.
  function stopVoices() {
    for (const { source, nodes } of voices) {
      try { source.stop(); } catch {}
      source.disconnect();
      nodes.forEach(node => node.disconnect());
    }
    voices.clear();
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
    trackVoice(osc, [gain]);
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
    trackVoice(source, [filter, gain]);
  }

  function slash(combo = 0) {
    if (!ready()) return;
    const now = context.currentTime;
    if (now - lastSlash < 0.065) return;
    lastSlash = now;
    const index = ((Math.trunc(combo) % 5) + 5) % 5;
    const variation = [1.07, 0.92, 1.14, 0.84, 1.20][index];
    noise(index >= 3 ? 0.16 : 0.11, 0.36, 2200 * variation, 900, 'highpass', 0, 0.007);
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
    'great-hammer':[620,110,2.1,'blunt'],
  };
  const strokeIndex = combo => ((Math.trunc(combo) % 5) + 5) % 5;
  const fifthHammerVoice = {
    airTone: 86, airDuration: .145, airVolume: .34, airFilter: 340,
    hitTone: 82, hitDuration: .18, hitFilter: 500, hitCrackTone: 156,
  };
  const hammerVoice = index => index === 4 ? fifthHammerVoice : getHammerFeedback(index);

  function weaponReady(id, combo = 0) {
    if (!ready() || context.currentTime - lastReady < .075) return;
    lastReady = context.currentTime;
    const index = strokeIndex(combo), heavy = id === 'great-hammer' || id === 'great-dao';
    const effort = [1, .86, 1.08, 1.14, 1.24][index];
    // A quiet grip and cloth pull belongs to the loading pose; the audible
    // air release is emitted separately at the measured weapon stroke.
    noise(.055, .018 * effort, heavy ? 460 : 720, 210, 'bandpass', 0, .005);
    noise(.022, heavy ? .009 : .006, 1500, 850, 'highpass', .008, .002);
    if (heavy) tone(82 + index * 3, 48, .07, .018 * effort, 'sine', .006, .009);
    else tone(id === 'dual-dao' ? 840 : 680, 360, .036, .008, 'triangle', .004, .003);
  }

  function weaponSlash(id, combo = 0, technique = null) {
    if (!ready() || context.currentTime - lastSlash < 0.06) return;
    lastSlash = context.currentTime;
    const [air, metal, weight, kind] = weaponVoices[id] || weaponVoices['tang-dao'];
    const index = strokeIndex(combo), finisher = index === 4;
    // Slight variations in release speed avoid an identical sample-like
    // repetition while keeping each of the five strokes recognizable.
    const pitch = [1.04,.94,1.12,1,.86][index] * (.975 + Math.random() * .05);
    const level = .96 + Math.random() * .08;
    const shape=technique === 'thrust' ? 'thrust' : technique === 'chop' ? 'crush'
      : technique === 'cut' ? 'arc' : getWeapon(id).moves[index].shape;
    if(id==='great-hammer') {
      const feedback=hammerVoice(index);
      // The quick rising beat, long waist swing and loaded slam move
      // different amounts of air. A delayed low after-pulse makes the head
      // feel like it keeps displacing the room after the first release.
      noise(feedback.airDuration,feedback.airVolume*level,feedback.airFilter,140,'lowpass',0,.004);
      tone(feedback.airTone,32,feedback.airDuration,index===3?.070:finisher?.058:.040,'sine',.003,.004);
      noise(feedback.airDuration*.72,feedback.airVolume*.48,feedback.airFilter*.72,95,'lowpass',finisher?.060:.045,.003);
      if(index===3)tone(58,28,.18,.055,'sine',.055,.004);
      if(finisher)tone(68,30,.13,.052,'sine',.075,.004);
      return;
    }
    if(id==='great-dao') {
      const heavy=shape==='crush'||finisher,stage=[.94,1.04,1.16,1.12,1.32][index]*level;
      // The wind surges abruptly with the released blade, then ends cleanly
      // before the next cut; a high edge transient keeps the low rush sharp.
      noise(shape==='thrust'?.072:heavy?.13:.105,.24*stage,410,1420*pitch,'bandpass',0,.004);
      noise(shape==='thrust'?.044:heavy?.085:.065,.10*stage,3200*pitch,950,'highpass',.003,.002);
      tone(heavy?110:145,heavy?36:50,heavy?.115:.09,heavy?.085:.052,'triangle',.002,.003);
      tone(metal*pitch,metal*.46,heavy?.095:.075,.031,'triangle',.005,.003);
      tone(metal*1.51*pitch,metal*1.48*pitch,.065,finisher?.024:.014,'sine',.007,.002);
      return;
    }
    const stage = [.92,1.02,.88,1.10,1.26][index];
    const duration = (0.085 + weight * 0.035)*(shape==='thrust'?.72:shape==='radial'||finisher?1.3:1)*stage;
    if(shape==='crush')tone(110,37,0.14,0.065,'sine',0.015,0.005);
    if(shape==='thrust')noise(0.045,0.09,air*1.3,air*0.8,'highpass',0,0.002);
    noise(duration,(.19+weight*.04)*stage*level,air*pitch,air*.32,weight>1.5?'bandpass':'highpass',0,.006);
    tone(metal*pitch,metal*0.45,duration,0.025,'triangle',0.005,0.003);
    tone(metal*1.49*pitch,metal*1.45*pitch,finisher?.11:.060,finisher?.022:.012,'sine',.009,.002);
    if (kind.includes('double') && !technique) {
      noise(duration*0.75,0.16,air/pitch,air*0.4,'highpass',0.037,0.004);
      tone(metal*1.2,metal*0.6,0.09,0.018,'triangle',0.04,0.003);
    }
  }

  function weaponHit(id, strength = 1, combo = 0, technique = null) {
    if (!ready()) return;
    const [air,metal,weight,kind] = weaponVoices[id] || weaponVoices['tang-dao'];
    const force=Math.min(2,Math.max(0.45,typeof strength==='number'?strength:1));
    if(context.currentTime-lastHit<0.05)return;
    lastHit=context.currentTime;lastHitWeight=force;
    const index=strokeIndex(combo),finisher=index===4||technique==='chop';
    const pitch=[1.06,.94,1.10,.97,.89][index]*(.985+Math.random()*.03),mass=Math.min(2.2,weight*force);
    if(id==='great-hammer') {
      const feedback=hammerVoice(index),heavy=finisher;
      tone(feedback.hitTone*pitch,27,feedback.hitDuration,.34+mass*.070,'sine',0,.001);
      noise(heavy?.095:.060,.30+mass*.045,feedback.hitFilter,85,'lowpass',0,.001);
      noise(.022,.13+mass*.025,2400,800,'highpass',0,.001);
      tone(feedback.hitCrackTone*pitch,45,heavy?.075:.045,.065,'triangle',.001,.0015);
      if(heavy)noise(.095,.11,285,80,'lowpass',.016,.003);
      return;
    }
    if(id==='great-dao') {
      // A tight low strike plus a brief edge crack carries force without a
      // long bass tail masking the increasingly fast follow-up swings.
      tone((finisher?102:132)*pitch,31,finisher?.14:.105,.26+mass*.055,'sine',0,.002);
      noise(finisher?.065:.047,.22+mass*.035,finisher?980:1450,155,'lowpass',0,.002);
      noise(.028,finisher?.15:.105,3200*pitch,1300,'highpass',.001,.001);
      tone(metal*pitch,metal*.42,finisher?.085:.058,finisher?.065:.047,'triangle',.002,.002);
      tone(finisher?57:83,28,finisher?.155:.085,finisher?.16:.05,'sine',.002,.002);
      tone(metal*1.51*pitch,metal*1.48*pitch,.075,finisher?.030:.017,'sine',.003,.002);
      return;
    }
    tone((90+weight*30)*pitch,32,.09+mass*.045,(.2+mass*.075)*(finisher?1.12:1),'sine',0,.002);
    noise(.035+mass*.016,.19+mass*.055,air,220,'lowpass',0,.002);
    noise(.018,finisher?.115:.085,3400*pitch,1300,'highpass',.001,.001);
    tone(metal*pitch,metal*.62,finisher?.105:.075,.05,'triangle',0,.002);
    tone(metal*1.49*pitch,metal*1.46*pitch,finisher?.13:.085,finisher?.030:.020,'sine',.003,.002);
    if(finisher)tone(74,30,.13,.078,'sine',.003,.002);
  }
  function roll() {
    noise(0.24, 0.3, 800, 180, 'bandpass');
    tone(170, 55, 0.15, 0.09, 'sine', 0.12);
  }

  // Both descending hammer beats have a confirmed physical paving contact.
  function weaponGround(id, combo = 3) {
    if(id!=='great-hammer'||(combo!==1&&combo!==3)||!ready()||context.currentTime-lastHammerGround<.12)return;
    lastHammerGround=context.currentTime;
    const heavy=combo===3;
    tone(heavy?64:82,25,heavy?.20:.14,heavy?.37:.28,'sine',0,.001);
    noise(.026,heavy?.23:.18,2800,750,'highpass',0,.001);
    noise(.060,heavy?.29:.22,640,120,'lowpass',0,.0015);
    noise(heavy?.16:.11,heavy?.24:.16,310,65,'lowpass',.012,.004);
  }

  function footstep(weight = 1) {
    if (!ready() || context.currentTime - lastFootstep < 0.13) return;
    lastFootstep = context.currentTime;
    const volume = Math.min(1.5, Math.max(0.3, weight));
    const pitch = .92 + Math.random() * .16;
    noise(.038,.034*volume,620*pitch,140,'lowpass',0,.003);
    noise(.017,.011*volume,1700*pitch,800,'highpass',.005,.002);
    tone(90*pitch,47,.045,.021*volume,'sine',0,.003);
  }

  function landing(weight = 1) {
    if (!ready() || context.currentTime - lastLanding < .15) return;
    lastLanding = context.currentTime;
    const mass = Math.min(2, Math.max(.4, weight));
    tone(108,38,.095,.065*mass,'sine',0,.002);
    noise(.052,.080*mass,880,140,'lowpass',0,.002);
    noise(.020,.026*mass,2200,900,'highpass',.004,.002);
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
    if (!enabled) stopVoices();
    if (master) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.32 : 0, context.currentTime, 0.03);
    }
    if (enabled) unlock();
    else syncPlayback();
  }

  function pause() {
    paused = true;
    stopVoices();
    syncPlayback();
  }

  function resume() {
    paused = false;
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
    if (document.hidden) {
      stopVoices();
    }
    syncPlayback();
  };
  document.addEventListener('visibilitychange', visibility);
  return { unlock, slash, hit, weaponReady, weaponSlash, weaponHit, weaponGround, roll, footstep, landing, kill, enemy, win, setEnabled, pause, resume, update,
    destroy() {
      destroyed = true;
      document.removeEventListener('visibilitychange', visibility);
      stopVoices();
      try { wind?.stop(); } catch {}
      context?.close().catch(() => {});
    },
  };
}
