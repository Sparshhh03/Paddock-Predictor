// Intro scene: a black stepped valley with light trails running along the step edges,
// and the Red Bull car on a slow turntable in the pit at the bottom.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { carFor, fontsReady } from './car.js';

const GLINT_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const GLINT_FRAG = /* glsl */`
  uniform float uTime, uOffset, uSpeed, uDir, uBase;
  varying vec2 vUv;
  vec3 spectrum(float t) {
    vec3 red = vec3(1.0, 0.14, 0.08), amber = vec3(1.0, 0.64, 0.16), white = vec3(1.0), blue = vec3(0.24, 0.52, 1.0);
    if (t < 0.33) return mix(white, amber, t / 0.33);
    if (t < 0.66) return mix(amber, red, (t - 0.33) / 0.33);
    return mix(red, blue, (t - 0.66) / 0.34);
  }
  void main() {
    float x = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
    float head = fract(uTime * uSpeed + uOffset) * 1.9 - 0.45;
    float d = (head - x) / 0.32;                       // 0 at the head, 1 at the tail
    float trail = (d > 0.0 && d < 1.0) ? pow(1.0 - d, 1.6) : 0.0;
    float spark = exp(-pow((x - head) / 0.015, 2.0));
    float v = abs(vUv.y - 0.5) * 2.0;
    float core = exp(-v * v * 90.0), halo = exp(-v * v * 7.0) * 0.3;
    vec3 c = spectrum(clamp(d, 0.0, 1.0)) * trail * (core + halo) * 1.7
           + vec3(1.0) * spark * (core + halo) * 1.4
           + vec3(0.75, 0.8, 0.95) * core * uBase;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export async function createHero(canvas, { reducedMotion = false, gsap = null } = {}) {
  await fontsReady();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17171C);
  scene.fog = new THREE.Fog(0x17171C, 40, 95);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const look = new THREE.Vector3(0, 2.6, -2);
  const CAR_Z = 6.5; // the car sits at the mouth of the valley, in front of the steps

  // ---------- the stepped valley ----------
  const PIT = 7.4, STEP = 2.5;
  const HEIGHTS = [1.0, 2.0, 3.05, 4.1, 5.15, 6.2];
  const side = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.12 });
  const top = new THREE.MeshStandardMaterial({ color: 0x0B0B0F, roughness: 0.5, metalness: 0.4, envMapIntensity: 0.3 });
  const blocks = new THREE.Group();
  const glints = [];
  const glintGeo = new THREE.PlaneGeometry(1, 1);
  HEIGHTS.forEach((h, i) => {
    for (const s of [-1, 1]) {
      const x = s * (PIT / 2 + STEP * (i + 0.5));
      const box = new THREE.Mesh(new THREE.BoxGeometry(STEP, h, 46), [side, side, top, side, side, side]);
      box.position.set(x, h / 2, -23);
      box.receiveShadow = true;
      blocks.add(box);
      // light trail along the front-top edge
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG,
        uniforms: {
          uTime: { value: 0 }, uOffset: { value: Math.random() }, uSpeed: { value: 0.11 + Math.random() * 0.09 },
          uDir: { value: s }, uBase: { value: 0.3 },
        },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const g = new THREE.Mesh(glintGeo, mat);
      g.scale.set(STEP, 0.42, 1);
      g.position.set(x, h, 0.03);
      blocks.add(g); glints.push(mat);
      // and a fainter trail running back along the top edge into the distance
      const mat2 = mat.clone();
      mat2.uniforms = THREE.UniformsUtils.clone(mat.uniforms);
      mat2.uniforms.uOffset.value = Math.random(); mat2.uniforms.uBase.value = 0.05; mat2.uniforms.uSpeed.value *= 0.6;
      const g2 = new THREE.Mesh(glintGeo, mat2);
      g2.scale.set(46, 0.3, 1);
      g2.rotation.y = Math.PI / 2 * -s;
      g2.position.set(x - s * STEP / 2, h + 0.005, -23);
      g2.rotation.x = 0;
      blocks.add(g2); glints.push(mat2);
    }
  });
  scene.add(blocks);

  // pit floor: dark and glossy so the car and trails reflect softly
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(PIT + STEP * 30, 110),
    new THREE.MeshStandardMaterial({ color: 0x08080B, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.25 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = -10; floor.receiveShadow = true;
  scene.add(floor);
  // soft pool of light under the car
  const poolTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(120,140,255,0.55)'); r.addColorStop(0.45, 'rgba(60,70,160,0.18)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.01, CAR_Z);
  scene.add(pool);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x8a92b0, 0x050507, 0.35));
  const key = new THREE.SpotLight(0xffffff, 340, 40, 0.42, 0.75, 1.6);
  key.position.set(2, 13, CAR_Z + 6); key.target.position.set(0, 0, CAR_Z);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; key.shadow.radius = 4;
  scene.add(key, key.target);
  const rimL = new THREE.PointLight(0xff3020, 14, 10, 1.8); rimL.position.set(-3.6, 2.6, CAR_Z - 3.5);
  const rimR = new THREE.PointLight(0x3a6bff, 16, 10, 1.8); rimR.position.set(3.6, 2.6, CAR_Z - 3.5);
  const front = new THREE.PointLight(0xfff1e0, 18, 16, 1.5); front.position.set(0, 3, CAR_Z + 5);
  scene.add(rimL, rimR, front);

  // ---------- the car ----------
  const turntable = new THREE.Group();
  turntable.position.set(0, 0, CAR_Z);
  scene.add(turntable);
  const car = await carFor('red_bull', { number: 3, teamName: 'Red Bull' });
  car.rotation.y = -Math.PI / 2 - 0.5; // nose toward the camera, three-quarter view
  turntable.add(car);

  // ---------- interaction ----------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  // scroll progress through the hero (0..1), set from outside
  let progress = 0;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the valley framed on narrow screens
    camera.fov = w / h < 0.8 ? 52 : w / h < 1.3 ? 42 : 34;
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
    glints.forEach(m => { m.uniforms.uTime.value = reducedMotion ? 3 : t; });
    if (!reducedMotion) {
      turntable.rotation.y += dt * 0.22;
      car.userData.wheels?.forEach(w => (w.rotation.z -= dt * 0.6));
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
    }
    const narrow = camera.aspect < 0.8;
    // on tall phone screens aim higher so the car sits below the headline and buttons
    camera.position.set(pointer.x * 1.6, (narrow ? 3.6 : 4.4) - progress * 1.8 + pointer.y * -0.4, (narrow ? 23 : 30) - progress * 9);
    camera.lookAt(look.x, (narrow ? 6.4 : look.y) + progress * 0.4, look.z);
    renderer.render(scene, camera);
  });

  // entrance: the car drops onto the turntable and the valley rises
  if (gsap && !reducedMotion) {
    const a = gsap.from(turntable.position, { y: 3, duration: 1.4, ease: 'power3.out', delay: 0.2 });
    const b = gsap.from(blocks.position, { y: -6, duration: 1.6, ease: 'power4.out' });
    setTimeout(() => { a.progress(1); b.progress(1); }, 3000);
  }

  return {
    setProgress(p) { progress = Math.max(0, Math.min(1, p)); },
  };
}
