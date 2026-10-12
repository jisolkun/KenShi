import {
  getSourceAttackTiming,
  getSourceActionProfile,
  getSourceLocomotionSpeed,
  SOURCE_LOCOMOTION_FADE,
} from './catalogue.js';

const single = Math.fround;
const clamp = value => Math.min(1, Math.max(0, value));
const deltaSeconds = value => single(Number.isFinite(value) ? Math.max(0, value) : 0);
const wrap = value => ((value % 1) + 1) % 1;

/** An ordinary source Play starts on its update evaluation at raw time 0.
 * Call advance once per animation evaluation, including that first frame.
 * Attack -> queued recovery has no crossfade and drops boundary overshoot. */
export function createSourceAttackClock(weaponId, combo = 0,
  { atkspd, origin = 'update', firstDelta } = {}) {
  const timing = getSourceAttackTiming(weaponId, combo, { atkspd });
  if (!timing) throw new RangeError(`No source attack profile for ${weaponId}`);
  return {
    weaponId, combo: timing.combo, profile: timing.profile, timing,
    segment: 'attack', rawTime: 0, elapsed: 0, wallTime: 0,
    phase: 0, progress: 0, recovering: false, done: false,
    firstAdvance: true, origin, firstDelta,
    transitioned: false,
  };
}

/** Convert a native segment cursor to the ORIGINAL merged sampler phase.
 * It deliberately uses the unmodified profile duration/base segment speed. */
export function getSourceAttackSamplerPhase(profile, segment, rawTime = 0) {
  if (!profile) return 0;
  if (segment === 'complete') return 1;
  if (segment === 'recovery') {
    const boundary = profile.clipBoundaries?.[0]?.phase
      ?? profile.attackSeconds / profile.duration;
    return clamp(boundary + Math.max(0, rawTime)
      / (profile.duration * (profile.recoverySpeed ?? .24)));
  }
  return clamp(Math.max(0, rawTime) / (profile.duration * .24));
}

/** Mutates the session and returns the same sampler snapshot as sample().
 * done means the upper attack layer has expired: display locomotion then. */
export function advanceSourceAttackClock(clock, dt, { hold = false } = {}) {
  if (hold || clock.done) return sampleSourceAttackClock(clock);
  let delta = deltaSeconds(dt);
  clock.transitioned = false;
  if (clock.firstAdvance) {
    clock.firstAdvance = false;
    delta = Number.isFinite(clock.firstDelta) ? deltaSeconds(clock.firstDelta)
      : clock.origin === 'update' ? 0 : delta;
  }
  clock.wallTime += delta;
  const attack = clock.segment === 'attack';
  const length = attack ? clock.profile.attackRaw : clock.profile.recoveryRaw;
  const speed = attack ? clock.timing.attackSpeed : clock.timing.recoverySpeed;
  const next = single(clock.rawTime + single(delta * speed));
  if (next >= length) {
    clock.transitioned = true;
    if (attack && clock.timing.hasRecovery) {
      clock.segment = 'recovery';
      clock.recovering = true;
      clock.rawTime = 0;
    } else {
      clock.segment = 'complete';
      clock.recovering = false;
      clock.rawTime = length;
      clock.done = true;
    }
  } else clock.rawTime = next;
  const sample = sampleSourceAttackClock(clock);
  clock.elapsed = sample.elapsed;
  clock.phase = sample.phase;
  clock.progress = sample.progress;
  return sample;
}

export function sampleSourceAttackClock(clock) {
  const { profile, timing, segment, rawTime } = clock;
  const recoverySegment = segment === 'recovery' || (clock.done && timing.hasRecovery);
  const elapsed = clock.done ? timing.duration : segment === 'recovery'
    ? timing.attackSeconds + rawTime / timing.recoverySpeed
    : rawTime / timing.attackSpeed;
  return {
    profile,
    phase: getSourceAttackSamplerPhase(profile, segment, rawTime),
    progress: clamp(elapsed / timing.duration),
    segment, rawTime,
    rawDuration: recoverySegment ? profile.recoveryRaw : profile.attackRaw,
    speed: recoverySegment ? timing.recoverySpeed : timing.attackSpeed,
    duration: timing.duration, samplerDuration: profile.duration, elapsed,
    attackSeconds: timing.attackSeconds, recoverySeconds: timing.recoverySeconds,
    recovering: clock.recovering, done: clock.done,
    transitioned: clock.transitioned,
  };
}

export const createSourceAttackSession = createSourceAttackClock;
export const advanceSourceAttackSession = advanceSourceAttackClock;

/** Keep one of these on each rig. Layer0 clocks continue beneath attacks;
 * passing hold freezes both clip cursors and the .3 second source crossfade. */
export function createSourceLocomotionClock() {
  return { weaponId: null, target: null, entries: new Map(), fadeDuration: SOURCE_LOCOMOTION_FADE };
}

function locomotionSamples(clock) {
  return [...clock.entries.values()].filter(entry => entry.playing && entry.weight > 0)
    .map(entry => ({
      profile: entry.profile,
      phase: wrap(entry.rawTime / entry.rawDuration),
      rawTime: entry.rawTime, rawDuration: entry.rawDuration,
      speed: entry.speed, weight: entry.weight, state: entry.state, layer: 0,
    }));
}

/** Returns {profile, phase, weight} samples ready for the source curve blend.
 * Incoming native CrossFade clips spend their first evaluation at time 0;
 * outgoing clips retain their clocks and most recently configured speed. */
export function advanceSourceLocomotionClock(clock, weaponId, state, dt,
  { speedFactor = 7, hold = false, reset = false } = {}) {
  if (hold) return locomotionSamples(clock);
  if (reset || (clock.weaponId !== null && clock.weaponId !== weaponId)) {
    clock.entries.clear();
    clock.target = null;
  }
  clock.weaponId = weaponId;
  const profile = getSourceActionProfile(weaponId, state);
  if (!profile?.loop) return locomotionSamples(clock);
  const clip = profile.segments[0];
  const key = `${clip.file}:${clip.pathId}`;
  let entry = clock.entries.get(key);
  if (!entry) {
    entry = {
      profile, state, rawDuration: clip.rawDuration,
      rawTime: 0, preciseTime: 0, speed: single(getSourceLocomotionSpeed(state, speedFactor)),
      weight: 0, playing: false, firstAdvance: false, fade: null,
    };
    clock.entries.set(key, entry);
  }
  const fresh = !entry.playing;
  if (fresh) {
    entry.playing = true;
    entry.firstAdvance = true;
    entry.rawTime = entry.preciseTime = 0;
  }
  entry.speed = single(getSourceLocomotionSpeed(state, speedFactor));
  if (clock.target !== key || fresh) {
    const initial = clock.target === null;
    clock.target = key;
    for (const [id, other] of clock.entries) {
      if (!other.playing) continue;
      const target = id === key ? 1 : 0;
      if (initial) {
        other.weight = target;
        other.fade = null;
      } else other.fade = {
        target, rate: single(single(target - other.weight) / single(clock.fadeDuration)),
      };
    }
  }
  const delta = deltaSeconds(dt);
  for (const other of clock.entries.values()) {
    if (!other.playing) continue;
    const spend = other.firstAdvance ? 0 : delta;
    other.firstAdvance = false;
    // Source layer0 accumulates rounded products internally at double precision.
    other.preciseTime += single(spend * other.speed);
    other.rawTime = single(other.preciseTime);
    if (other.fade) {
      const fade = other.fade;
      const next = single(other.weight + single(spend * fade.rate));
      other.weight = fade.target === 1 ? Math.min(1, next) : Math.max(0, next);
      if (other.weight === fade.target) {
        other.fade = null;
        if (fade.target === 0) {
          other.playing = false;
          other.rawTime = other.preciseTime = 0;
        }
      }
    }
  }
  return locomotionSamples(clock);
}

export function sampleSourceLocomotion(rig, { weaponId = rig.weaponId, state = 'idle',
  dt = 0, speedFactor = 7, hold = false, reset = false } = {}) {
  const clock = rig.sourceLocomotionClock ??= createSourceLocomotionClock();
  return advanceSourceLocomotionClock(clock, weaponId, state, dt, { speedFactor, hold, reset });
}
