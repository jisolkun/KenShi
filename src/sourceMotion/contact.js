import { Vector3 } from 'three';

// The reference emitter remains the damage sensor. These samples describe the
// real weapon's motion only, so visual direction cannot extend its hit window.
export function sampleWeaponContact({ frame, previous, targetRig, targetPosition, attackerPosition, angle = 0 }) {
  targetRig?.group?.updateMatrixWorld(true);
  const point = targetRig?.chest?.getWorldPosition(new Vector3())
    ?? new Vector3(targetPosition?.x ?? 0, (targetPosition?.y ?? 0) + .9, targetPosition?.z ?? 0);
  point.y -= .08 * (targetRig?.group?.scale.y ?? 1);
  const outward = point.clone().sub(attackerPosition ?? new Vector3());
  outward.y = 0;
  if (outward.lengthSq() < 1e-6) outward.set(Math.sin(angle), 0, Math.cos(angle));
  outward.normalize();

  const current = frame?.headCenter ?? frame?.tip;
  const old = previous?.headCenter ?? previous?.tip;
  const direction = current && old ? current.clone().sub(old) : outward.clone();
  if (direction.lengthSq() < 1e-6) direction.copy(outward);
  direction.normalize();
  const knockback = direction.clone();
  knockback.y = 0;
  if (knockback.lengthSq() < .09) knockback.copy(outward);
  knockback.normalize();

  // The shaft and sweep span the blade's cut plane. Thrusts and nearly
  // stationary poses fall back to the sampled blade face rather than NaNs.
  const shaft = frame?.tip && frame?.heel ? frame.tip.clone().sub(frame.heel) : new Vector3(0, 1, 0);
  const cutNormal = shaft.cross(direction);
  if (cutNormal.lengthSq() < 1e-6) cutNormal.copy(frame?.normal ?? new Vector3(1, 0, 0));
  if (cutNormal.lengthSq() < 1e-6) cutNormal.set(1, 0, 0);
  cutNormal.normalize();
  return { point, direction, knockback, cutNormal };
}
