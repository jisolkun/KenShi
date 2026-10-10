import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudio} from '../src/audio.js';

test('hammer voices use short low blunt transients, throttle crowd contacts and reserve ground audio for confirmed finishers',()=>{
  const previousWindow=globalThis.window,previousDocument=globalThis.document,contexts=[];
  const parameter=()=>({value:0,setValueAtTime(value,time){this.start=value;this.time=time;},
    exponentialRampToValueAtTime(value,time){this.end=value;this.endTime=time;},
    cancelScheduledValues(){},setTargetAtTime(){}});
  const node=()=>({connect(){},disconnect(){},gain:parameter(),frequency:parameter(),Q:parameter(),
    start(){},stop(){}});
  class FakeAudioContext{
    constructor(){this.currentTime=10;this.sampleRate=100;this.state='running';this.destination={};this.oscillators=[];this.filters=[];contexts.push(this);}
    createGain(){return node();}
    createDynamicsCompressor(){return {...node(),threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter()};}
    createBuffer(){return {getChannelData:()=>new Float32Array(200)};}
    createBufferSource(){return node();}
    createBiquadFilter(){const filter=node();this.filters.push(filter);return filter;}
    createOscillator(){const oscillator=node();this.oscillators.push(oscillator);return oscillator;}
    resume(){this.state='running';return Promise.resolve();}
    suspend(){this.state='suspended';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
  }
  globalThis.window={AudioContext:FakeAudioContext};globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  try{
    const audio=createAudio();audio.unlock();const context=contexts[0];
    const reset=()=>{context.oscillators.length=0;context.filters.length=0;context.currentTime+=1;};
    for(let combo=0;combo<4;combo++){
      reset();audio.weaponSlash('great-hammer',combo);
      assert.ok(context.oscillators.length>0);assert.ok(context.oscillators.every(o=>o.type==='sine'&&o.frequency.start<=110));
      assert.ok(context.filters.every(filter=>filter.type==='lowpass'&&filter.frequency.start<=420));
      reset();audio.weaponHit('great-hammer',1.5,combo);
      assert.ok(context.oscillators.every(o=>o.frequency.start<200),'no sword metal ringing voice');
      assert.ok(context.filters.every(filter=>filter.type==='lowpass'&&filter.frequency.start<=720));
      assert.ok(context.oscillators.every(o=>o.frequency.endTime-o.frequency.time<=.2));
      const count=context.oscillators.length;audio.weaponHit('great-hammer',1.5,combo);assert.equal(context.oscillators.length,count);
    }
    reset();audio.weaponGround('great-hammer',0);audio.weaponGround('great-dao',3);assert.equal(context.oscillators.length,0);
    audio.weaponGround('great-hammer',3);assert.equal(context.oscillators.length,1);assert.equal(context.oscillators[0].frequency.start,64);
    audio.weaponGround('great-hammer',3);assert.equal(context.oscillators.length,1,'one confirmed ground event cannot stack bass');
    reset();audio.weaponSlash('dual-dao',0);assert.ok(context.oscillators.some(o=>o.frequency.start>1000),'retained blade voice remains unchanged');
    audio.setEnabled(false);reset();audio.weaponHit('great-hammer',1.5,3);audio.weaponGround('great-hammer',3);assert.equal(context.oscillators.length,0);
    audio.destroy();
  }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});
