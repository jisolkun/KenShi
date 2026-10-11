// Physical head contact and deliberate impact waves are separate volumes.
// Sweeps release one bounded fan; a slam requires confirmed floor contact.
const profiles = [
  { direction: [-.94,-.06,.34], impactLife: .18, flashLife: .035, coreScale: [.150,.110,.180],
    swingLife: .28, swingRadius: 1.95, swingSweep: 2.35, swingWidth: .30, swingHeight: 1.02,
    dustSpread: 1.20, dustDrive: 3.6, wakeLife: .105, wakeWidth: 4.20,
    airTone: 98, airDuration: .090, airVolume: .24, airFilter: 380,
    hitTone: 105, hitDuration: .11, hitFilter: 620, hitCrackTone: 174, cameraGain: 1.80, enemyStop: .012 },
  { direction: [-.32,-.84,.44], impactLife: .19, flashLife: .040, coreScale: [.155,.120,.180],
    swingLife: .27, swingRadius: 1.86, swingSweep: 2.20, swingWidth: .34, swingHeight: .98,
    dustSpread: 1.60, dustDrive: 4.5, wakeLife: .100, wakeWidth: 4.60,
    airTone: 110, airDuration: .085, airVolume: .23, airFilter: 420,
    hitTone: 118, hitDuration: .12, hitFilter: 720, hitCrackTone: 184, cameraGain: 2.00, enemyStop: .014 },
  { direction: [.96,.02,.26], impactLife: .22, flashLife: .045, coreScale: [.170,.120,.180],
    swingLife: .31, swingRadius: 2.18, swingSweep: 2.72, swingWidth: .40, swingHeight: .94,
    dustSpread: 1.50, dustDrive: 4.0, wakeLife: .115, wakeWidth: 4.80,
    airTone: 90, airDuration: .110, airVolume: .28, airFilter: 360,
    hitTone: 92, hitDuration: .13, hitFilter: 570, hitCrackTone: 168, cameraGain: 2.15, enemyStop: .018 },
  { direction: [.02,-.96,.28], impactLife: .24, flashLife: .055, coreScale: [.170,.120,.200],
    swingLife: .36, swingRadius: 2.48, swingSweep: 3.02, swingWidth: .46, swingHeight: .88,
    dustSpread: 2.00, dustDrive: 5.5, wakeLife: .120, wakeWidth: 5.20,
    airTone: 76, airDuration: .130, airVolume: .32, airFilter: 310,
    hitTone: 70, hitDuration: .16, hitFilter: 440, hitCrackTone: 138, cameraGain: 2.70, enemyStop: .028 },
].map(profile => Object.freeze({ ...profile,
  direction: Object.freeze(profile.direction), coreScale: Object.freeze(profile.coreScale) }));

export function getHammerFeedback(combo = 0) {
  return profiles[((Math.trunc(combo) % 4) + 4) % 4] ?? profiles[0];
}

// The broad release arc is a presentation layer only. Damage still comes from
// the measured head sweep below, so making this silhouette larger cannot widen
// the hitbox or create an invisible hit behind the hammer.

export function hammerReactionDirection(headDirection, fallback = { x: 0, z: 1 }) {
  // An almost vertical smash uses the enemy's radial escape direction.
  const finite = value => Number.isFinite(value) ? value : 0;
  let x = finite(headDirection?.x), z = finite(headDirection?.z);
  if (x * x + z * z < .0025) { x = finite(fallback?.x); z = finite(fallback?.z); }
  const length = Math.hypot(x, z);
  return length > 1e-8 ? { x: x / length, y: 0, z: z / length } : { x: 0, y: 0, z: 1 };
}

export function hammerWakeActive(action, phase, headSpeed) {
  return !!action?.swing && Number.isFinite(headSpeed) && headSpeed >= 2.4
    && phase >= action.swing[0] && phase <= action.swing[1];
}

export function hammerContactAccent(hitstop, alreadyAccented = false) {
  return alreadyAccented || !Number.isFinite(hitstop) ? 0 : Math.max(0, Math.min(.028, hitstop));
}

export function getHammerArea(combo, origin, angle=0) {
  const index=((Math.trunc(combo)%4)+4)%4;
  const ground=index===1||index===3;
  return { kind:ground?'radial':'fan', origin:{x:origin?.x,y:origin?.y??0,z:origin?.z}, angle,
    radius:[2.65,2.20,3.00,3.20][index], halfAngle:ground?Math.PI:[1.70,0,1.92,0][index],
    minY:ground?(origin?.y??0)-.05:.10, maxY:(ground?(origin?.y??0):0)+[2.25,1.60,2.25,2.00][index] };
}

export function hammerAreaContains(area, target, enemyRadius=0) {
  if(!area||!target||!['fan','radial'].includes(area.kind)
    ||![area.origin?.x,area.origin?.y,area.origin?.z,area.radius,area.angle,area.halfAngle,area.minY,area.maxY,
      target.x,target.z,enemyRadius].every(Number.isFinite)
    ||area.radius<0||enemyRadius<0||area.halfAngle<0||area.maxY<area.minY)return false;
  const minY=target.minY??.18,maxY=target.maxY??1.9;
  if(![minY,maxY].every(Number.isFinite)||maxY<minY||maxY<area.minY||minY>area.maxY)return false;
  const x=target.x-area.origin.x,z=target.z-area.origin.z,distance=Math.hypot(x,z);
  if(distance>area.radius+enemyRadius)return false;
  if(area.kind==='radial'||distance<1e-8)return true;
  const along=(x*Math.sin(area.angle)+z*Math.cos(area.angle))/distance;
  const margin=Math.asin(Math.min(1,enemyRadius/distance));
  return along>=Math.cos(Math.min(Math.PI,area.halfAngle+margin));
}

export function hammerPulseCrossed(action, phase, previousPhase) {
  if(!Number.isFinite(action?.contact)||!Number.isFinite(phase))return false;
  return phase>=action.contact&&(!Number.isFinite(previousPhase)||previousPhase<action.contact)
    &&(!Number.isFinite(previousPhase)||phase>previousPhase);
}
