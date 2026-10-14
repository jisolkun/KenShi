import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/audio.js';

function withAudio(run) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const previousRandom = Math.random, contexts = [], events = new Map();
  const parameter = () => ({ value: 0, values: [],
    setValueAtTime(value, time) { this.start = value; this.time = time; this.values.push(value); },
    exponentialRampToValueAtTime(value, time) { this.end = value; this.endTime = time; this.values.push(value); },
    cancelScheduledValues() {}, setTargetAtTime(value) { this.target = value; },
  });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(),
    connections: [], stopCount: 0, connect(other) { this.connections.push(other); },
    disconnect() { this.disconnected = true; }, start(time = 0) { this.startTime = time; },
    stop(time) { this.stopCount++; this.stopTime = time; },
  });
  class FakeAudioContext {
    constructor() {
      this.currentTime = 10; this.sampleRate = 100; this.state = 'suspended';
      this.destination = {}; this.oscillators = []; this.filters = []; this.sources = []; this.gains = [];
      this.resumeCount = 0; contexts.push(this);
    }
    createGain() { const gain = node(); this.gains.push(gain); return gain; }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(),
      ratio: parameter(), attack: parameter(), release: parameter() }; }
    createBuffer() { return { getChannelData: () => new Float32Array(200) }; }
    createBufferSource() { const source = node(); this.sources.push(source); return source; }
    createBiquadFilter() { const filter = node(); this.filters.push(filter); return filter; }
    createOscillator() { const osc = node(); this.oscillators.push(osc); return osc; }
    resume() { this.resumeCount++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.document = { hidden: false,
    addEventListener(name, listener) { events.set(name, listener); },
    removeEventListener(name) { events.delete(name); },
  };
  Math.random = () => .5;
  let audio;
  const restore = () => {
    audio?.destroy();
    globalThis.window = previousWindow; globalThis.document = previousDocument; Math.random = previousRandom;
  };
  try {
    audio = createAudio(); audio.unlock();
    const context = contexts[0];
    const reset = () => {
      context.currentTime += 1;
      context.oscillators.length = 0; context.filters.length = 0; context.sources.length = 0;
    };
    const result = run({ audio, context, contexts, events, reset });
    if (result?.then) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

const signature = context => JSON.stringify([
  ...context.oscillators.map(osc => [osc.type, osc.frequency.start, osc.frequency.end,
    Number((osc.frequency.endTime - osc.frequency.time).toFixed(4))]),
  ...context.filters.map(filter => [filter.type, filter.frequency.start, filter.frequency.end,
    Number((filter.frequency.endTime - filter.frequency.time).toFixed(4))]),
]);

test('each source blade weapon has five recognizable released strokes and contacts', () => {
  withAudio(({ audio, context, reset }) => {
    for (const id of ['dual-dao', 'tang-dao', 'great-dao']) {
      const slashes = new Set(), hits = new Set();
      for (let combo = 0; combo < 5; combo++) {
        reset(); audio.weaponSlash(id, combo);
        assert.ok(context.oscillators.length > 0 && context.filters.length > 0, `${id} stroke ${combo + 1} emits air and body`);
        assert.ok(context.oscillators.length + context.filters.length <= 10, 'each stroke has a bounded voice count');
        assert.ok(context.oscillators.some(osc => osc.frequency.start > 1000), 'blades retain an audible metal edge');
        slashes.add(signature(context));
        reset(); audio.weaponHit(id, 1.5, combo);
        assert.ok(context.oscillators.length > 0 && context.filters.length > 0);
        assert.ok(context.oscillators.length + context.filters.length <= 10, 'each contact has a bounded voice count');
        hits.add(signature(context));
      }
      assert.equal(slashes.size, 5, `${id} five attack gestures have individual releases`);
      assert.equal(hits.size, 5, `${id} five contacts are individually weighted`);
    }
  });
});

test('a crowd contact is one impact cluster and loading does not consume the release event', () => {
  withAudio(({ audio, context, reset }) => {
    reset(); audio.weaponReady('great-dao', 4);
    const prepared = context.oscillators.length + context.filters.length;
    assert.ok(prepared > 0);
    assert.ok(context.gains.slice(-3).every(gain => gain.gain.values.every(value => value < .05)), 'loading sounds are quiet');
    audio.weaponSlash('great-dao', 4);
    assert.ok(context.oscillators.length + context.filters.length > prepared, 'loading and the physical stroke use separate clocks');
    reset(); audio.weaponHit('dual-dao', 1.5, 4);
    const count = context.oscillators.length + context.filters.length;
    context.currentTime += .04; audio.weaponHit('great-dao', 2, 4);
    assert.equal(context.oscillators.length + context.filters.length, count, 'all weapons share the 50ms crowd limiter');
    context.currentTime += .011; audio.weaponHit('great-dao', 2, 4);
    assert.ok(context.oscillators.length + context.filters.length > count, 'a later physical contact remains audible');
    reset(); audio.landing(1.5);
    assert.ok(context.oscillators.length > 0 && context.filters.length > 0);
    const landings = context.oscillators.length; audio.landing(1.5);
    assert.equal(context.oscillators.length, landings, 'a landing cannot double its bass');
  });
});

test('pause, visibility and resume stop old sounds and preserve the chosen mute state', () => {
  withAudio(({ audio, context, contexts, events, reset }) => {
    reset(); audio.weaponSlash('tang-dao', 4); audio.win();
    const oldVoices = [...context.oscillators, ...context.sources];
    audio.pause();
    assert.equal(context.state, 'suspended');
    assert.ok(oldVoices.every(voice => voice.stopCount === 2 && voice.disconnected), 'pause clears both playing and future transient voices');
    reset(); audio.weaponSlash('tang-dao', 1); audio.unlock();
    assert.equal(context.oscillators.length, 0, 'UI unlock does not undo game pause');
    assert.equal(context.state, 'suspended');
    const resumes = context.resumeCount;
    audio.setEnabled(false); audio.resume(); audio.unlock();
    assert.equal(context.resumeCount, resumes, 'resume respects the selected mute state');
    assert.equal(context.gains[0].gain.target, 0);
    audio.setEnabled(true);
    assert.equal(context.state, 'running');
    assert.equal(context.gains[0].gain.target, .32);
    reset(); audio.weaponSlash('dual-dao', 0);
    assert.ok(context.oscillators.length > 0, 're-enabling explicitly makes new attacks audible');
    globalThis.document.hidden = true; events.get('visibilitychange')();
    assert.equal(context.state, 'suspended');
    reset(); audio.weaponHit('dual-dao', 1, 0);
    assert.equal(context.oscillators.length, 0, 'hidden tabs do not schedule transient sounds');
    audio.pause(); globalThis.document.hidden = false; events.get('visibilitychange')();
    assert.equal(context.state, 'suspended', 'tab visibility cannot bypass game pause');
    audio.resume(); assert.equal(context.state, 'running');
    audio.setEnabled(false); globalThis.document.hidden = true; events.get('visibilitychange')();
    globalThis.document.hidden = false; events.get('visibilitychange')(); audio.resume();
    assert.equal(context.state, 'suspended', 'tab restore also preserves mute');
    audio.destroy(); audio.unlock(); audio.resume();
    assert.equal(context.state, 'closed'); assert.equal(contexts.length, 1, 'destroy cannot recreate an audio graph');
    assert.equal(events.size, 0);
  });
});

test('fast pause, resume and tab changes reconcile asynchronously completed AudioContext changes', async () => {
  await withAudio(async ({ audio, context, events }) => {
    const originalSuspend = context.suspend.bind(context), originalResume = context.resume.bind(context);
    let finishSuspend;
    context.suspend = () => new Promise(resolve => {
      finishSuspend = () => { context.state = 'suspended'; resolve(); };
    });
    audio.pause(); audio.resume();
    assert.equal(context.state, 'running', 'the browser has not completed its suspension yet');
    finishSuspend(); await Promise.resolve();
    assert.equal(context.state, 'running', 'a late suspension respects the newer resume');
    context.suspend = originalSuspend; audio.pause();
    let finishResume;
    context.resume = () => new Promise(resolve => {
      finishResume = () => { context.state = 'running'; resolve(); };
    });
    audio.resume(); audio.pause(); finishResume(); await Promise.resolve();
    assert.equal(context.state, 'suspended', 'a late resume respects the newer pause');
    audio.resume(); audio.setEnabled(false); finishResume(); await Promise.resolve();
    assert.equal(context.state, 'suspended', 'a late resume also respects a new mute');
    assert.equal(context.gains[0].gain.target, 0);
    context.resume = originalResume;
    audio.setEnabled(true);
    context.suspend = () => new Promise(resolve => {
      finishSuspend = () => { context.state = 'suspended'; resolve(); };
    });
    globalThis.document.hidden = true; events.get('visibilitychange')();
    globalThis.document.hidden = false; events.get('visibilitychange')();
    finishSuspend(); await Promise.resolve();
    assert.equal(context.state, 'running', 'a late hidden-tab suspension respects the restored tab');
    context.suspend = originalSuspend;
  });
});
