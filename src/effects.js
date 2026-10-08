import * as THREE from "three";
const UP = new THREE.Vector3(0, 1, 0);
export function createEffects(scene, camera) {
  const objects = [],
    trails = [],
    temp = new THREE.Vector3();
  const particleGeometry = new THREE.OctahedronGeometry(0.06, 0);
  const palette = [0xffedc2, 0xdba35b, 0xdcd9fb, 0xaabaff];
  function add(mesh, duration, update) {
    scene.add(mesh);
    objects.push({ mesh, age: 0, duration, update });
    return mesh;
  }
  function ring(
    position,
    radius,
    color = 0xffb275,
    duration = 0.5,
    warning = false,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.94, radius, 56),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: warning ? 0.65 : 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y = 0.035;
    return add(mesh, duration, (o, p) => {
      o.material.opacity = (1 - p) * (warning ? 0.85 : 0.8);
      if (!warning) o.scale.setScalar(0.4 + p * 1.2);
    });
  }
  function warning(position, radius, duration) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0xa93129,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.06, radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff7152,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    edge.rotation.x = -Math.PI / 2;
    group.add(edge);
    group.position.copy(position);
    group.position.y = 0.045;
    return add(group, duration, (o, p) => {
      o.scale.setScalar(0.72 + 0.28 * p);
      mesh.material.opacity = 0.12 + p * 0.28;
      edge.material.opacity = 0.45 + Math.sin(p * 18) * 0.2;
    });
  }
  function burst(position, strength = 1, color) {
    for (let i = 0; i < Math.round(7 + strength * 5); i++) {
      const mesh = new THREE.Mesh(
        particleGeometry,
        new THREE.MeshBasicMaterial({
          color: color || palette[i % palette.length],
          transparent: true,
        }),
      );
      mesh.position.copy(position);
      mesh.position.y += 0.7;
      const a = Math.random() * Math.PI * 2,
        speed = 2 + Math.random() * 5 * strength;
      const velocity = new THREE.Vector3(
        Math.sin(a) * speed,
        1 + Math.random() * 3,
        Math.cos(a) * speed,
      );
      add(mesh, 0.24 + Math.random() * 0.3, (o, p, dt) => {
        velocity.y -= dt * 13;
        o.position.addScaledVector(velocity, dt);
        o.material.opacity = 1 - p;
        o.scale.setScalar(1 - p * 0.7);
      });
    }
  }
  function arc(position, angle, radius = 2, combo = 0, color = 0xaebeff) {
    const group = new THREE.Group();
    const sweep = combo === 3 ? Math.PI * 1.8 : Math.PI * 0.95;
    for (let layer = 0; layer < 3; layer++) {
      const inner = radius - (layer === 0 ? 0.19 : layer === 1 ? 0.09 : 0.035);
      const geometry = new THREE.RingGeometry(
        inner,
        radius + layer * 0.025,
        42,
        1,
        -sweep / 2,
        sweep,
      );
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: layer === 2 ? 0xffffff : layer === 1 ? 0xe3d9ff : color,
          transparent: true,
          opacity: layer === 0 ? 0.5 : 0.9,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
    }
    group.position.copy(position);
    group.position.y += combo === 2 ? 0.65 : 0.9;
    group.rotation.y = angle - Math.PI / 2;
    add(group, 0.21, (o, p) => {
      o.rotation.y += (combo % 2 ? -1 : 1) * 0.035;
      o.scale.setScalar(0.8 + p * 0.3);
      for (const m of o.children)
        m.material.opacity = (1 - p) * (m === o.children[0] ? 0.5 : 0.9);
    });
  }
  // A posed afterimage is static: bake its current world-space silhouette into
  // one draw call instead of cloning an entire animated skeleton.
  function ghost(rig) {
    rig.group.updateMatrixWorld(true);
    const meshes = [];
    let vertexCount = 0;
    rig.group.traverse((o) => {
      if (o.isMesh && o.visible && o.geometry.attributes.position) {
        meshes.push(o);
        vertexCount += o.geometry.index?.count || o.geometry.attributes.position.count;
      }
    });
    const positions = new Float32Array(vertexCount * 3);
    const point = new THREE.Vector3();
    let offset = 0;
    for (const mesh of meshes) {
      const attribute = mesh.geometry.attributes.position;
      const index = mesh.geometry.index;
      const count = index?.count || attribute.count;
      for (let i = 0; i < count; i++) {
        point.fromBufferAttribute(attribute, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        positions[offset++] = point.x;
        positions[offset++] = point.y;
        positions[offset++] = point.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const copy = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xc1d0ef, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    copy.frustumCulled = false;
    add(copy, 0.23, (o, p) => { o.material.opacity = (1 - p) * 0.16; });
  }
  function swordTrail() {
    const positions = new Float32Array(28 * 6 * 3),
      colors = new Float32Array(28 * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.frustumCulled = false;
    scene.add(mesh);
    const trail = { mesh, points: [], positions, colors };
    trails.push(trail);
    return trail;
  }
  function sample(trail, tip, body, active, dt) {
    for (const p of trail.points) p.age += dt;
    trail.points = trail.points.filter((p) => p.age < 0.15);
    if (active && tip) {
      temp.copy(tip).lerp(body, 0.48);
      temp.y = tip.y * 0.86;
      trail.points.push({ tip: tip.clone(), inner: temp.clone(), age: 0 });
      if (trail.points.length > 29) trail.points.shift();
    }
    let at = 0;
    for (let i = 1; i < trail.points.length; i++) {
      const a = trail.points[i - 1],
        b = trail.points[i];
      for (const [point, age, white] of [
        [a.tip, a.age, true],
        [a.inner, a.age, false],
        [b.tip, b.age, true],
        [b.tip, b.age, true],
        [a.inner, a.age, false],
        [b.inner, b.age, false],
      ]) {
        trail.positions[at] = point.x;
        trail.positions[at + 1] = point.y;
        trail.positions[at + 2] = point.z;
        const fade = Math.max(0, 1 - age / 0.15);
        trail.colors[at] = fade * (white ? 0.95 : 0.25);
        trail.colors[at + 1] = fade * (white ? 0.98 : 0.35);
        trail.colors[at + 2] = fade;
        at += 3;
      }
    }
    trail.mesh.geometry.setDrawRange(0, at / 3);
    trail.mesh.geometry.attributes.position.needsUpdate = true;
    trail.mesh.geometry.attributes.color.needsUpdate = true;
  }
  function update(dt) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      o.age += dt;
      o.update?.(o.mesh, o.age / o.duration, dt);
      if (o.age >= o.duration) {
        scene.remove(o.mesh);
        o.mesh.traverse((c) => {
          if (c.isMesh) {
            if (c.geometry !== particleGeometry && !c.userData.sharedGeometry)
              c.geometry?.dispose();
            if (Array.isArray(c.material))
              c.material.forEach((m) => m.dispose());
            else c.material?.dispose();
          }
        });
        objects.splice(i, 1);
      }
    }
  }
  function clear() {
    for (const o of objects) {
      scene.remove(o.mesh);
      o.mesh.traverse((c) => {
        if (c.isMesh) {
          if (c.geometry !== particleGeometry && !c.userData.sharedGeometry)
            c.geometry?.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material?.dispose();
        }
      });
    }
    objects.length = 0;
    for (const t of trails) t.points.length = 0;
  }
  return {
    ring,
    warning,
    burst,
    arc,
    ghost,
    swordTrail,
    sample,
    update,
    clear,
  };
}
