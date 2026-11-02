/* =========================================================
 * 🏟️ 선수 무대 3D — 밤의 경기장, 조명 아래 선 내 선수
 *  · Three.js (vendor/three.min.js, MIT) 를 선수 탭을 열 때만 불러옴
 *  · 안개 · 스포트라이트 빛기둥 · 떠다니는 빛 입자 · 큰 달
 *  · 선수 몸은 진짜 운동 레벨(상체·하체)만큼 커지고 많이 키우면 헐크
 *  · 손가락으로 돌려볼 수 있음, 동작 줄이기 설정이면 자동 회전 끔
 * ========================================================= */
window.stage3d = (() => {
  let THREE = null, loading = null, ready = false, failed = false;
  let renderer, scene, camera, root, fig, mats = {}, dust, glow, cones = [], ring;
  let box = null, want = null, raf = 0, t0 = 0, yaw = 0.5, yawV = 0, drag = null, lastKey = '';
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();

  function load() {
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      if (window.THREE) { THREE = window.THREE; res(); return; }
      const s = document.createElement('script');
      s.src = 'vendor/three.min.js';
      s.onload = () => { THREE = window.THREE; THREE ? res() : rej(new Error('no three')); };
      s.onerror = () => rej(new Error('load fail'));
      document.head.appendChild(s);
    });
    return loading;
  }

  const hex = (h) => new THREE.Color(h);
  function mix(a, b, t) { return hex(a).lerp(hex(b), t); }

  function init(el) {
    box = el;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    } catch { failed = true; return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = hex('#07070d');
    scene.fog = new THREE.FogExp2(0x0b0b14, 0.085);
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

    // 바닥: 젖은 아스팔트 느낌의 어두운 원판 + 빛나는 링
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.35, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.14, 64), new THREE.MeshStandardMaterial({ color: 0x1b1b26, roughness: 0.5, metalness: 0.3 }));
    stage.position.y = 0.07; stage.receiveShadow = true; scene.add(stage);
    ring = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.018, 8, 96), new THREE.MeshBasicMaterial({ color: 0xe98ce6 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.145; scene.add(ring);
    // 경기장 라인
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x23233a, transparent: true, opacity: 0.8 });
    for (let i = 1; i <= 4; i++) {
      const l = new THREE.Mesh(new THREE.RingGeometry(2 + i * 1.3, 2.02 + i * 1.3, 96), lineMat);
      l.rotation.x = -Math.PI / 2; l.position.y = 0.005; scene.add(l);
    }

    // 큰 달 (붉은 빛) + 뒤쪽 은은한 빛
    const moonTex = radialTexture('rgba(255,120,90,1)', 'rgba(255,80,60,0)');
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, opacity: 0.9 }));
    moon.scale.set(4.2, 4.2, 1); moon.position.set(-2.4, 3.9, -7); scene.add(moon);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), new THREE.MeshBasicMaterial({ color: 0xff5a3c, fog: false }));
    disc.scale.setScalar(0.8); disc.position.set(-2.4, 3.9, -7.05); scene.add(disc); scene.userData.moon = [moon, disc];
    glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(233,140,230,.55)', 'rgba(233,140,230,0)'), transparent: true, depthWrite: false }));
    glow.scale.set(6, 6, 1); glow.position.set(0, 1.6, -1.5); scene.add(glow);

    // 조명
    scene.add(new THREE.HemisphereLight(0x6670a0, 0x0a0a10, 0.35));
    const key = new THREE.SpotLight(0xfff1d6, 2.2, 22, Math.PI / 7, 0.55, 1.2);
    key.position.set(2.5, 8, 3); key.target.position.set(0, 1, 0); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const rim = new THREE.SpotLight(0xe98ce6, 1.6, 20, Math.PI / 8, 0.6, 1.2);
    rim.position.set(-3, 6, -4); rim.target.position.set(0, 1.2, 0); scene.add(rim, rim.target);
    const fill = new THREE.PointLight(0x5b7cff, 0.35, 12); fill.position.set(-3, 2, 4); scene.add(fill);
    // 빛기둥 (보이는 콘)
    [[2.5, 3, 0xfff1d6, 0.032], [-3, -4, 0xe98ce6, 0.03]].forEach(([x, z, c, o]) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 8, 48, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      cone.position.set(x * 0.5, 4, z * 0.5); cone.lookAt(x, 8, z); cone.rotateX(-Math.PI / 2);
      cones.push(cone); scene.add(cone);
    });

    // 떠다니는 빛 입자 (먼지 · 빗방울 느낌)
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 14; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 14; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe9cf, size: 0.035, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(dust);

    root = new THREE.Group(); root.position.y = 0.14; scene.add(root);

    // 손가락으로 돌리기
    const dom = renderer.domElement;
    dom.style.touchAction = 'pan-y';
    dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw }; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointermove', (e) => { if (drag) { yaw = drag.yaw - (e.clientX - drag.x) * 0.012; yawV = 0; } });
    const up = () => { drag = null; };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    new ResizeObserver(resize).observe(el);
    resize();
    ready = true;
  }
  function radialTexture(inner, outer) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  function resize() {
    if (!box || !renderer) return;
    const w = box.clientWidth || 300, h = box.clientHeight || 360;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  /* ---- 선수 만들기 (근육량 = 진짜 운동 레벨) ---- */
  function build({ up = 0, low = 0, color = '#3a3a42', track = '' }) {
    if (fig) { root.remove(fig); fig.traverse((o) => o.geometry && o.geometry.dispose()); }
    const U = Math.min(up, 40) / 40, L = Math.min(low, 40) / 40;
    const hulk = Math.max(0, Math.min(1, ((up + low) / 2 - 16) / 14));
    mats.skin = new THREE.MeshStandardMaterial({ color: mix('#e9b994', '#5fb840', hulk), roughness: 0.55, metalness: 0.05 });
    mats.shirt = new THREE.MeshStandardMaterial({ color: hex(color), roughness: 0.7 });
    mats.shorts = new THREE.MeshStandardMaterial({ color: 0x1d1d24, roughness: 0.8 });
    mats.hair = new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 0.9 });
    mats.shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const f = new THREE.Group();
    const S = (r, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; f.add(o); return o; };
    const C = (r1, r2, h, m, x, y, z, rz = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 24), m); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = true; f.add(o); return o; };

    const sh = 0.36 + U * 0.42;          // 어깨 반폭
    const waist = 0.22 + U * 0.08 + L * 0.06;
    const arm = 0.075 + U * 0.11;
    const leg = 0.11 + L * 0.13;
    const hipY = 0.95, chestY = 1.5;
    // 다리
    [-1, 1].forEach((s) => {
      const x = s * (waist * 0.55);
      C(leg, leg * 0.75, 0.5, mats.skin, x, hipY - 0.27, 0);           // 허벅지
      S(leg * 1.08, mats.skin, x, hipY - 0.2, 0.01, 1, 1.5, 1);           // 대퇴 볼륨
      C(leg * 0.7, leg * 0.5, 0.45, mats.skin, x, hipY - 0.72, 0);      // 종아리
      S(leg * 0.62, mats.skin, x, hipY - 0.62, -0.03, 1, 1.3, 1);
      const shoe = S(0.09 + leg * 0.2, mats.shoe, x, 0.05, 0.05, 1, 0.55, 1.6);
      shoe.position.y = 0.06;
    });
    // 반바지 (골반 + 양쪽 다리)
    C(waist + 0.03, waist + 0.06, 0.16, mats.shorts, 0, hipY + 0.05, 0);
    [-1, 1].forEach((s2) => C(leg * 1.15, leg * 1.2, 0.26, mats.shorts, s2 * (waist * 0.55), hipY - 0.1, 0));
    // 몸통 (역삼각형)
    const torso = C(sh * 0.92, waist, 0.62, track === 'olympia' ? mats.skin : mats.shirt, 0, chestY - 0.22, 0);
    torso.scale.z = 0.62 + U * 0.25;
    S(sh * 0.62, track === 'olympia' ? mats.skin : mats.shirt, 0, chestY - 0.02, 0.04, 1.45, 0.62, 0.75 + U * 0.3); // 가슴
    // 어깨 · 팔
    [-1, 1].forEach((s) => {
      S(arm * 1.45, mats.skin, s * sh, chestY + 0.02, 0);                // 삼각근
      C(arm, arm * 0.85, 0.38, mats.skin, s * (sh + 0.05), chestY - 0.22, 0, s * 0.18);   // 상완
      S(arm * (1.15 + U * 0.5), mats.skin, s * (sh + 0.06), chestY - 0.17, 0.05, 1, 1.2, 1.05); // 이두
      C(arm * 0.82, arm * 0.62, 0.36, mats.skin, s * (sh + 0.12), chestY - 0.55, 0.03, s * 0.12); // 전완
      S(arm * 0.75, mats.skin, s * (sh + 0.15), chestY - 0.78, 0.04);    // 손
    });
    // 목 · 머리 (머리는 그대로 → 커질수록 웃긴 비율)
    C(0.07 + U * 0.07, 0.09 + U * 0.09, 0.16, mats.skin, 0, chestY + 0.2, 0);
    S(0.17, mats.skin, 0, chestY + 0.42, 0, 1, 1.1, 1);
    S(0.175, mats.hair, 0, chestY + 0.5, -0.02, 1.02, 0.7, 1.02);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x111111 });
    [-1, 1].forEach((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), eyeM); e.position.set(s * 0.06, chestY + 0.44, 0.16); f.add(e); });
    // 종목 소품
    if (track === 'soccer') { const b = S(0.12, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), 0.42, 0.26, 0.3); b.userData.spin = true; }
    if (track === 'baseball') { C(0.025, 0.04, 0.8, new THREE.MeshStandardMaterial({ color: 0xb07a3b, roughness: 0.6 }), sh + 0.3, chestY - 0.4, 0.1, -0.5); S(0.19, mats.shirt, 0, chestY + 0.5, 0.02, 1.05, 0.55, 1.1); }
    if (track === 'runner') { const band = C(0.18, 0.18, 0.05, mats.shirt, 0, chestY + 0.5, 0); band.scale.z = 1.05; }
    if (track === 'olympia') { C(waist + 0.02, waist + 0.02, 0.1, mats.shirt, 0, hipY + 0.08, 0); }
    f.scale.setScalar(1 + (U + L) * 0.08);
    fig = f; root.add(f);
    ring.material.color = hex(color === '#3a3a42' ? '#e98ce6' : color);
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!box || !box.isConnected || box.offsetParent === null || document.hidden) return;   // 안 보일 땐 쉼
    const s = (t - t0) / 1000;
    if (!drag && !reduce) yaw += 0.0025;
    camera.position.set(Math.sin(yaw) * 7.2, 2.0 + Math.sin(s * 0.25) * 0.08, Math.cos(yaw) * 7.2);
    camera.lookAt(0, 1.35, 0);
    // 달은 항상 화면 왼쪽 위 먼 곳에
    const [moon, disc] = scene.userData.moon;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const mp = camera.position.clone().addScaledVector(fwd, 13).addScaledVector(right, -2.6);
    mp.y += 3.2;
    moon.position.copy(mp); disc.position.copy(mp).addScaledVector(fwd, 0.05); disc.lookAt(camera.position);
    if (fig) {
      const br = 1 + Math.sin(s * 1.6) * 0.012;
      fig.children.forEach((o) => { if (o.userData.spin) { o.rotation.x = s * 2; } });
      fig.scale.y = (fig.userData.sy || (fig.userData.sy = fig.scale.y)) * br;
    }
    const p = dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { let y = p.getY(i) - 0.006; if (y < 0) y = 8; p.setY(i, y); }
    p.needsUpdate = true;
    glow.material.opacity = 0.75 + Math.sin(s * 0.8) * 0.15;
    renderer.render(scene, camera);
  }

  /** 선수 탭이 그려질 때 호출 */
  async function show(el, opts) {
    want = opts;
    if (failed) return false;
    try { await load(); } catch { failed = true; return false; }
    if (!ready) init(el);
    if (failed) return false;
    if (box !== el) { box = el; el.appendChild(renderer.domElement); resize(); }
    const key = JSON.stringify(want);
    if (key !== lastKey) { lastKey = key; build(want); }
    if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(tick); }
    return true;
  }
  return { show, supported: () => !failed };
})();
