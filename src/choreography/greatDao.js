import * as THREE from 'three';
import { bladeOrientation, sampleAuthoredTracks, authoredChestTransform } from './trajectory.js';

// Original action-game choreography: a planted waist leads a broad, heavy
// blade. These timings are authored here, not measured from Undead Slayer.
export const GREAT_GRIP = { supportDistance: .22, shoulderForward: .12, armReach: .525, handClearance: true };
const hand = (grip, axis) => ({ grip, axis: new THREE.Vector3(...axis).normalize().toArray() });
const ready = hand([.18,.17,.40], [.84,-.26,.48]);
const carries = [ready,
  hand([-.14,.16,.35], [-.92,-.22,.32]),
  hand([.24,.19,.35], [.94,-.20,.27]),
  hand([-.12,.49,.36], [-.76,.57,.30]),
  ready,
];
const techniques = [
  // The first three cuts are deliberately shorter than the recovery of a
  // light saber.  A long, quiet chamber is followed by a very small release
  // window; most of the blade travel therefore happens as one fast body-led
  // burst instead of a constant-speed arm flourish.
  { name:'踏步横扫', kind:'cut', duration:.62, contact:.43, window:[.30,.60],
    chamber:hand([.31,.32,.18],[.98,.08,.18]), cross:hand([.15,.24,.56],[0,.015,1]),
    exit:hand([-.19,.18,.26],[-.98,-.04,.19]), turn:[.98,-1.10], step:0, wind:.26, brake:.79,
    bodyDrive:1.03, lunge:.17, drop:.030 },
  { name:'反向斜劈', kind:'cut', duration:.66, contact:.51, window:[.37,.68],
    chamber:hand([-.16,.58,.20],[-.83,.54,.15]), cross:hand([.15,.31,.56],[.04,.04,.998]),
    // The reverse strike keeps a gentler waist crossing so its changeover
    // from the first cut reads as one continuous handoff, not a snap.
    exit:hand([.31,.12,.24],[.91,-.37,.19]), turn:[-.88,.86], step:1, wind:.31, brake:.84,
    bodyDrive:1.00, lunge:.18, drop:.032 },
  { name:'回身大扫', kind:'cut', duration:.72, contact:.47, window:[.30,.64],
    chamber:hand([.31,.25,.24],[.97,.06,-.23]), cross:hand([.13,.23,.56],[0,.02,1]),
    exit:hand([-.21,.33,.28],[-.94,.23,-.25]), turn:[1.22,-1.34], step:0, wind:.26, brake:.81,
    bodyDrive:1.06, lunge:.20, drop:.045 },
  { name:'踏地重劈', kind:'chop', duration:.88, contact:.52, window:[.40,.67],
    chamber:hand([.20,.65,.31],[.46,.86,-.21]), cross:hand([.12,.35,.57],[0,.10,.995]),
    exit:hand([.17,.12,.40],[.10,-.51,.85]), turn:[.72,-.52], step:1, wind:.34, brake:.84,
    bodyDrive:1.08, lunge:.20, drop:.075 },
];
const stance = values => ({ yaw:0, load:0, advance:values[4], pelvisYaw:values[0], chestYaw:values[1], pitch:values[2], shiftX:values[3], bodyHeight:values[5] });
const neutral = [0,0,-.06,0,0,.875];
function orientationHands(pose) {
  const inverse = authoredChestTransform(stance(neutral)).q.invert();
  const axis = new THREE.Vector3(...pose.axis).applyQuaternion(inverse);
  const quaternion = bladeOrientation(axis.toArray(), new THREE.Vector3(1,0,0).applyQuaternion(inverse).toArray()).toArray();
  return [{...pose,quaternion}, {...pose,quaternion}];
}
export function getGreatAttack(id, combo=0, state='attack') {
  if (id !== 'great-dao' || state !== 'attack') return null;
  const index=((combo%4)+4)%4, technique=techniques[index];
  // Damage starts after the stationary chamber has accelerated and ends
  // before the blade stops. This also keeps the cutting edge aligned with a
  // well-defined velocity instead of rolling around a zero-speed reversal.
  const [release,finish]=technique.window, start=release+.035, end=finish-(index===0?.05:.025);
  return { ...technique, weaponId:id, index, active:[start,end], swing:[release,finish],
    contacts:[{hand:1,kind:technique.kind,phase:technique.contact,start,end,window:[start,end],edgeWindow:true}],
    // Keep the attack envelope wide enough to read as a great-weapon arc. The
    // damage check still uses the rendered heel-to-tip sweep, so this number
    // only controls approach/spacing and never creates invisible hits.
    reach:index===2?2.62:2.48, width:.22, halfAngle:index===2?2.18:1.76,
    ...GREAT_GRIP, midLength:.82, tipLength:1.509, tipOffset:[0,-1.509,0], rootFrame:true,
    initialHands:orientationHands(carries[index]), finalHands:orientationHands(carries[index+1]),
    cacheKey:`great-dao-v1:${index}` };
}
function feetFor(spec,p) {
  const feet=[{x:-.21,y:.075,z:.15},{x:.21,y:.075,z:-.12}];
  const lead=spec.step, start=.06, land=spec.contact-.12;
  const u=THREE.MathUtils.clamp((p-start)/(land-start),0,1), step=u*u*(3-2*u);
  feet[lead].z+=.27*step;feet[lead].x+=(lead?1:-1)*.035*step;
  if(p>start&&p<land)feet[lead].y+=Math.sin(Math.PI*u)*.10;
  // The rear foot stays down during the cut. Only the stepped foot lifts on
  // recovery, so the downward strike reads as weight transfer, not a jump.
  const recovery=THREE.MathUtils.clamp((p-spec.brake)/(1-spec.brake),0,1), settle=recovery*recovery*(3-2*recovery);
  feet[lead].z-=.27*settle;feet[lead].x-=(lead?1:-1)*.035*settle;
  feet[lead].y+=Math.sin(Math.PI*recovery)*.07;
  return feet;
}
function tracksFor(spec) {
  const {contact:c,wind,brake,chamber,cross,exit,turn:[a,b],index}=spec;
  const bodyDrive=spec.bodyDrive??1, lunge=spec.lunge??.18, drop=spec.drop??.03;
  // The second cut is the handoff from the first side. Keep its waist arc on
  // the established overlap so the two handed shaft remains continuous while
  // the other three cuts use the newer, more forceful body drive.
  const reverseHandoff=index===1;
  const start=carries[index], end=carries[index+1];
  const keys=[{p:0,...start},{p:wind,...chamber,stop:true},{p:spec.swing[0],...chamber,stop:true},
    {p:c,...cross},{p:spec.swing[1],...exit,stop:true},{p:brake,...exit,stop:true},{p:1,...end}];
  // Unwrapped azimuths take a visible flank-to-front-to-flank path. A diagonal
  // cut raises the blade; the last cut falls in a steep forward plane.
  for(const key of keys)key.angles=[Math.atan2(key.axis[0],key.axis[2]),Math.asin(key.axis[1])];
  const body=[{p:0,values:neutral},
    // Hips start the turn and push the centre of mass before the hands move.
    // Chest rotation intentionally lags the pelvis, making the weapon appear
    // to be pulled through by the whole body rather than by the wrists.
    {p:wind-.06,values:reverseHandoff?[a*.65,a*.25,-.065,a*.025,.025,.835]:[a*.70*bodyDrive,a*.22*bodyDrive,-.075-drop*.20,a*.045*bodyDrive,.035,.825]},
    {p:c-.13,values:reverseHandoff?[a*.62,a*.34,-.08,0,.065,.82]:[a*.68*bodyDrive,a*.38*bodyDrive,-.105-drop*.30,a*.020*bodyDrive,lunge*.40,.805]},
    // Hip crosses the support leg before the arms accelerate through contact.
    {p:c-.025,values:reverseHandoff?[b*.52,a*.18,-.10,-b*.03,.15,.815]:[b*.58*bodyDrive,a*.22*bodyDrive,index===3?-.23-drop*.20:-.14-drop*.25,-b*.050*bodyDrive,lunge*.78,.805]},
    {p:c+.10,values:reverseHandoff?[b*.73,b*.27,-.08,-b*.035,.18,.80]:[b*.84*bodyDrive,b*.33*bodyDrive,index===3?-.21-drop*.30:-.11-drop*.30,-b*.060*bodyDrive,lunge,.795]},
    {p:brake,values:reverseHandoff?[b*.65,b*.26,-.07,-b*.025,.13,.825]:[b*.74*bodyDrive,b*.31*bodyDrive,-.095-drop*.20,-b*.040*bodyDrive,lunge*.72,.82]},
    {p:1,values:neutral}];
  return {tracks:[[{p:0,...start},{p:1,...end}],keys],body,
    torso:[{p:0,values:[0,0]},{p:wind,values:[a,.85]},
      {p:c,values:[b*.65,.50]},{p:brake,values:[b,.14]},{p:1,values:[0,0]}],
    feet:p=>feetFor(spec,p)};
}
export function sampleGreatAttack(id,combo=0,phase=0,state='attack') {
  const spec=getGreatAttack(id,combo,state);
  return spec?sampleAuthoredTracks(spec,tracksFor(spec),phase):null;
}
export function sampleGreatReady(clock=0) {
  const follow=Math.sin(clock*1.8-.35), pose=hand([ready.grip[0],ready.grip[1]+follow*.008,ready.grip[2]],
    [ready.axis[0],ready.axis[1]+follow*.008,ready.axis[2]]);
  const quaternion=bladeOrientation(pose.axis).toArray(), axis=new THREE.Vector3(...pose.axis);
  return {hands:[{grip:new THREE.Vector3(...pose.grip).addScaledVector(axis,-GREAT_GRIP.supportDistance).toArray(),quaternion},
    {grip:pose.grip,quaternion}],stance:{yaw:0,load:0,advance:0},contacts:[],name:'weighted two-hand carry'};
}
