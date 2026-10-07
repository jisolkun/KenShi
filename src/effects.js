import * as THREE from 'three';

const GOLD = 0xffeac0;
const CYAN = 0x9ae8dd;

/** All combat effects are owned here, with explicit lifetime and disposal. */
export class CombatEffects {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.effects = [];
    this.sparkGeometry = new THREE.IcosahedronGeometry(0.06, 0);
    this.sparkPool = [];
    this.sparkLive = [];
    this.maxSparks = 180;
  }
  emit(position, color = GOLD, count = 12, power = 1) {
    for (let i = 0; i < count; i++) {
      let spark = this.sparkPool.pop();
      if (!spark) {
        if (this.sparkLive.length >= this.maxSparks) break;
        const mesh = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
        spark = { mesh, velocity: new THREE.Vector3(), age: 0, life: 0 };
      }
      spark.age = 0;
      spark.life = 0.26 + Math.random() * 0.28;
      spark.mesh.material.color.set(color);
      spark.mesh.material.opacity = 1;
      spark.mesh.position.copy(position);
      spark.mesh.position.y += 0.8;
      spark.mesh.scale.setScalar(0.65 + Math.random());
      spark.velocity.set((Math.random() - 0.5) * 6 * power, (2 + Math.random() * 4) * power, (Math.random() - 0.5) * 6 * power);
      this.root.add(spark.mesh);
      this.sparkLive.push(spark);
    }
  }
  arc(position, yaw, radius = 2.1, color = GOLD, duration = 0.22, full = false) {
    const geometry = new THREE.RingGeometry(radius * 0.69, radius, full ? 56 : 32, 1, full ? 0 : -0.55, full ? Math.PI * 2 : Math.PI * 1.2);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(-Math.PI / 2, 0, Math.PI - yaw);
    mesh.position.copy(position);
    mesh.position.y = 0.75;
    this.root.add(mesh);
    this.effects.push({ mesh, age: 0, life: duration, kind: 'arc', scale: 1 });
    // A second, narrow edge makes the slash legible against the stone floor.
    const edge = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, full ? 56 : 32, 1, full ? 0 : -0.55, full ? Math.PI * 2 : Math.PI * 1.2), material.clone());
    edge.material.opacity = 0.96;
    edge.position.copy(mesh.position);
    edge.position.y += 0.03;
    edge.rotation.copy(mesh.rotation);
    this.root.add(edge);
    this.effects.push({ mesh: edge, age: 0, life: duration * 0.9, kind: 'arc', scale: 1 });
  }
  ring(position, radius, color = CYAN, duration = 0.5) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y = 0.055;
    this.root.add(mesh);
    this.effects.push({ mesh, age: 0, life: duration, kind: 'ring', scale: radius });
  }
  trail(position, yaw, color = CYAN) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 1.8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.33, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(position);
    mesh.position.y = 0.9;
    mesh.rotation.y = yaw;
    this.root.add(mesh);
    this.effects.push({ mesh, age: 0, life: 0.25, kind: 'trail', scale: 1 });
  }
  label(position, text, color = '#fff1c9', size = 30) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${size * 2}px "Arial", sans-serif`;
    ctx.shadowColor = '#263638';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const mesh = new THREE.Sprite(material);
    mesh.position.copy(position);
    mesh.position.y += 2.5;
    mesh.scale.set(2.5, 0.94, 1);
    this.root.add(mesh);
    this.effects.push({ mesh, age: 0, life: 0.78, kind: 'label', scale: 1 });
  }
  removeEffect(effect) {
    this.root.remove(effect.mesh);
    if (!effect.mesh.isSprite) effect.mesh.geometry?.dispose();
    effect.mesh.material.map?.dispose();
    effect.mesh.material.dispose();
  }
  update(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.age += dt;
      const p = effect.age / effect.life;
      if (p >= 1) {
        this.removeEffect(effect);
        this.effects.splice(i, 1);
        continue;
      }
      effect.mesh.material.opacity = (1 - p) * (effect.kind === 'trail' ? 0.33 : 0.92);
      if (effect.kind === 'ring') effect.mesh.scale.setScalar(effect.scale * (0.5 + p * 0.6));
      if (effect.kind === 'arc') {
        effect.mesh.rotation.z -= dt * 2.3;
        effect.mesh.scale.setScalar(0.9 + p * 0.15);
      }
      if (effect.kind === 'label') effect.mesh.position.y += dt * 1.45;
    }
    for (let i = this.sparkLive.length - 1; i >= 0; i--) {
      const spark = this.sparkLive[i];
      spark.age += dt;
      if (spark.age >= spark.life) {
        this.root.remove(spark.mesh);
        this.sparkPool.push(spark);
        this.sparkLive.splice(i, 1);
        continue;
      }
      spark.velocity.y -= 15 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += dt * 8;
      spark.mesh.rotation.z += dt * 10;
      spark.mesh.material.opacity = 1 - spark.age / spark.life;
    }
  }
  clear() {
    this.effects.forEach(effect => this.removeEffect(effect));
    this.effects.length = 0;
    for (const spark of this.sparkLive) {
      this.root.remove(spark.mesh);
      this.sparkPool.push(spark);
    }
    this.sparkLive.length = 0;
  }
}
