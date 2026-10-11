import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudio} from '../src/audio.js';

test('hammer voices keep low air and short blunt stone contacts, throttle crowds and allow both confirmed ground slams',()=>{
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
      const body=context.filters.filter(filter=>filter.type==='lowpass'),stone=context.filters.filter(filter=>filter.type==='highpass');
      assert.ok(body.length>0&&body.every(filter=>filter.frequency.start<=720),'contacts retain their low blunt body');
      assert.equal(body.length+stone.length,context.filters.length,'no sustained metal resonance filter');
      assert.equal(stone.length,1,'one stone crack accents each contact');
      assert.ok(stone.every(filter=>filter.frequency.endTime-filter.frequency.time<=.03
        &&filter.frequency.start>=1000&&filter.frequency.end<=1000),'stone crack remains a brief contact transient');
      assert.ok(context.oscillators.every(o=>o.frequency.endTime-o.frequency.time<=.2));
      const count=context.oscillators.length,filters=context.filters.length;
      audio.weaponHit('great-hammer',1.5,combo);
      assert.equal(context.oscillators.length,count);assert.equal(context.filters.length,filters,'crowd throttle also suppresses stone layers');
    }
    reset();audio.weaponGround('great-hammer',0);audio.weaponGround('great-hammer',2);audio.weaponGround('great-dao',3);
    assert.equal(context.oscillators.length,0);assert.equal(context.filters.length,0,'unsupported ground events are silent');
    for(const combo of [1,3]){
      reset();audio.weaponGround('great-hammer',combo);
      assert.ok(context.oscillators.length>0&&context.oscillators.every(o=>o.type==='sine'&&o.frequency.start<=110),'confirmed ground slam has low body');
      assert.ok(context.filters.some(filter=>filter.type==='highpass'&&filter.frequency.endTime-filter.frequency.time<=.03),'confirmed rock hit has a short stone crack');
      const count=context.oscillators.length,filters=context.filters.length;
      audio.weaponGround('great-hammer',combo);
      assert.equal(context.oscillators.length,count,'one confirmed ground event cannot stack bass');
      assert.equal(context.filters.length,filters,'one confirmed ground event cannot stack debris');
    }
    reset();audio.weaponSlash('dual-dao',0);assert.ok(context.oscillators.some(o=>o.frequency.start>1000),'retained blade voice remains unchanged');
    audio.setEnabled(false);reset();audio.weaponHit('great-hammer',1.5,3);audio.weaponGround('great-hammer',1);audio.weaponGround('great-hammer',3);
    assert.equal(context.oscillators.length,0);assert.equal(context.filters.length,0);
    audio.destroy();
  }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});
