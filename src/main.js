import * as THREE from "three";
import { createCharacter, poseCharacter } from "./characters.js";
import { createWorld } from "./world.js";
import { createUI } from "./ui.js";
import { createAudio } from "./audio.js";
import { createEffects } from "./effects.js";
import "./style.css";

const app = document.querySelector("#app") || document.body;
const canvas = document.createElement("canvas");
canvas.className = "game-canvas";
canvas.setAttribute("aria-label", "亡灵杀手战场，点击移动与追击，双击翻滚");
app.prepend(canvas);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
} catch (error) {
  app.innerHTML =
    '<main class="webgl-fallback"><h1>无法开启这片战场</h1><p>请启用浏览器硬件加速，或使用支持 WebGL 的浏览器。</p><button onclick="location.reload()">重新尝试</button></main>';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87958b);
scene.fog = new THREE.Fog(0x8b9a8e, 35, 85);
// Estimated from original gameplay screenshots; these are our tuning values.
const cameraSettings = {
  yaw: Math.PI / 4,
  pitch: THREE.MathUtils.degToRad(58),
  span: 11.2,
  distance: 36,
};
const camera = new THREE.OrthographicCamera(-10, 10, 5.6, -5.6, 0.1, 100);
const cameraRight = new THREE.Vector3(
  Math.cos(cameraSettings.yaw),
  0,
  -Math.sin(cameraSettings.yaw),
);
const cameraBack = new THREE.Vector3(
  Math.sin(cameraSettings.yaw),
  0,
  Math.cos(cameraSettings.yaw),
);
const cameraOffset = new THREE.Vector3(
  Math.sin(cameraSettings.yaw) * Math.cos(cameraSettings.pitch),
  Math.sin(cameraSettings.pitch),
  Math.cos(cameraSettings.yaw) * Math.cos(cameraSettings.pitch),
).multiplyScalar(cameraSettings.distance);
function resizeCamera() {
  const halfHeight = cameraSettings.span / 2;
  const halfWidth = (halfHeight * innerWidth) / innerHeight;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}
resizeCamera();
const hemi = new THREE.HemisphereLight(0xd9e7df, 0x3b3830, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd49b, 3.3);
sun.position.set(-12, 21, -9);
sun.castShadow = true;
sun.shadow.mapSize.set(
  innerWidth < 700 ? 1024 : 1536,
  innerWidth < 700 ? 1024 : 1536,
);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 24;
sun.shadow.camera.bottom = -24;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xc4e1e6, 1.2);
rim.position.set(8, 8, 17);
scene.add(rim);
const world = createWorld(scene);
const audio = createAudio();
const fx = createEffects(scene, camera);
const rig = createCharacter("hero");
scene.add(rig.group);
const hero = {
  rig,
  pos: new THREE.Vector3(0, 0, 4),
  velocity: new THREE.Vector3(), // External knockback, separate from locomotion.
  moveVelocity: new THREE.Vector3(),
  gaitPhase: 0,
  moveBlend: 0,
  turnLean: 0,
  attackCarry: 0,
  localHitStop: 0,
  attackHits: new Set(),
  impactDone: false,
  globalImpactDone: false,
  nextAttackIn: 0,
  transition: { from: "idle", to: "idle", age: 1, duration: 0.08 },
  poseState: "idle",
  poseCombo: 0,
  angle: Math.PI,
  state: "idle",
  elapsed: 0,
  duration: 0,
  combo: 0,
  comboTimer: 0,
  hitDone: false,
  invulnerable: 0,
  flash: 0,
  hp: 120,
  maxHp: 120,
  stamina: 100,
  souls: 100,
  target: null,
  destination: null,
  disengage: 0,
  skillIndex: 0,
  skillHits: new Set(),
  rollDirection: new THREE.Vector3(),
  dashDirection: new THREE.Vector3(),
  ghostTimer: 0,
  mount: 0,
};
const skills = [
  { cost: 20, cooldown: 0, maxCooldown: 4 },
  { cost: 28, cooldown: 0, maxCooldown: 6 },
  { cost: 35, cooldown: 0, maxCooldown: 8 },
  { cost: 30, cooldown: 0, maxCooldown: 8 },
  { cost: 40, cooldown: 0, maxCooldown: 9 },
];
const metrics = { taps: 0, rolls: 0, skills: 0, specials: 0 };
let mode = "start",
  gameTime = 0,
  globalTime = 0,
  wave = 1,
  kills = 0,
  hits = 0,
  combo = 0,
  comboTimeout = 0,
  waveTimer = -1,
  total = 36,
  shake = 0,
  hitStop = 0,
  slowTime = 0,
  slowScale = 1,
  sound = true,
  nextId = 1,
  arrowTime = 0;
let enemies = [],
  projectiles = [],
  drops = [],
  companions = [];
const specials = { horse: true, eagle: true, captain: true };
const attackDurations = [0.32, 0.34, 0.4, 0.5];
const attackWindows = [
  [0.38, 0.58],
  [0.38, 0.58],
  [0.4, 0.62],
  [0.42, 0.72],
];
const attackContacts = [0.43, 0.43, 0.47, 0.48];
let shakeAge = 1,
  shakeNext = 0;
const shakeDirection = new THREE.Vector3();
const attackDamages = [18, 19, 22, 32];
const attackRanges = [2.12, 2.15, 2.45, 2.55];
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const cameraFocus = new THREE.Vector3(0, 0, 2),
  temp = new THREE.Vector3(),
  temp2 = new THREE.Vector3();
const keys = new Set();
const ui = createUI({
  start: startGame,
  pause: pauseGame,
  resume: resumeGame,
  retry: startGame,
  skill: castSkill,
  special: useSpecial,
  sound(enabled) {
    sound = enabled;
    audio.setEnabled?.(enabled);
  },
  help() {
    pauseGame("help");
  },
});
const trails = [fx.swordTrail(), fx.swordTrail()];
const destinationMarker = new THREE.Group();
for (let i = 0; i < 2; i++) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(i ? 0.21 : 0.32, i ? 0.235 : 0.345, 32),
    new THREE.MeshBasicMaterial({
      color: i ? 0xffebc1 : 0xccab78,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  destinationMarker.add(mesh);
}
destinationMarker.position.y = 0.04;
destinationMarker.visible = false;
scene.add(destinationMarker);
const targetMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 0.8, 40),
  new THREE.MeshBasicMaterial({
    color: 0xe95a3d,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
targetMarker.rotation.x = -Math.PI / 2;
scene.add(targetMarker);
targetMarker.visible = false;

function safeAudio(name, ...args) {
  audio[name]?.(...args);
}
function face(direction, rate = 0.35) {
  if (direction.lengthSq() < 0.001) return;
  const desired = Math.atan2(direction.x, direction.z);
  hero.angle +=
    Math.atan2(Math.sin(desired - hero.angle), Math.cos(desired - hero.angle)) *
    rate;
}
function keyboardDirection() {
  const horizontal =
    Number(keys.has("d") || keys.has("arrowright")) -
    Number(keys.has("a") || keys.has("arrowleft"));
  const vertical =
    Number(keys.has("s") || keys.has("arrowdown")) -
    Number(keys.has("w") || keys.has("arrowup"));
  return cameraRight
    .clone()
    .multiplyScalar(horizontal)
    .addScaledVector(cameraBack, vertical)
    .normalize();
}
function kickCamera(direction, amount) {
  if (globalTime < shakeNext && amount <= shake) return;
  shakeNext = globalTime + 0.065;
  shake = Math.max(shake, amount);
  shakeAge = 0;
  shakeDirection.copy(direction);
  shakeDirection.y = 0;
  if (shakeDirection.lengthSq() < 0.001) shakeDirection.copy(cameraRight);
  shakeDirection.normalize();
}
function locomotion(
  dt,
  direction,
  distance = Infinity,
  maxSpeed = 5.8,
  stoppingDistance = 0,
) {
  const remaining = Math.max(0, distance - stoppingDistance);
  const desired = direction?.clone().normalize() || new THREE.Vector3();
  const speed = direction ? Math.min(maxSpeed, remaining / 0.09) : 0;
  desired.multiplyScalar(speed);
  const response = speed > hero.moveVelocity.length() ? 24 : 27;
  hero.moveVelocity.lerp(desired, 1 - Math.exp(-dt * response));
  if (hero.moveVelocity.lengthSq() < 0.0025 && speed === 0)
    hero.moveVelocity.set(0, 0, 0);
  const displacement = hero.moveVelocity.clone().multiplyScalar(dt);
  if (direction && distance < Infinity && displacement.length() > remaining) {
    displacement.copy(direction).normalize().multiplyScalar(remaining);
    hero.moveVelocity.copy(displacement).multiplyScalar(dt > 0 ? 1 / dt : 0);
  }
  hero.pos.add(displacement);
  if (direction && direction.lengthSq() > 0.1) {
    const desiredAngle = Math.atan2(direction.x, direction.z);
    const delta = Math.atan2(
      Math.sin(desiredAngle - hero.angle),
      Math.cos(desiredAngle - hero.angle),
    );
    hero.turnLean = THREE.MathUtils.lerp(
      hero.turnLean,
      THREE.MathUtils.clamp(delta * 0.9, -1, 1),
      1 - Math.exp(-dt * 12),
    );
    face(direction, 1 - Math.exp(-dt * 24));
  } else hero.turnLean *= Math.exp(-dt * 12);
}
function movementGoal() {
  const keyboard = keyboardDirection();
  if (keyboard.lengthSq() > 0) {
    hero.destination = null;
    hero.target = null;
    destinationMarker.visible = false;
    targetMarker.visible = false;
    return { direction: keyboard, distance: Infinity, stoppingDistance: 0 };
  }
  if (hero.destination) {
    const delta = hero.destination.clone().sub(hero.pos);
    const distance = delta.length();
    if (distance < 0.035) {
      hero.pos.copy(hero.destination);
      hero.destination = null;
      hero.moveVelocity.set(0, 0, 0);
      destinationMarker.visible = false;
      return null;
    }
    return { direction: delta.normalize(), distance, stoppingDistance: 0 };
  }
  if (hero.target && hero.target.state !== "dead") {
    const delta = hero.target.pos.clone().sub(hero.pos);
    const distance = delta.length();
    return {
      direction: delta.normalize(),
      distance,
      stoppingDistance: Math.max(
        1.15,
        attackRanges[hero.combo] + hero.target.radius - 0.38,
      ),
    };
  }
  return null;
}
function locomotionState() {
  hero.state = hero.moveVelocity.length() > 0.12 ? "run" : "idle";
}
function clampPosition(pos, radius = 0.5) {
  const b = world.bounds;
  pos.x = THREE.MathUtils.clamp(pos.x, b.minX + radius, b.maxX - radius);
  pos.z = THREE.MathUtils.clamp(pos.z, b.minZ + radius, b.maxZ - radius);
  for (const o of world.obstacles || []) {
    const dx = pos.x - o.x,
      dz = pos.z - o.z,
      d = Math.hypot(dx, dz),
      r = o.radius + radius;
    if (d < r) {
      if (d < 0.001) {
        pos.x += r;
      } else {
        pos.x = o.x + (dx / d) * r;
        pos.z = o.z + (dz / d) * r;
      }
    }
  }
  pos.y = 0;
}
function move(position, direction, speed, dt, radius = 0.5) {
  position.addScaledVector(direction, speed * dt);
  clampPosition(position, radius);
}
function worldToScreen(position) {
  const p = position.clone().project(camera);
  return {
    x: (p.x * 0.5 + 0.5) * innerWidth,
    y: (-p.y * 0.5 + 0.5) * innerHeight,
    visible: p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
  };
}
function showDamage(entity, amount, kind = "normal") {
  const p = worldToScreen(
    entity.pos
      .clone()
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.35,
          entity.type === "boss" ? 3 : 2.1,
          0,
        ),
      ),
  );
  ui.damage(String(amount), p.x, p.y, kind);
}
function stateSnapshot() {
  const boss = enemies.find((e) => e.type === "boss" && e.state !== "dead");
  return {
    hp: hero.hp,
    maxHp: hero.maxHp,
    stamina: hero.stamina,
    maxStamina: 100,
    souls: hero.souls,
    maxSouls: 100,
    wave,
    progress: kills / total,
    kills,
    total,
    combo,
    time: gameTime,
    bossHp: boss?.hp || 0,
    bossMaxHp: boss?.maxHp || 0,
    skills: skills.map((s) => ({ ...s })),
    specials: { ...specials },
    sound,
    mode,
    phase: mode,
    hits,
    resources: { souls: hero.souls, stamina: hero.stamina },
    inputs: { ...metrics },
    render: {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    },
    player: {
      x: hero.pos.x,
      z: hero.pos.z,
      hp: hero.hp,
      stamina: hero.stamina,
      state: hero.state,
      combo: hero.combo,
      speed: hero.moveVelocity.length(),
      velocity: { x: hero.moveVelocity.x, z: hero.moveVelocity.z },
      gait: hero.gaitPhase,
      transition: { ...hero.transition },
    },
    camera: {
      type: "orthographic",
      yaw: THREE.MathUtils.radToDeg(cameraSettings.yaw),
      pitch: THREE.MathUtils.radToDeg(cameraSettings.pitch),
      span: cameraSettings.span,
      horizontalSpan: (cameraSettings.span * innerWidth) / innerHeight,
      focus: { x: cameraFocus.x, z: cameraFocus.z },
    },
    motion: {
      velocity: { x: hero.moveVelocity.x, z: hero.moveVelocity.z },
      speed: hero.moveVelocity.length(),
      gait: hero.gaitPhase,
      moveBlend: hero.moveBlend,
      turnLean: hero.turnLean,
      transition: { ...hero.transition },
      localHitStop: hero.localHitStop,
      destination: hero.destination
        ? { x: hero.destination.x, z: hero.destination.z }
        : null,
    },
    hero: {
      x: hero.pos.x,
      z: hero.pos.z,
      state: hero.state,
      combo: hero.combo,
    },
    enemies: enemies.filter((e) => e.state !== "dead").length,
  };
}
function pauseGame(screen = "pause") {
  if (mode !== "playing") return;
  mode = "pause";
  keys.clear();
  ui.showScreen(screen, stateSnapshot());
}
function resumeGame() {
  if (mode !== "pause") return;
  mode = "playing";
  ui.showScreen("hide");
}
function disposeGroup(group, geometry = true) {
  scene.remove(group);
  group?.traverse((o) => {
    if (o.isMesh) {
      if (geometry) o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    }
  });
}
function clearDynamic() {
  for (const e of enemies) {
    disposeGroup(e.rig.group, false);
    disposeGroup(e.bar);
  }
  for (const p of projectiles) disposeGroup(p.mesh, false);
  for (const d of drops) disposeGroup(d.mesh, false);
  for (const c of companions) disposeGroup(c.rig?.group || c.mesh, false);
  enemies = [];
  projectiles = [];
  drops = [];
  companions = [];
  if (horseMesh) {
    disposeGroup(horseMesh);
    horseMesh = null;
  }
  if (eagleMesh) {
    disposeGroup(eagleMesh);
    eagleMesh = null;
  }
  fx.clear();
}
function startGame() {
  audio.unlock?.();
  keys.clear();
  lastTap = null;
  pointerStart = null;
  clearDynamic();
  mode = "playing";
  gameTime = 0;
  Object.keys(metrics).forEach((k) => (metrics[k] = 0));
  kills = 0;
  hits = 0;
  combo = 0;
  comboTimeout = 0;
  wave = 1;
  waveTimer = -1;
  shake = 0;
  hitStop = 0;
  slowTime = 0;
  hero.pos.set(0, 0, 4);
  hero.angle = Math.PI;
  hero.state = "idle";
  hero.elapsed = 0;
  hero.combo = 0;
  hero.comboTimer = 0;
  hero.hp = 120;
  hero.stamina = 100;
  hero.souls = 100;
  hero.invulnerable = 1.3;
  hero.flash = 0;
  hero.target = null;
  hero.destination = null;
  hero.mount = 0;
  hero.flight = 0;
  hero.disengage = 0;
  hero.velocity.set(0, 0, 0);
  hero.moveVelocity.set(0, 0, 0);
  hero.gaitPhase = 0;
  hero.moveBlend = 0;
  hero.turnLean = 0;
  hero.localHitStop = 0;
  hero.nextAttackIn = 0;
  hero.attackHits.clear();
  hero.transition = { from: "idle", to: "idle", age: 1, duration: 0.08 };
  hero.poseState = "idle";
  hero.poseCombo = 0;
  for (const s of skills) s.cooldown = 0;
  Object.keys(specials).forEach((k) => (specials[k] = true));
  destinationMarker.visible = false;
  targetMarker.visible = false;
  ui.showScreen("hide");
  spawnWave(1);
  ui.notify("第一阵 · 山门尸潮");
  cameraFocus.copy(hero.pos);
}
function finishGame(won) {
  if (mode !== "playing") return;
  mode = won ? "win" : "lose";
  keys.clear();
  hero.destination = null;
  hero.target = null;
  destinationMarker.visible = false;
  ui.showScreen(won ? "win" : "lose", {
    stars: won ? 1 + Number(gameTime <= 180) + Number(hits <= 2) : 0,
    kills,
    time: gameTime,
    hits,
    total,
  });
  if (won) safeAudio("win");
}

function makeBar(type) {
  const g = new THREE.Group();
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(type === "boss" ? 1.8 : 1.05, 0.09),
    new THREE.MeshBasicMaterial({
      color: 0x1b1716,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(type === "boss" ? 1.76 : 1, 0.052),
    new THREE.MeshBasicMaterial({
      color: type === "boss" ? 0xefaa58 : 0xdc624e,
      depthTest: false,
    }),
  );
  fill.position.z = 0.002;
  g.add(back, fill);
  g.renderOrder = 10;
  g.userData.fill = fill;
  g.userData.width = type === "boss" ? 1.76 : 1;
  scene.add(g);
  return g;
}
const enemyStats = {
  grunt: { hp: 65, speed: 2.05, range: 1.55, damage: 7, radius: 0.45 },
  brute: { hp: 155, speed: 1.5, range: 2.2, damage: 14, radius: 0.75 },
  archer: { hp: 48, speed: 1.85, range: 10, damage: 6, radius: 0.44 },
  boss: { hp: 1100, speed: 1.65, range: 3.5, damage: 18, radius: 1.0 },
};
function spawnEnemy(type, x, z) {
  const st = enemyStats[type],
    rig = createCharacter(type);
  const e = {
    id: nextId++,
    type,
    rig,
    pos: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    angle: 0,
    state: "spawn",
    elapsed: 0,
    duration: 0.65 + Math.random() * 0.4,
    hp: st.hp,
    maxHp: st.hp,
    ...st,
    cooldown: 0.9 + Math.random() * 1.8,
    flash: 0,
    hitDone: false,
    targetPos: new THREE.Vector3(),
    attackKind: 0,
    combo: 0,
    bar: makeBar(type),
    deathAge: 0,
  };
  clampPosition(e.pos, e.radius);
  rig.group.position.copy(e.pos);
  rig.group.traverse((o) => {
    o.userData.enemyId = e.id;
    if (type === "grunt" || type === "archer") o.castShadow = false;
  });
  scene.add(rig.group);
  enemies.push(e);
  fx.ring(e.pos, 0.75, type === "boss" ? 0xdf7951 : 0x9ab1a3, 0.8);
  return e;
}
function spawnWave(index) {
  wave = index;
  waveTimer = -1;
  const types =
    index === 1
      ? Array(8).fill("grunt").concat(["archer", "brute"])
      : index === 2
        ? Array(8).fill("grunt").concat(["brute", "brute", "archer", "archer"])
        : Array(8)
            .fill("grunt")
            .concat(["brute", "brute", "archer", "archer", "archer", "boss"]);
  types.forEach((type, i) => {
    const angle = (Math.PI * 2 * i) / types.length + Math.random() * 0.18;
    const radius = 9 + Math.random() * 3;
    spawnEnemy(
      type,
      hero.pos.x + Math.sin(angle) * radius,
      hero.pos.z + Math.cos(angle) * radius,
    );
  });
  if (index > 1) {
    hero.hp = Math.min(hero.maxHp, hero.hp + 25);
    hero.souls = Math.min(100, hero.souls + 40);
    ui.notify(index === 2 ? "第二阵 · 重甲压境" : "终阵 · 鬼将现身");
  }
}
function nearestEnemy(position = hero.pos, max = Infinity) {
  let best = null,
    distance = max;
  for (const e of enemies) {
    if (e.state === "dead" || e.state === "spawn") continue;
    const d = e.pos.distanceTo(position);
    if (d < distance) {
      distance = d;
      best = e;
    }
  }
  return best;
}
function beginAttack(enemy) {
  if (hero.mount > 0) return;
  hero.state = "attack";
  hero.elapsed = 0;
  hero.duration = attackDurations[hero.combo];
  hero.hitDone = false;
  hero.attackHits.clear();
  hero.impactDone = false;
  hero.globalImpactDone = false;
  hero.attackCarry = hero.destination
    ? Math.min(1, hero.moveVelocity.length() / 5.8)
    : 0;
  hero.attackTarget = enemy;
  if (!hero.destination) hero.target = enemy;
  destinationMarker.visible = !!hero.destination;
  safeAudio("slash", hero.combo);
}
function hurtEnemy(
  e,
  damage,
  from = hero.pos,
  force = 1,
  critical = false,
  skill = false,
  playerContact = false,
) {
  if (e.state === "dead" || e.state === "spawn") return false;
  e.hp = Math.max(0, e.hp - damage);
  e.flash = 1;
  temp.subVectors(e.pos, from);
  if (temp.lengthSq() < 0.01)
    temp.set(Math.sin(hero.angle), 0, Math.cos(hero.angle));
  temp.normalize();
  const hitDirection = temp.clone();
  e.hurtDirection = Math.sin(
    Math.atan2(hitDirection.x, hitDirection.z) - e.angle,
  );
  e.hurtStrength = critical ? 1 : 0.65;
  e.localHitStop = Math.max(e.localHitStop || 0, critical ? 0.038 : 0.027);
  e.velocity.addScaledVector(temp, force * (e.type === "boss" ? 0.4 : 1));
  showDamage(e, damage, critical ? "critical" : skill ? "skill" : "normal");
  if (fx.impact)
    fx.impact(
      e.pos
        .clone()
        .add(new THREE.Vector3(0, e.type === "boss" ? 1.3 : 1.05, 0)),
      hitDirection,
      critical ? 1.35 : 0.75,
      critical,
    );
  else fx.burst(e.pos, critical ? 1.2 : 0.55);
  combo++;
  comboTimeout = 3;
  hero.souls = Math.min(100, hero.souls + 2);
  if (playerContact || e.pos.distanceTo(hero.pos) < 6)
    kickCamera(hitDirection, critical ? 0.075 : 0.035);
  const isPlayerContact =
    playerContact &&
    ((hero.state === "attack" && !skill) ||
      (hero.state === "skill" && skill && hero.skillIndex !== 4));
  if (isPlayerContact && !hero.impactDone) {
    hero.impactDone = true;
    hero.localHitStop = critical ? 0.038 : 0.029;
  }
  if (
    playerContact &&
    hero.state === "attack" &&
    hero.combo === 3 &&
    !skill &&
    !hero.globalImpactDone
  ) {
    hero.globalImpactDone = true;
    hitStop = Math.max(hitStop, 0.025);
  }
  safeAudio("hit", critical ? 1.5 : 0.75, hero.combo);
  if (e.hp <= 0) {
    e.state = "dead";
    e.elapsed = 0;
    e.duration = 1.5;
    e.bar.visible = false;
    kills++;
    hero.souls = Math.min(100, hero.souls + 5);
    dropLoot(e.pos);
    e.deathDirection = hitDirection;
    e.deathImpactDone = false;
    safeAudio("kill");
    if (e.type === "boss") {
      slowTime = 0.24;
      slowScale = 0.5;
    }
    if (hero.target === e) hero.target = null;
    return true;
  }
  if (e.type === "boss") {
    // Ordinary blades preserve the general's wind-up. Finishers and skills
    // can break his stance, with a recovery window that prevents a stun loop.
    const heavyHit =
      skill || (critical && hero.state === "attack" && hero.combo === 3);
    if (!heavyHit || (e.poise || 0) > 0) return true;
    e.poise = 3.2;
  }
  e.state = "hurt";
  e.elapsed = 0;
  e.duration = e.type === "boss" ? 0.16 : 0.32;
  e.cooldown = Math.max(e.cooldown, 0.7);
  return true;
}
function attackHit(phase = attackContacts[hero.combo]) {
  const firstContact = !hero.hitDone;
  hero.hitDone = true;
  const c = hero.combo,
    r = attackRanges[c],
    forward = new THREE.Vector3(Math.sin(hero.angle), 0, Math.cos(hero.angle));
  const origin = hero.pos.clone();
  let count = 0;
  for (const e of enemies) {
    if (e.state === "dead" || e.state === "spawn" || hero.attackHits.has(e.id))
      continue;
    const delta = temp2.subVectors(e.pos, origin),
      d = delta.length();
    if (d > r + e.radius) continue;
    const dot = d < 0.01 ? 1 : delta.dot(forward) / d;
    if (c !== 3 && dot < (c === 2 ? 0.45 : -0.12)) continue;
    const crit = c === 3 || Math.random() < 0.12;
    hero.attackHits.add(e.id);
    hurtEnemy(
      e,
      Math.round(attackDamages[c] * (crit ? 1.5 : 1)),
      origin,
      c === 3 ? 5.8 : 2.8,
      crit,
      false,
      true,
    );
    count++;
  }
  if (firstContact) fx.arc(origin, hero.angle, r, c);
}
function damageHero(amount, from) {
  if (
    mode !== "playing" ||
    hero.hp <= 0 ||
    hero.state === "dead" ||
    hero.invulnerable > 0 ||
    hero.mount > 0 ||
    hero.flight > 0
  )
    return;
  hero.hp = Math.max(0, hero.hp - amount);
  hits++;
  hero.flash = 1;
  hero.invulnerable = 0.85;
  hero.state = "hurt";
  hero.elapsed = 0;
  hero.duration = 0.24;
  hero.destination = null;
  hero.combo = 0;
  temp.subVectors(hero.pos, from).normalize();
  hero.velocity.addScaledVector(temp, 5);
  hero.localHitStop = 0.04;
  hero.hurtDirection = Math.sin(Math.atan2(temp.x, temp.z) - hero.angle);
  hero.hurtStrength = 1;
  kickCamera(temp, 0.1);
  const p = worldToScreen(hero.pos.clone().add(new THREE.Vector3(0, 2.3, 0)));
  ui.damage(`−${amount}`, p.x, p.y, "hurt");
  fx.burst(hero.pos, 0.8, 0xc47753);
  safeAudio("enemy");
  if (hero.hp <= 0) {
    hero.state = "dead";
    hero.elapsed = 0;
    hero.duration = 1.1;
    hero.target = null;
    hero.destination = null;
  }
}

function commandTap(position, enemy = null) {
  if (mode !== "playing" || hero.hp <= 0) return;
  metrics.taps++;
  audio.unlock?.();
  const p = position.clone
    ? position.clone()
    : new THREE.Vector3(position.x, 0, position.z);
  clampPosition(p);
  hero.target = enemy && enemy.state !== "dead" ? enemy : null;
  hero.destination = hero.target ? null : p;
  hero.disengage = hero.target ? 0 : 0.12;
  if (
    hero.state === "attack" &&
    hero.hitDone &&
    hero.elapsed / hero.duration >= 0.66
  ) {
    hero.combo = (hero.combo + 1) % 4;
    hero.comboTimer = 0;
    hero.nextAttackIn = 0.12;
    locomotionState();
  }
  destinationMarker.visible = !hero.target;
  destinationMarker.position.set(p.x, 0.045, p.z);
  destinationMarker.scale.setScalar(1);
  if (hero.target) {
    targetMarker.visible = true;
    targetMarker.position.set(enemy.pos.x, 0.05, enemy.pos.z);
  } else targetMarker.visible = false;
}
function roll(direction) {
  if (
    mode !== "playing" ||
    hero.hp <= 0 ||
    hero.stamina < 23 ||
    hero.state === "roll"
  )
    return;
  if (hero.state === "skill" && hero.elapsed < hero.duration * 0.65) return;
  const d =
    direction?.clone() ||
    temp.set(Math.sin(hero.angle), 0, Math.cos(hero.angle)).clone();
  d.y = 0;
  if (d.lengthSq() < 0.01) d.set(Math.sin(hero.angle), 0, Math.cos(hero.angle));
  d.normalize();
  hero.stamina -= 23;
  metrics.rolls++;
  hero.state = "roll";
  hero.localHitStop = 0;
  hero.moveVelocity.set(0, 0, 0);
  hero.elapsed = 0;
  hero.duration = 0.43;
  hero.rollDirection.copy(d);
  face(d);
  hero.invulnerable = 0.48;
  hero.destination = null;
  hero.disengage = 0.65;
  hero.target = null;
  targetMarker.visible = false;
  hero.combo = 0;
  destinationMarker.visible = false;
  safeAudio("roll");
  fx.ring(hero.pos, 0.8, 0xcbb99a, 0.25);
}
function castSkill(index) {
  if (mode !== "playing" || hero.hp <= 0) return;
  const s = skills[index];
  if (!s) return;
  if (s.cooldown > 0) {
    ui.notify("招式尚未回气");
    return;
  }
  if (hero.souls < s.cost) {
    ui.notify("魂晶不足 · 斩敌与拾取可补充");
    return;
  }
  if (hero.state === "roll") return;
  audio.unlock?.();
  hero.souls -= s.cost;
  metrics.skills++;
  s.cooldown = s.maxCooldown;
  const target =
    hero.target && hero.target.state !== "dead"
      ? hero.target
      : nearestEnemy(hero.pos, 12);
  if (target) face(temp.subVectors(target.pos, hero.pos), 1);
  hero.state = "skill";
  hero.skillIndex = index;
  hero.elapsed = 0;
  hero.duration = [0.72, 0.85, 1.05, 0.85, 0.8][index];
  hero.skillHits.clear();
  hero.impactDone = false;
  hero.globalImpactDone = false;
  hero.localHitStop = 0;
  hero.hitDone = false;
  hero.destination = null;
  hero.invulnerable = index === 2 ? 0.88 : 0.38;
  hero.dashDirection.set(Math.sin(hero.angle), 0, Math.cos(hero.angle));
  destinationMarker.visible = false;
  safeAudio("skill", index);
  fx.ring(
    hero.pos,
    index === 3 ? 4.8 : 1.7,
    index === 3 ? 0xaacbe7 : 0xc5b9ee,
    0.4,
  );
}
function skillHit(radius, damage, force, full = true, once = true) {
  let did = false;
  for (const e of enemies) {
    if (
      e.state === "dead" ||
      e.state === "spawn" ||
      (once && hero.skillHits.has(e.id))
    )
      continue;
    const d = e.pos.distanceTo(hero.pos);
    if (d > radius + e.radius) continue;
    if (
      !full &&
      temp.subVectors(e.pos, hero.pos).normalize().dot(hero.dashDirection) < 0.2
    )
      continue;
    hero.skillHits.add(e.id);
    hurtEnemy(e, damage, hero.pos, force, true, true, true);
    did = true;
    if (
      hero.skillIndex === 3 &&
      e.state !== "dead" &&
      (e.type !== "boss" || e.state === "hurt")
    ) {
      e.state = "frozen";
      e.elapsed = 0;
      e.duration = 2.6;
      e.cooldown = 3;
    }
  }
  if (did && !hero.globalImpactDone) {
    hero.globalImpactDone = true;
    hitStop = Math.max(hitStop, 0.032);
  }
}
function updateHero(frameDt) {
  const frozen = Math.min(frameDt, hero.localHitStop);
  hero.localHitStop = Math.max(0, hero.localHitStop - frameDt);
  const dt = frameDt - frozen;
  const previousPosition = hero.pos.clone();
  const previousPhase = hero.duration ? hero.elapsed / hero.duration : 0;
  hero.elapsed += dt;
  hero.invulnerable = Math.max(0, hero.invulnerable - frameDt);
  hero.flash = Math.max(0, hero.flash - frameDt * 7);
  hero.rig.setFlash?.(hero.flash);
  hero.stamina = Math.min(100, hero.stamina + frameDt * 27);
  hero.souls = Math.min(100, hero.souls + frameDt * 1.4);
  hero.disengage = Math.max(0, hero.disengage - frameDt);
  hero.nextAttackIn = Math.max(0, hero.nextAttackIn - frameDt);
  hero.comboTimer += frameDt;
  if (hero.comboTimer > 1.8 && hero.state !== "attack") hero.combo = 0;
  hero.velocity.multiplyScalar(Math.exp(-dt * 10));
  hero.pos.addScaledVector(hero.velocity, dt);
  if (hero.target?.state === "dead") hero.target = null;
  const maxSpeed = hero.mount > 0 ? 12 : hero.flight > 0 ? 8.5 : 5.8;
  function navigate() {
    const goal = movementGoal();
    locomotion(
      dt,
      goal?.direction,
      goal?.distance ?? Infinity,
      maxSpeed,
      goal?.stoppingDistance || 0,
    );
    locomotionState();
  }
  if (hero.state === "roll") {
    const phase = Math.min(1, hero.elapsed / hero.duration);
    face(hero.rollDirection, 1 - Math.exp(-dt * 30));
    move(hero.pos, hero.rollDirection, 13 * (1 - phase * 0.45), dt);
    hero.ghostTimer -= dt;
    if (hero.ghostTimer <= 0 && dt > 0) {
      fx.ghost(hero.rig);
      hero.ghostTimer = 0.09;
    }
    if (phase >= 1) {
      hero.moveVelocity.copy(hero.rollDirection).multiplyScalar(2.5);
      locomotionState();
    }
  } else if (hero.state === "attack") {
    const phase = hero.elapsed / hero.duration;
    const travelling = !!hero.destination || keyboardDirection().lengthSq() > 0;
    if (travelling) {
      const goal = movementGoal();
      const carry = phase < 0.35 ? 0.75 : phase < 0.66 ? 0.43 : 1;
      locomotion(
        dt,
        goal?.direction,
        goal?.distance ?? Infinity,
        maxSpeed * carry,
        0,
      );
      hero.attackCarry = THREE.MathUtils.clamp(
        hero.moveVelocity.length() / maxSpeed,
        0,
        1,
      );
    } else if (
      hero.attackTarget &&
      hero.attackTarget.state !== "dead" &&
      phase < 0.56
    ) {
      const direction = hero.attackTarget.pos.clone().sub(hero.pos),
        distance = direction.length();
      locomotion(
        dt,
        direction.normalize(),
        distance,
        3.6,
        1.35 + hero.attackTarget.radius * 0.35,
      );
      hero.attackCarry = 0;
    } else locomotion(dt, null);
    const window = attackWindows[hero.combo];
    if (
      dt > 0 &&
      phase >= attackContacts[hero.combo] &&
      previousPhase < window[1]
    )
      attackHit(Math.min(phase, window[1]));
    if (travelling && hero.hitDone && phase >= 0.66) {
      hero.combo = (hero.combo + 1) % 4;
      hero.comboTimer = 0;
      hero.nextAttackIn = 0.12;
      locomotionState();
    } else if (phase >= (hero.combo === 3 ? 0.96 : 0.9)) {
      hero.combo = (hero.combo + 1) % 4;
      hero.comboTimer = 0;
      const next =
        hero.target || nearestEnemy(hero.pos, attackRanges[hero.combo] + 1);
      if (
        next &&
        hero.pos.distanceTo(next.pos) <
          attackRanges[hero.combo] + next.radius + 0.35 &&
        hero.mount <= 0 &&
        !(hero.flight > 0)
      )
        beginAttack(next);
      else navigate();
    }
  } else if (hero.state === "skill") {
    const phase = hero.elapsed / hero.duration,
      index = hero.skillIndex;
    hero.ghostTimer -= dt;
    if ((index === 0 || index === 1) && hero.ghostTimer <= 0) {
      fx.ghost(hero.rig);
      hero.ghostTimer = 0.1;
    }
    if (index === 0 && phase > 0.22 && phase < 0.73) {
      if (!hero.hitDone) {
        hero.hitDone = true;
        safeAudio("skillImpact", index);
      }
      move(hero.pos, hero.dashDirection, 17, dt);
      skillHit(2.3, 58, 6, false);
    }
    if (index === 1 && phase > 0.22 && phase < 0.85) {
      if (!hero.hitDone) {
        fx.arc(hero.pos, hero.angle, 3.8, 3, 0xe1c0ff);
        hero.hitDone = true;
        safeAudio("skillImpact", index);
        skillHit(3.8, 75, 7);
      }
      hero.angle += dt * 15;
    }
    if (index === 2 && phase < 0.52)
      move(hero.pos, hero.dashDirection, 6.5, dt);
    if (index === 2 && phase >= 0.72 && !hero.hitDone) {
      hero.hitDone = true;
      safeAudio("skillImpact", index);
      skillHit(4.5, 100, 9);
      fx.ring(hero.pos, 4.5, 0xebd9ae, 0.55);
      fx.burst(hero.pos, 2);
      kickCamera(hero.dashDirection, 0.15);
      if (!hero.globalImpactDone) {
        hero.globalImpactDone = true;
        hitStop = Math.max(hitStop, 0.04);
      }
    }
    if (index === 3 && phase >= 0.4 && !hero.hitDone) {
      hero.hitDone = true;
      safeAudio("skillImpact", index);
      skillHit(5, 52, 2);
      fx.ring(hero.pos, 5, 0xb3cddd, 1.1);
      fx.arc(hero.pos, hero.angle, 4.8, 3, 0xb2d7f2);
    }
    if (index === 4 && phase >= 0.4 && !hero.hitDone) {
      hero.hitDone = true;
      safeAudio("skillImpact", index);
      for (let i = -2; i <= 2; i++)
        spawnProjectile(
          hero.pos.clone().add(new THREE.Vector3(0, 1, 0)),
          new THREE.Vector3(
            Math.sin(hero.angle + i * 0.2),
            0,
            Math.cos(hero.angle + i * 0.2),
          ),
          18,
          true,
          60,
          0xc6c5ed,
          2.6,
        );
      fx.arc(hero.pos, hero.angle, 2.6, 1);
    }
    hero.moveVelocity.multiplyScalar(Math.exp(-dt * 25));
    if (phase >= 1) locomotionState();
  } else if (hero.state === "hurt" || hero.state === "dead") {
    hero.moveVelocity.multiplyScalar(Math.exp(-dt * 28));
    if (hero.state === "hurt" && hero.elapsed >= hero.duration) navigate();
    if (hero.state === "dead" && hero.elapsed >= hero.duration)
      finishGame(false);
  } else {
    const enemy = hero.target || nearestEnemy(hero.pos, 2.8);
    if (
      enemy &&
      hero.pos.distanceTo(enemy.pos) <
        attackRanges[hero.combo] + enemy.radius - 0.12 &&
      hero.disengage <= 0 &&
      hero.nextAttackIn <= 0 &&
      hero.mount <= 0 &&
      !(hero.flight > 0)
    ) {
      beginAttack(enemy);
    } else navigate();
  }
  if (hero.mount > 0) {
    hero.mount -= dt;
    for (const e of enemies) {
      if (
        e.state !== "dead" &&
        e.pos.distanceTo(hero.pos) < 1.8 + e.radius &&
        (hero.mountHits.get(e.id) || 0) < gameTime
      ) {
        hero.mountHits.set(e.id, gameTime + 0.45);
        hurtEnemy(e, 48, hero.pos, 8, true, true);
        fx.arc(hero.pos, hero.angle, 2.3, 0, 0xe4cf9b);
      }
    }
    if (horseMesh) {
      horseMesh.position.copy(hero.pos);
      horseMesh.rotation.y = hero.angle;
      horseMesh.children.forEach((p, i) => {
        if (p.userData.leg)
          p.rotation.x = Math.sin(hero.gaitPhase * 1.25 + i) * 0.55;
      });
    }
    if (hero.mount <= 0) {
      disposeGroup(horseMesh);
      horseMesh = null;
      ui.notify("战马已退 · 继续双刃作战");
    }
  }
  clampPosition(hero.pos);
  const moved = hero.pos.distanceTo(previousPosition);
  const locomoting =
    hero.state === "run" ||
    hero.state === "idle" ||
    (hero.state === "attack" && hero.attackCarry > 0.05);
  const previousFoot = Math.floor(hero.gaitPhase / Math.PI);
  if (locomoting)
    hero.gaitPhase +=
      (moved * Math.PI * 2) /
      THREE.MathUtils.lerp(
        0.85,
        2.9,
        THREE.MathUtils.clamp(hero.moveVelocity.length() / maxSpeed, 0, 1),
      );
  if (
    locomoting &&
    Math.floor(hero.gaitPhase / Math.PI) !== previousFoot &&
    moved > 0.001
  )
    safeAudio("footstep", hero.mount > 0 ? 1.4 : 0.6);
  hero.actualSpeed = dt > 0 ? moved / dt : 0;
  const targetBlend = THREE.MathUtils.clamp(
    hero.moveVelocity.length() / maxSpeed,
    0,
    1,
  );
  hero.moveBlend = THREE.MathUtils.lerp(
    hero.moveBlend,
    targetBlend,
    1 - Math.exp(-frameDt * 20),
  );
  hero.rig.group.position.copy(hero.pos);
  hero.rig.group.position.y = hero.mount > 0 ? 1 : 0;
  hero.rig.group.rotation.y = hero.angle;
  const phase = hero.duration ? Math.min(1, hero.elapsed / hero.duration) : 0;
  const poseState = hero.mount > 0 ? "charge" : hero.state;
  const switched =
    hero.poseState !== poseState ||
    (poseState === "attack" && hero.poseCombo !== hero.combo);
  if (switched) {
    hero.transition = {
      from: hero.poseState,
      to: poseState,
      age: 0,
      duration: 0.08,
    };
    hero.poseState = poseState;
    hero.poseCombo = hero.combo;
  } else hero.transition.age = Math.min(1, hero.transition.age + dt);
  poseCharacter(hero.rig, {
    state: poseState,
    time: globalTime,
    dt,
    phase,
    combo: hero.combo,
    speed: targetBlend,
    moveBlend: hero.moveBlend,
    gaitPhase: hero.gaitPhase,
    turnLean: hero.turnLean,
    attackCarry: hero.attackCarry,
    hurtDirection: hero.hurtDirection || 0,
    hurtStrength: hero.hurtStrength || 0,
    skill: hero.skillIndex,
  });
  hero.rig.group.updateMatrixWorld(true);
  const tips = hero.rig.weaponTips();
  const active =
    !switched &&
    dt > 0 &&
    ((hero.state === "attack" &&
      phase >= attackWindows[hero.combo][0] &&
      phase <= attackWindows[hero.combo][1]) ||
      (hero.state === "skill" && phase > 0.25 && phase < 0.8));
  for (let i = 0; i < 2; i++)
    fx.sample(trails[i], tips[i], hero.pos, active, frameDt);
}
function beginEnemyAttack(e) {
  e.state = "attack";
  e.elapsed = 0;
  e.hitDone = false;
  e.targetPos.copy(hero.pos);
  e.angle = Math.atan2(hero.pos.x - e.pos.x, hero.pos.z - e.pos.z);
  e.duration =
    e.type === "brute"
      ? 1.15
      : e.type === "boss"
        ? 1.45
        : e.type === "archer"
          ? 1.05
          : 0.82;
  e.attackKind = e.type === "boss" ? e.combo++ % 3 : 0;
  if (e.type === "archer") {
    fx.ring(e.pos, 0.65, 0xcf9263, e.duration);
  } else if (e.type === "boss" && e.attackKind === 1) {
    e.dashDirection = temp.subVectors(hero.pos, e.pos).normalize().clone();
    for (let i = 0; i < 4; i++)
      fx.warning(
        e.pos.clone().addScaledVector(e.dashDirection, 1.7 + i * 1.6),
        1.25,
        e.duration * 0.58,
      );
  } else {
    const p =
      e.type === "grunt"
        ? e.pos
            .clone()
            .add(
              new THREE.Vector3(
                Math.sin(e.angle) * 0.6,
                0,
                Math.cos(e.angle) * 0.6,
              ),
            )
        : e.pos;
    fx.warning(
      p,
      e.type === "boss" ? 4 : e.type === "brute" ? 3 : 1.8,
      e.duration * 0.6,
    );
  }
}
function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const frozen = Math.min(dt, e.localHitStop || 0);
    e.localHitStop = Math.max(0, (e.localHitStop || 0) - dt);
    const tickDt = dt - frozen;
    e.elapsed += tickDt;
    e.cooldown -= tickDt;
    e.poise = Math.max(0, (e.poise || 0) - tickDt);
    e.flash = Math.max(0, e.flash - dt * 7);
    e.rig.setFlash?.(e.flash);
    e.velocity.multiplyScalar(Math.exp(-tickDt * 7));
    e.pos.addScaledVector(e.velocity, tickDt);
    if (e.state === "dead") {
      e.rig.group.position.x = e.pos.x;
      e.rig.group.position.z = e.pos.z;
      e.deathAge += tickDt;
      if (e.deathAge >= 0.5 && !e.deathImpactDone) {
        e.deathImpactDone = true;
        fx.death?.(e.pos, e.deathDirection, e.type === "boss" ? 1.5 : 0.8);
      }
      e.bar.visible = false;
      e.pos.addScaledVector(e.velocity, tickDt);
      if (e.deathAge > 0.9)
        e.rig.group.position.y = -Math.min(2, (e.deathAge - 0.9) * 2);
      if (e.deathAge > 1.85) {
        disposeGroup(e.rig.group, false);
        disposeGroup(e.bar);
        enemies.splice(i, 1);
        continue;
      }
    } else if (e.state === "spawn") {
      if (e.elapsed >= e.duration) {
        e.state = "idle";
        e.elapsed = 0;
      }
    } else if (e.state === "hurt" || e.state === "frozen") {
      if (e.elapsed >= e.duration) {
        e.state = "idle";
        e.elapsed = 0;
      }
    } else if (e.state === "attack") {
      const phase = e.elapsed / e.duration;
      if (
        e.type === "boss" &&
        e.attackKind === 1 &&
        phase > 0.58 &&
        phase < 0.85
      ) {
        move(e.pos, e.dashDirection, 12, tickDt, e.radius);
        if (e.pos.distanceTo(hero.pos) < 2.1) damageHero(e.damage, e.pos);
      }
      if (!e.hitDone && phase > 0.58) {
        e.hitDone = true;
        if (e.type === "archer") {
          const start = e.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
          const dir = temp
            .subVectors(
              hero.pos.clone().add(new THREE.Vector3(0, 0.85, 0)),
              start,
            )
            .normalize()
            .clone();
          spawnProjectile(start, dir, 11, false, e.damage, 0xeab875, 2.2);
        } else if (e.type === "boss" && e.attackKind === 2) {
          for (let j = -2; j <= 2; j++) {
            spawnProjectile(
              e.pos.clone().add(new THREE.Vector3(0, 1.0, 0)),
              new THREE.Vector3(
                Math.sin(e.angle + j * 0.28),
                0,
                Math.cos(e.angle + j * 0.28),
              ),
              9,
              false,
              12,
              0xc88550,
              2.5,
            );
          }
          fx.ring(e.pos, 3.8, 0xb76143, 0.55);
        } else if (e.type !== "boss" || e.attackKind === 0) {
          const radius = e.type === "boss" ? 4 : e.type === "brute" ? 3 : 2.15;
          const delta = temp.subVectors(hero.pos, e.pos);
          const inFront =
            e.type !== "grunt" ||
            delta
              .normalize()
              .dot(temp2.set(Math.sin(e.angle), 0, Math.cos(e.angle))) > -0.12;
          if (e.pos.distanceTo(hero.pos) < radius && inFront)
            damageHero(e.damage, e.pos);
          fx.ring(
            e.pos,
            radius,
            e.type === "grunt" ? 0xc59979 : 0xc8784b,
            0.35,
          );
          if (e.type !== "grunt") fx.burst(e.pos, 1.2, 0xc4a788);
        }
      }
      if (phase >= 1) {
        e.state = "recover";
        e.elapsed = 0;
        e.duration =
          e.type === "boss" ? 0.85 : e.type === "brute" ? 0.65 : 0.45;
        e.cooldown =
          e.type === "boss"
            ? 1.3
            : e.type === "archer"
              ? 1.8
              : 1.3 + Math.random() * 0.7;
      }
    } else if (e.state === "recover") {
      if (e.elapsed > e.duration) {
        e.state = "idle";
        e.elapsed = 0;
      }
    } else {
      const direction = temp.subVectors(hero.pos, e.pos),
        distance = direction.length();
      e.angle +=
        Math.atan2(
          Math.sin(Math.atan2(direction.x, direction.z) - e.angle),
          Math.cos(Math.atan2(direction.x, direction.z) - e.angle),
        ) * Math.min(1, tickDt * 8);
      if (e.type === "archer" && distance < 5) {
        move(e.pos, direction.normalize(), -e.speed, tickDt, e.radius);
        e.state = "run";
      } else if (distance > e.range) {
        move(e.pos, direction.normalize(), e.speed, tickDt, e.radius);
        e.state = "run";
      } else {
        e.state = "idle";
        if (e.cooldown <= 0) beginEnemyAttack(e);
      }
    }
    if (e.state !== "dead") {
      clampPosition(e.pos, e.radius);
      for (const other of enemies) {
        if (other === e || other.state === "dead" || other.id < e.id) continue;
        const dx = e.pos.x - other.pos.x,
          dz = e.pos.z - other.pos.z,
          d = Math.hypot(dx, dz),
          r = (e.radius + other.radius) * 0.9;
        if (d < r && d > 0.01) {
          const push = (r - d) * 0.5;
          e.pos.x += (dx / d) * push;
          e.pos.z += (dz / d) * push;
          other.pos.x -= (dx / d) * push;
          other.pos.z -= (dz / d) * push;
        }
      }
      e.rig.group.position.copy(e.pos);
    }
    e.rig.group.rotation.y = e.angle;
    poseCharacter(e.rig, {
      state:
        e.state === "frozen"
          ? "hurt"
          : e.state === "spawn" || e.state === "recover"
            ? "idle"
            : e.state,
      time: globalTime,
      phase: e.duration ? Math.min(1, e.elapsed / e.duration) : 0,
      combo: e.combo % 4,
      speed: e.state === "run" ? 0.6 : 0,
      skill: e.attackKind,
      dt: tickDt,
      gaitPhase: (e.gaitPhase =
        (e.gaitPhase || 0) +
        (e.state === "run" ? tickDt * e.speed * Math.PI * 2 : 0)),
      moveBlend: e.state === "run" ? 0.65 : 0,
      hurtDirection: e.hurtDirection || 0,
      hurtStrength: e.hurtStrength || 0,
    });
    e.bar.visible =
      e.state !== "dead" &&
      (e.hp < e.maxHp || e.type === "boss" || e === hero.target);
    e.bar.position.set(
      e.pos.x,
      e.type === "boss" ? 3.6 : e.type === "brute" ? 2.85 : 2.25,
      e.pos.z,
    );
    e.bar.quaternion.copy(camera.quaternion);
    const fill = e.bar.userData.fill;
    fill.scale.x = e.hp / e.maxHp;
    fill.position.x = -(1 - e.hp / e.maxHp) * e.bar.userData.width * 0.5;
  }
  if (enemies.filter((e) => e.state !== "dead").length === 0 && waveTimer < 0) {
    if (wave === 3) {
      if (hero.hp > 0) finishGame(true);
    } else {
      waveTimer = 2.4;
      ui.notify("尸潮暂歇 · 生命与魂晶恢复");
    }
  }
  if (waveTimer > 0) {
    waveTimer -= dt;
    if (waveTimer <= 0) spawnWave(wave + 1);
  }
}

const arrowGeometry = new THREE.ConeGeometry(0.07, 0.7, 5);
arrowGeometry.rotateX(Math.PI / 2);
function spawnProjectile(
  position,
  direction,
  speed,
  friendly,
  damage,
  color = 0xe1b975,
  duration = 2,
) {
  const mesh = new THREE.Mesh(
    arrowGeometry,
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.copy(position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(mesh);
  projectiles.push({
    mesh,
    direction: direction.clone(),
    speed,
    friendly,
    damage,
    life: duration,
    hit: new Set(),
  });
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.direction, p.speed * dt);
    if (p.friendly) {
      for (const e of enemies) {
        if (e.state === "dead" || e.state === "spawn" || p.hit.has(e.id))
          continue;
        const d = Math.hypot(
          p.mesh.position.x - e.pos.x,
          p.mesh.position.z - e.pos.z,
        );
        if (d < e.radius + 0.45) {
          p.hit.add(e.id);
          hurtEnemy(e, p.damage, p.mesh.position, 3, false, true);
          if (p.hit.size >= 3) p.life = 0;
        }
      }
    } else if (
      Math.hypot(
        p.mesh.position.x - hero.pos.x,
        p.mesh.position.z - hero.pos.z,
      ) < 0.65
    ) {
      damageHero(p.damage, p.mesh.position);
      p.life = 0;
    }
    if (
      p.life <= 0 ||
      Math.abs(p.mesh.position.x) > 20 ||
      Math.abs(p.mesh.position.z) > 18
    ) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      projectiles.splice(i, 1);
    }
  }
}
const coinGeometry = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 8);
coinGeometry.rotateX(Math.PI / 2);
const soulGeometry = new THREE.OctahedronGeometry(0.13);
const healGeometry = new THREE.IcosahedronGeometry(0.15, 0);
function dropLoot(position) {
  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const kind =
      Math.random() < 0.14 ? "heal" : Math.random() < 0.55 ? "soul" : "gold";
    const mesh = new THREE.Mesh(
      kind === "heal"
        ? healGeometry
        : kind === "soul"
          ? soulGeometry
          : coinGeometry,
      new THREE.MeshStandardMaterial({
        color:
          kind === "heal" ? 0xd69078 : kind === "soul" ? 0xb19bbb : 0xe8bb5d,
        emissive:
          kind === "heal" ? 0x391813 : kind === "soul" ? 0x342d41 : 0x493319,
        emissiveIntensity: 0.6,
        metalness: 0.6,
        roughness: 0.4,
      }),
    );
    mesh.position.copy(position);
    mesh.position.x += (Math.random() - 0.5) * 0.9;
    mesh.position.z += (Math.random() - 0.5) * 0.9;
    mesh.position.y = 0.2;
    scene.add(mesh);
    drops.push({ mesh, kind, age: 0 });
  }
}
function updateDrops(dt) {
  if (hero.hp <= 0) return;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    d.mesh.rotation.y += dt * 2;
    d.mesh.position.y = 0.22 + Math.sin(d.age * 4) * 0.07;
    const distance = Math.hypot(
      d.mesh.position.x - hero.pos.x,
      d.mesh.position.z - hero.pos.z,
    );
    if (distance < 3.4 && d.age > 0.28) {
      temp.subVectors(hero.pos, d.mesh.position).normalize();
      d.mesh.position.addScaledVector(temp, (7 + (3.4 - distance) * 3) * dt);
    }
    if (distance < 0.6) {
      hero.souls = Math.min(100, hero.souls + (d.kind === "soul" ? 8 : 3));
      if (d.kind === "heal") {
        hero.hp = Math.min(hero.maxHp, hero.hp + 15);
        const p = worldToScreen(
          hero.pos.clone().add(new THREE.Vector3(0, 2.2, 0)),
        );
        ui.damage("+15", p.x, p.y, "heal");
      }
      scene.remove(d.mesh);
      d.mesh.material.dispose();
      drops.splice(i, 1);
    } else if (d.age > 35) {
      scene.remove(d.mesh);
      d.mesh.material.dispose();
      drops.splice(i, 1);
    }
  }
}
let horseMesh = null,
  eagleMesh = null;
function simpleMesh(geometry, color) {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.12,
      flatShading: true,
    }),
  );
}
function makeHorse() {
  const g = new THREE.Group();
  const body = simpleMesh(new THREE.BoxGeometry(0.7, 0.75, 1.7), 0x393229);
  body.position.y = 0.95;
  g.add(body);
  const neck = simpleMesh(new THREE.BoxGeometry(0.42, 0.8, 0.5), 0x4b3c2b);
  neck.position.set(0, 1.4, 0.55);
  neck.rotation.x = -0.3;
  g.add(neck);
  const head = simpleMesh(new THREE.BoxGeometry(0.4, 0.4, 0.75), 0x4b3c2b);
  head.position.set(0, 1.8, 0.85);
  g.add(head);
  const saddle = simpleMesh(new THREE.BoxGeometry(0.72, 0.16, 0.55), 0x8a2c29);
  saddle.position.y = 1.4;
  g.add(saddle);
  for (const x of [-0.25, 0.25])
    for (const z of [-0.55, 0.6]) {
      const leg = simpleMesh(new THREE.BoxGeometry(0.18, 0.85, 0.18), 0x302d25);
      leg.position.set(x, 0.43, z);
      leg.userData.leg = true;
      g.add(leg);
    }
  const shaft = simpleMesh(
    new THREE.CylinderGeometry(0.045, 0.045, 3.5, 6),
    0x9c7851,
  );
  shaft.rotation.x = Math.PI / 2 - 0.25;
  shaft.position.set(0.65, 1.65, 1.1);
  g.add(shaft);
  const blade = simpleMesh(new THREE.ConeGeometry(0.15, 0.72, 4), 0xc6cfcd);
  blade.rotation.x = Math.PI / 2 - 0.25;
  blade.position.set(0.65, 2.1, 2.9);
  g.add(blade);
  return g;
}
function makeEagle() {
  const g = new THREE.Group();
  const body = simpleMesh(new THREE.ConeGeometry(0.4, 1.3, 5), 0x64543c);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const head = simpleMesh(new THREE.IcosahedronGeometry(0.27, 0), 0xc6bca0);
  head.position.set(0, 0.18, 0.65);
  g.add(head);
  for (const side of [-1, 1]) {
    const wing = simpleMesh(new THREE.BoxGeometry(1.7, 0.09, 0.6), 0x514937);
    wing.position.set(side * 0.95, 0, -0.15);
    wing.userData.wing = side;
    g.add(wing);
    const feather = simpleMesh(new THREE.ConeGeometry(0.3, 1.2, 3), 0x413f32);
    feather.rotation.z = (side * Math.PI) / 2;
    feather.position.set(side * 1.7, 0, -0.3);
    g.add(feather);
  }
  const bow = simpleMesh(new THREE.BoxGeometry(1.05, 0.07, 0.12), 0xac9970);
  bow.position.set(0, 0.75, 0.7);
  g.add(bow);
  return g;
}
function useSpecial(kind) {
  if (mode !== "playing" || hero.hp <= 0 || !specials[kind]) return;
  metrics.specials++;
  specials[kind] = false;
  hero.state = "idle";
  hero.elapsed = 0;
  hero.invulnerable = 0.5;
  safeAudio("skill", 1);
  if (kind === "horse") {
    if (eagleMesh) {
      disposeGroup(eagleMesh);
      eagleMesh = null;
      hero.flight = 0;
    }
    hero.mount = 8;
    hero.mountHits = new Map();
    horseMesh = makeHorse();
    scene.add(horseMesh);
    ui.notify("借马 · 八秒骑戟冲阵");
  } else if (kind === "eagle") {
    if (horseMesh) {
      disposeGroup(horseMesh);
      horseMesh = null;
      hero.mount = 0;
    }
    hero.flight = 9;
    hero.flightFire = 0;
    eagleMesh = makeEagle();
    scene.add(eagleMesh);
    ui.notify("乘鹰 · 九秒空中连弩");
  } else if (kind === "captain") {
    const rig = createCharacter("hero");
    rig.group.scale.multiplyScalar(0.9);
    rig.group.traverse((o) => {
      if (o.isMesh && o.material?.color) {
        o.material = o.material.clone();
        o.material.color.lerp(new THREE.Color(0xc6ac62), 0.25);
      }
    });
    scene.add(rig.group);
    companions.push({
      rig,
      pos: hero.pos.clone().add(new THREE.Vector3(-1, 0, 0)),
      state: "run",
      elapsed: 0,
      duration: 15,
      cooldown: 0,
      attackTime: 0,
      angle: hero.angle,
      hitDone: false,
    });
    ui.notify("副将 · 十五秒并肩斩敌");
  }
  fx.ring(hero.pos, 2.2, 0xe2c68c, 0.55);
}
function updateCompanions(dt) {
  if (hero.flight > 0) {
    hero.flight -= dt;
    hero.flightFire -= dt;
    hero.rig.group.position.y = 2.3 + Math.sin(globalTime * 3) * 0.12;
    if (eagleMesh) {
      eagleMesh.position.copy(hero.pos);
      eagleMesh.position.y = 2.45;
      eagleMesh.rotation.y = hero.angle;
      eagleMesh.children.forEach((c) => {
        if (c.userData.wing)
          c.rotation.z = Math.sin(globalTime * 6) * 0.25 * c.userData.wing;
      });
    }
    if (hero.flightFire <= 0) {
      const target = nearestEnemy(hero.pos, 15);
      if (target) {
        const from = hero.pos.clone().add(new THREE.Vector3(0, 2.8, 0)),
          to = target.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
        spawnProjectile(
          from,
          to.sub(from).normalize(),
          19,
          true,
          28,
          0xe3cc95,
          1.6,
        );
        hero.flightFire = 0.32;
        safeAudio("slash", 2);
      }
    }
    if (hero.flight <= 0) {
      disposeGroup(eagleMesh);
      eagleMesh = null;
      ui.notify("鹰已退 · 落地继续作战");
    }
  }
  for (let i = companions.length - 1; i >= 0; i--) {
    const c = companions[i];
    const companionPrevious = c.pos.clone();
    c.elapsed += dt;
    c.cooldown -= dt;
    if (c.elapsed > c.duration) {
      disposeGroup(c.rig.group, false);
      companions.splice(i, 1);
      continue;
    }
    const target = nearestEnemy(c.pos, 12);
    if (c.state === "attack") {
      c.attackTime += dt;
      if (c.attackTime > 0.18 && !c.hitDone) {
        c.hitDone = true;
        if (target && target.pos.distanceTo(c.pos) < 2.4) {
          hurtEnemy(target, 24, c.pos, 3);
          fx.arc(c.pos, c.angle, 2, 0, 0xe3c991);
        }
      }
      if (c.attackTime > 0.43) {
        c.state = "idle";
        c.cooldown = 0.4;
      }
    } else if (target) {
      temp.subVectors(target.pos, c.pos);
      c.angle = Math.atan2(temp.x, temp.z);
      if (temp.length() > 1.8) {
        move(c.pos, temp.normalize(), 7, dt);
        c.state = "run";
      } else if (c.cooldown <= 0) {
        c.state = "attack";
        c.attackTime = 0;
        c.hitDone = false;
      }
    } else {
      temp.subVectors(hero.pos, c.pos);
      if (temp.length() > 2) {
        move(c.pos, temp.normalize(), 6, dt);
        c.state = "run";
      } else c.state = "idle";
    }
    c.rig.group.position.copy(c.pos);
    c.rig.group.rotation.y = c.angle;
    poseCharacter(c.rig, {
      state: c.state,
      time: globalTime,
      phase: c.state === "attack" ? c.attackTime / 0.43 : 0,
      combo: 0,
      speed: c.state === "run" ? 1 : 0,
      moveBlend: c.state === "run" ? 1 : 0,
      gaitPhase: (c.gaitPhase =
        (c.gaitPhase || 0) +
        (c.pos.distanceTo(companionPrevious) * Math.PI * 2) / 2.9),
      dt,
      skill: 0,
    });
  }
}
let pointerStart = null,
  lastTap = null;
function pointFromEvent(event) {
  pointer.set(
    (event.clientX / innerWidth) * 2 - 1,
    (-event.clientY / innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(ground, point) ? point : null;
}
function targetFromEvent(event) {
  pointer.set(
    (event.clientX / innerWidth) * 2 - 1,
    (-event.clientY / innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const result = raycaster.intersectObjects(
    enemies.filter((e) => e.state !== "dead").map((e) => e.rig.group),
    true,
  );
  if (result.length) {
    const id = result[0].object.userData.enemyId;
    return enemies.find((e) => e.id === id) || null;
  }
  let nearest = null,
    best = event.pointerType === "touch" ? 34 : 23;
  for (const e of enemies) {
    if (e.state === "dead") continue;
    const p = worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 0.85, 0)));
    const d = Math.hypot(p.x - event.clientX, p.y - event.clientY);
    if (d < best) {
      nearest = e;
      best = d;
    }
  }
  return nearest;
}
canvas.addEventListener("pointerdown", (event) => {
  if (event.button && event.button !== 0) return;
  audio.unlock?.();
  pointerStart = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    id: event.pointerId,
    dragged: false,
  };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (
    !pointerStart ||
    event.pointerId !== pointerStart.id ||
    mode !== "playing"
  )
    return;
  if (
    Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >
    18
  )
    pointerStart.dragged = true;
  if (pointerStart.dragged) {
    const p = pointFromEvent(event);
    if (p) commandTap(p);
  }
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const drag = pointerStart.dragged;
  pointerStart = null;
  if (mode !== "playing" || drag) return;
  const p = pointFromEvent(event);
  if (!p) return;
  const now = event.timeStamp;
  if (
    lastTap &&
    now - lastTap.time < 310 &&
    Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 75
  ) {
    roll(p.clone().sub(hero.pos));
    lastTap = null;
  } else {
    commandTap(p, targetFromEvent(event));
    lastTap = { time: now, x: event.clientX, y: event.clientY };
  }
});
// Native mouse double-click recognition also survives a delayed render thread.
canvas.addEventListener("dblclick", (event) => {
  const point = pointFromEvent(event);
  if (point) roll(point.sub(hero.pos));
  lastTap = null;
  event.preventDefault();
});
canvas.addEventListener("pointercancel", () => (pointerStart = null));
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
    event.preventDefault();
  if (event.repeat) return;
  keys.add(key);
  if (key === "escape" || key === "p") {
    if (mode === "playing") pauseGame();
    else if (mode === "pause") resumeGame();
  }
  if (mode === "playing") {
    if (key === " ") {
      const keyboard = keyboardDirection();
      const direction = hero.destination
        ? hero.destination.clone().sub(hero.pos)
        : keyboard.lengthSq() > 0
          ? keyboard
          : hero.target
            ? hero.target.pos.clone().sub(hero.pos)
            : hero.moveVelocity.lengthSq() > 0.1
              ? hero.moveVelocity.clone()
              : new THREE.Vector3(
                  Math.sin(hero.angle),
                  0,
                  Math.cos(hero.angle),
                );
      roll(direction);
    }
    if ("12345".includes(key)) castSkill(Number(key) - 1);
    if (key === "q") useSpecial("horse");
    if (key === "e") useSpecial("eagle");
    if (key === "r") useSpecial("captain");
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);
window.addEventListener("blur", () => {
  keys.clear();
  pointerStart = null;
  if (mode === "playing") pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "playing") pauseGame();
});
window.addEventListener("resize", () => {
  resizeCamera();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
});
function updateCamera(dt) {
  const b = world.bounds;
  const desired = hero.pos.clone().addScaledVector(cameraBack, -0.8);
  desired.x = THREE.MathUtils.clamp(desired.x, b.minX + 2, b.maxX - 2);
  desired.z = THREE.MathUtils.clamp(desired.z, b.minZ + 2, b.maxZ - 2);
  desired.y = 0.15;
  cameraFocus.lerp(desired, 1 - Math.exp(-dt * 7));
  shakeAge += dt;
  const amplitude = shake * Math.exp(-shakeAge * 19) * Math.sin(shakeAge * 58);
  const offset = shakeDirection.clone().multiplyScalar(amplitude);
  camera.position.copy(cameraFocus).add(cameraOffset).add(offset);
  camera.lookAt(cameraFocus.clone().add(offset));
  if (shakeAge > 0.3) shake = 0;
  camera.updateMatrixWorld(true);
}
let lastTime = performance.now(),
  uiClock = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const realDt = Math.min(0.25, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  globalTime += realDt;
  updateCamera(realDt);
  let dt = realDt;
  if (slowTime > 0) {
    slowTime -= realDt;
    dt *= slowScale;
  }
  if (hitStop > 0) {
    const frozen = Math.min(dt, hitStop);
    hitStop = Math.max(0, hitStop - realDt);
    dt = Math.max(0, dt - frozen);
  }
  if (mode === "playing") {
    gameTime += realDt;
    for (const s of skills) s.cooldown = Math.max(0, s.cooldown - dt);
    if (comboTimeout > 0) comboTimeout -= dt;
    else combo = 0;
    if (dt > 0) {
      // Keep collision and strike windows stable when a slow frame arrives.
      const steps = Math.ceil(dt / 0.03),
        step = dt / steps;
      for (let i = 0; i < steps && mode === "playing"; i++) {
        updateHero(step);
        updateEnemies(step);
        updateProjectiles(step);
        updateDrops(step);
        updateCompanions(step);
        fx.update(step);
      }
    }
    targetMarker.visible = !!hero.target && hero.target.state !== "dead";
    if (targetMarker.visible) {
      targetMarker.position.set(hero.target.pos.x, 0.05, hero.target.pos.z);
      targetMarker.scale.setScalar(
        hero.target.type === "boss"
          ? 1.65
          : 1 + Math.sin(globalTime * 5) * 0.03,
      );
    }
    if (destinationMarker.visible)
      destinationMarker.scale.setScalar(1 + Math.sin(globalTime * 5) * 0.08);
  } else if (mode === "start") {
    rig.group.position.copy(hero.pos);
    rig.group.rotation.y = hero.angle;
    poseCharacter(rig, {
      state: "idle",
      time: globalTime,
      phase: 0,
      combo: 0,
      speed: 0,
      skill: 0,
    });
  }
  world.update?.(mode === "pause" ? 0 : realDt, globalTime);
  audio.update?.(realDt);
  uiClock += realDt;
  if (uiClock > 0.065) {
    ui.update(stateSnapshot());
    uiClock = 0;
  }
  renderer.render(scene, camera);
}
resizeCamera();
updateCamera(1);
rig.group.position.copy(hero.pos);
rig.group.rotation.y = hero.angle;
ui.update(stateSnapshot());
ui.showScreen("start");
requestAnimationFrame(animate);
if (new URLSearchParams(location.search).get("debug") === "1") {
  window.__undead = {
    get state() {
      return stateSnapshot();
    },
    getState: stateSnapshot,
    worldToScreen(x, z, y = 0.8) {
      return worldToScreen(
        x?.isVector3
          ? x
          : new THREE.Vector3(
              typeof x === "object" ? x.x : x,
              y,
              typeof x === "object" ? x.z : z,
            ),
      );
    },
    commandTap(x, z, enemyId) {
      const e = enemies.find((e) => e.id === enemyId);
      commandTap(
        typeof x === "object"
          ? new THREE.Vector3(x.x, 0, x.z)
          : new THREE.Vector3(x, 0, z),
        e,
      );
    },
    castSkill,
    start: startGame,
    reset: startGame,
    pause: pauseGame,
    resume: resumeGame,
    roll(x = 0, z = -1) {
      roll(new THREE.Vector3(x, 0, z));
    },
    special: useSpecial,
    getTargets() {
      return enemies
        .filter((e) => e.state !== "dead")
        .map((e) => ({
          id: e.id,
          type: e.type,
          x: e.pos.x,
          z: e.pos.z,
          hp: e.hp,
          state: e.state,
          screen: worldToScreen(
            e.pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
          ),
        }));
    },
    forceWave(index = 3) {
      if (mode !== "playing") startGame();
      for (const e of enemies) {
        disposeGroup(e.rig.group, false);
        disposeGroup(e.bar);
      }
      enemies = [];
      kills = index === 1 ? 0 : index === 2 ? 10 : 22;
      spawnWave(THREE.MathUtils.clamp(index, 1, 3));
    },
    killAll() {
      for (const e of enemies) {
        if (e.state === "spawn") e.state = "idle";
        hurtEnemy(e, e.hp + 1, hero.pos, 2, true, true);
      }
    },
    damage(amount = 10) {
      hero.invulnerable = 0;
      damageHero(amount, hero.pos.clone().add(new THREE.Vector3(1, 0, 0)));
    },
    setResources(souls = 100, stamina = 100) {
      hero.souls = souls;
      hero.stamina = stamina;
    },
  };
}
