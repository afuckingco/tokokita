// public/js/hero-3d.js
// Signature element: kardus belanja 3D berputar dengan produk-produk kecil
// mengorbit di sekitarnya, merepresentasikan "keranjang siap diantar".
// Hanya berjalan di halaman yang punya elemen #hero-3d (index.ejs).

(function () {
  const mount = document.getElementById('hero-3d');
  if (!mount || typeof THREE === 'undefined') return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const width = mount.clientWidth;
  const height = mount.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 1.4, 7);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);

  // ---- Lighting: warm key light + cool fill, gives the cardboard a sense of place ----
  const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.6);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x9fd8c0, 0.6);
  fillLight.position.set(-5, 2, -3);
  scene.add(fillLight);

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  // ---- Group that holds everything so we can rotate as one ----
  const rig = new THREE.Group();
  scene.add(rig);

  // ---- The crate / box (signature shape) ----
  const boxGroup = new THREE.Group();
  rig.add(boxGroup);

  const cardboardMat = new THREE.MeshStandardMaterial({
    color: 0xc98a4b,
    roughness: 0.85,
    metalness: 0.05,
  });
  const cardboardDarkMat = new THREE.MeshStandardMaterial({
    color: 0xa9712f,
    roughness: 0.9,
    metalness: 0.05,
  });

  const crateGeo = new THREE.BoxGeometry(2.6, 1.6, 2.6);
  const crate = new THREE.Mesh(crateGeo, cardboardMat);
  crate.position.y = -0.3;
  boxGroup.add(crate);

  // Flaps (open box look) — four thin boxes angled outward
  const flapGeo = new THREE.BoxGeometry(2.5, 0.08, 1.2);
  const flapPositions = [
    { x: 0, z: 1.25, rotX: -0.55, key: 'front' },
    { x: 0, z: -1.25, rotX: 0.55, key: 'back' },
  ];
  flapPositions.forEach((p) => {
    const flap = new THREE.Mesh(flapGeo, cardboardDarkMat);
    flap.position.set(p.x, 0.5, p.z * 0.85);
    flap.rotation.x = p.rotX;
    boxGroup.add(flap);
  });
  const sideFlapGeo = new THREE.BoxGeometry(1.2, 0.08, 2.5);
  const sideFlapPositions = [
    { x: 1.25, rotZ: 0.55 },
    { x: -1.25, rotZ: -0.55 },
  ];
  sideFlapPositions.forEach((p) => {
    const flap = new THREE.Mesh(sideFlapGeo, cardboardDarkMat);
    flap.position.set(p.x * 0.85, 0.5, 0);
    flap.rotation.z = p.rotZ;
    boxGroup.add(flap);
  });

  // ---- Little "products" peeking out of the crate ----
  function makeProduct(color, geometry, position, rotation) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    boxGroup.add(mesh);
    return mesh;
  }

  // can
  makeProduct(
    0xe07a5f,
    new THREE.CylinderGeometry(0.32, 0.32, 0.7, 24),
    [-0.7, 0.55, 0.3],
    [0, 0, 0.15]
  );
  // box of something
  makeProduct(
    0xf4a300,
    new THREE.BoxGeometry(0.55, 0.75, 0.4),
    [0.4, 0.55, 0.5],
    [0, 0.3, -0.1]
  );
  // bottle
  const bottleGroup = new THREE.Group();
  const bottleBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.26, 0.75, 16),
    new THREE.MeshStandardMaterial({ color: 0x52b788, roughness: 0.3, metalness: 0.15 })
  );
  const bottleNeck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.14, 0.25, 16),
    new THREE.MeshStandardMaterial({ color: 0x52b788, roughness: 0.3, metalness: 0.15 })
  );
  bottleNeck.position.y = 0.5;
  bottleGroup.add(bottleBody, bottleNeck);
  bottleGroup.position.set(0.1, 0.6, -0.45);
  bottleGroup.rotation.z = -0.1;
  boxGroup.add(bottleGroup);

  // ---- Orbiting items around the crate (small spheres = "items being delivered") ----
  const orbiters = [];
  const orbitColors = [0xf4a300, 0xe07a5f, 0xfaf6ee, 0x52b788];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: orbitColors[i % orbitColors.length],
      roughness: 0.5,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const radius = 2.6 + (i % 2) * 0.4;
    const speed = 0.25 + i * 0.07;
    const yOff = 0.3 + i * 0.25;
    const phase = (i / 4) * Math.PI * 2;
    orbiters.push({ mesh, radius, speed, yOff, phase });
    scene.add(mesh);
  }

  // ---- Soft ground shadow circle ----
  const shadowGeo = new THREE.CircleGeometry(2.4, 32);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.18,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.25;
  rig.add(shadow);

  // ---- Mouse parallax ----
  let targetRotY = 0;
  let targetRotX = 0;
  window.addEventListener('mousemove', (e) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    targetRotY = nx * 0.35;
    targetRotX = ny * 0.12;
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    if (!reducedMotion) {
      boxGroup.rotation.y += 0.0035;
      rig.rotation.y += (targetRotY - rig.rotation.y) * 0.04;
      rig.rotation.x += (targetRotX - rig.rotation.x) * 0.04;
      rig.position.y = Math.sin(t * 0.8) * 0.08;

      orbiters.forEach((o) => {
        const angle = t * o.speed + o.phase;
        o.mesh.position.set(
          Math.cos(angle) * o.radius,
          o.yOff + Math.sin(t * 1.3 + o.phase) * 0.15,
          Math.sin(angle) * o.radius
        );
        o.mesh.rotation.x += 0.01;
        o.mesh.rotation.y += 0.015;
      });
    }

    renderer.render(scene, camera);
  }
  animate();

  // ---- Resize handling ----
  window.addEventListener('resize', () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
})();
