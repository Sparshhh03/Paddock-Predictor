// A floating 3D stage that shows one team's car, optionally with a glass podium behind it.
// Used by the race section (car of the predicted winner + podium) and the team garage.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { carFor, fontsReady } from './car.js';

export async function createViewer(canvas, { podium = false, reducedMotion = false, gsap = null } = {}) {
  await fontsReady();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(8.5, 4.2, 9.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.7, podium ? -0.6 : 0);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.7;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.42;

  // lights: soft key, coloured rims
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x101018, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 9, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  key.shadow.radius = 5; key.shadow.bias = -0.0003;
  scene.add(key);
  const rimA = new THREE.PointLight(0xff4030, 7, 12, 1.5); rimA.position.set(-5, 2.5, -4);
  const rimB = new THREE.PointLight(0x4a7dff, 9, 12, 1.5); rimB.position.set(5, 2.5, 4);
  scene.add(rimA, rimB);

  // floating disc stage with a glowing rim
  const stage = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 0.18, 96),
    new THREE.MeshStandardMaterial({ color: 0x0E1016, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.6 }));
  disc.position.y = -0.09; disc.receiveShadow = true;
  stage.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.025, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  ring.rotation.x = Math.PI / 2;
  stage.add(ring);
  scene.add(stage);

  const carSlot = new THREE.Group();
  carSlot.position.set(0, 0, podium ? 1.2 : 0);
  stage.add(carSlot);

  // glass podium with floating helmets
  const helmets = [];
  if (podium) {
    const group = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, transmission: 0.92, thickness: 0.8, ior: 1.35, metalness: 0, transparent: true, opacity: 0.9 });
    const numTex = (n) => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.font = '700 168px Sora, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 128, 140);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    [[2, -1.35, 0.95], [1, 0, 1.4], [3, 1.35, 0.7]].forEach(([n, x, h]) => {
      const block = new THREE.Mesh(new RoundedBoxGeometry(1.25, h, 1.05, 4, 0.08), glass);
      block.position.set(x, h / 2, 0);
      group.add(block);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55),
        new THREE.MeshBasicMaterial({ map: numTex(n), transparent: true, toneMapped: false }));
      label.position.set(x, h * 0.5, 0.54);
      group.add(label);
      const hg = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }));
      shell.castShadow = true;
      const visor = new THREE.Mesh(new THREE.SphereGeometry(0.305, 32, 16, -0.95, 1.9, 1.1, 0.5),
        new THREE.MeshPhysicalMaterial({ color: 0x090B10, roughness: 0.05, metalness: 0.6, clearcoat: 1 }));
      visor.rotation.y = Math.PI / 2;
      hg.add(shell, visor);
      hg.position.set(x, h + 0.38, 0);
      hg.userData = { base: h + 0.38, shell, phase: n };
      group.add(hg);
      helmets[n - 1] = hg;
    });
    group.position.set(0, 0, -2.3);
    stage.add(group);
  }

  const cache = new Map();
  let current = null, currentKey = '';
  async function setCar(team, { number = 1, teamName = '' } = {}) {
    const k = team + '#' + number;
    if (k === currentKey) return;
    currentKey = k;
    let car = cache.get(k);
    if (!car) {
      car = await carFor(team, { number, teamName });
      cache.set(k, car);
    }
    if (currentKey !== k) return; // a newer request won
    if (current) carSlot.remove(current);
    car.rotation.y = -0.4;
    carSlot.add(car);
    current = car;
    if (gsap && !reducedMotion) {
      gsap.fromTo(carSlot.position, { y: 1.2 }, { y: 0, duration: 0.9, ease: 'bounce.out' });
      gsap.fromTo(carSlot.rotation, { y: -0.8 }, { y: 0, duration: 1.2, ease: 'power3.out' });
    }
  }

  function setPodium(list) {
    list.forEach((p, i) => {
      const h = helmets[i];
      if (!h) return;
      h.userData.shell.material.color.set(p.color);
      if (gsap && !reducedMotion) gsap.fromTo(h.position, { y: h.userData.base + 2 }, { y: h.userData.base, duration: 1.1, delay: 0.1 + i * 0.12, ease: 'bounce.out' });
    });
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pull back for tall or narrow windows so the whole car stays in frame
    const aspect = w / h;
    const dist = (podium ? 14.5 : 9.6) * Math.max(1, 1.25 / aspect) * (w < 560 ? 1.12 : 1);
    camera.position.setLength(dist);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    if (!visible) return;
    if (!reducedMotion) {
      current?.userData.wheels?.forEach(w => (w.rotation.z -= dt * 1.5));
      helmets.forEach(h => {
        if (!gsap || !gsap.isTweening(h.position)) h.position.y = h.userData.base + Math.sin(t * 2 + h.userData.phase) * 0.05;
        h.rotation.y = Math.sin(t * 0.8 + h.userData.phase) * 0.4;
      });
    }
    controls.update();
    renderer.render(scene, camera);
  });

  return { setCar, setPodium };
}
