/* =========================================================
 * 🏟️ 선수 무대 3D — 밤의 경기장, 조명 아래 선 내 선수
 *  · Three.js (vendor/three.min.js, MIT) 를 선수 탭을 열 때만 불러옴
 *  · 안개 · 스포트라이트 빛기둥 · 떠다니는 빛 입자 · 큰 달
 *  · 선수 몸은 진짜 운동 레벨(상체·하체)만큼 커지고 많이 키우면 헐크
 *  · 손가락으로 돌려볼 수 있음, 동작 줄이기 설정이면 자동 회전 끔
 * ========================================================= */
window.stage3d = (() => {
  let THREE = null, loading = null, ready = false, failed = false;
  let renderer, scene, camera, root, dust, glow, cones = [], ring;
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
    const ptrs = new Map(); let gymPinch = null;   // 📸 단체사진: 핀치 줌용
    dom.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (photo && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; photo.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: photo.zoom }; drag = null; return; }
      if (!photo && want && want.team && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gymPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: gymDist }; drag = null; return; }
      drag = { x: e.clientX, y: e.clientY, yaw, gy: gymYaw, gh: gymH, moved: false, pan: photo ? photo.pan : 0, tilt: photo ? photo.tilt : 0 };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (photo && photo.pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        photoZoom(photo.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(20, photo.pinch.d));
        return;
      }
      if (gymPinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        gymDist = Math.max(9, Math.min(70, gymPinch.dist * gymPinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))));
        gymTouched = performance.now();
        return;
      }
      if (!drag) return;
      if (photo) {   // 한 손가락: 패닝(좌우) · 틸트(위아래)
        const h = dom.clientHeight || 400, k = (photo.cam.fov * Math.PI / 180) / h;
        photo.pan = Math.max(-0.7, Math.min(0.7, drag.pan + (e.clientX - drag.x) * k));
        photo.tilt = Math.max(-0.45, Math.min(0.45, drag.tilt + (e.clientY - drag.y) * k));
        drag.moved = true;
        return;
      }
      if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
      if (Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
      if (want && want.team && room) return;
      if (want && want.team) { gymYaw = drag.gy - (e.clientX - drag.x) * 0.008; if (immersive) gymH = Math.max(2.2, Math.min(40, drag.gh + (e.clientY - drag.y) * 0.04)); gymTouched = performance.now(); } else { yaw = drag.yaw - (e.clientX - drag.x) * 0.012; yawV = 0; }
    });
    const up = (e) => {
      if (drag && !drag.moved && want && want.team && gymScene && !photo && onPick && e && e.clientX !== undefined) {
        const r = dom.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), gymCam);
        const hit = ray.intersectObjects(agents.map((a) => a.g), true)[0];
        if (hit) { let o = hit.object; while (o && !o.userData.agent) o = o.parent; if (o) onPick(o.userData.agent); }
        else if (onStatue && gymScene.userData.statue && ray.intersectObject(gymScene.userData.statue, true)[0]) onStatue();
        else if (onBooth) {
          const bh = ray.intersectObjects(Object.values(booths).map((b) => b.g), true)[0];
          if (bh) { let o = bh.object; while (o && !o.userData.booth) o = o.parent; if (o) onBooth(o.userData.booth); }
        }
      }
      drag = null;
      if (e && e.pointerId !== undefined) ptrs.delete(e.pointerId);
      if (photo && ptrs.size < 2) photo.pinch = null;
      if (ptrs.size < 2) gymPinch = null;
    };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => {
      if (photo) { e.preventDefault(); photoZoom(photo.zoom * Math.exp(-e.deltaY * 0.0015)); return; }
      if (immersive && want && want.team) { e.preventDefault(); gymDist = Math.max(9, Math.min(70, gymDist * Math.exp(e.deltaY * 0.0012))); gymTouched = performance.now(); }
    }, { passive: false });
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
    if (gymCam) { gymCam.aspect = w / h; gymCam.fov = Math.max(46, Math.min(80, 2 * Math.atan(0.331 / (w / h)) * 180 / Math.PI)); gymCam.updateProjectionMatrix(); }
  }

  /* ---- 선수 만들기 (근육량 = 진짜 운동 레벨) ---- */
  function makeFigure({ up = 0, low = 0, color = '#3a3a42', track = '', stage = 0, jail = false }) {
    if (jail) color = '#ff7a1a';   // 🔒 죄수복
    const mats = {};
    const U = Math.min(up, 40) / 40, L = Math.min(low, 40) / 40;
    const hulk = Math.max(0, Math.min(1, ((up + low) / 2 - 16) / 14));
    mats.skin = new THREE.MeshStandardMaterial({ color: mix('#e9b994', '#5fb840', hulk), roughness: 0.55, metalness: 0.05 });
    mats.shirt = new THREE.MeshStandardMaterial({ color: hex(color), roughness: 0.7 });
    mats.shorts = new THREE.MeshStandardMaterial({ color: jail ? 0xff7a1a : 0x1d1d24, roughness: 0.8 });
    mats.hair = new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 0.9 });
    mats.shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const f = new THREE.Group();
    const S = (r, m, x, y, z, sx = 1, sy = 1, sz = 1, par = f) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; par.add(o); return o; };
    const C = (r1, r2, h, m, x, y, z, rz = 0, par = f) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 20), m); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = true; par.add(o); return o; };

    const sh = 0.36 + U * 0.42;          // 어깨 반폭
    const waist = 0.22 + U * 0.08 + L * 0.06;
    const arm = 0.075 + U * 0.11;
    const leg = 0.11 + L * 0.13;
    const hipY = 0.95, chestY = 1.5;
    const rig = { legs: [], arms: [] };
    // 다리 (엉덩이 관절에서 회전)
    [-1, 1].forEach((s) => {
      const x = s * (waist * 0.55);
      const pv = new THREE.Group(); pv.position.set(x, hipY, 0); f.add(pv); rig.legs.push(pv);
      C(leg, leg * 0.75, 0.5, mats.skin, 0, -0.27, 0, 0, pv);
      S(leg * 1.08, mats.skin, 0, -0.2, 0.01, 1, 1.5, 1, pv);
      C(leg * 0.7, leg * 0.5, 0.45, mats.skin, 0, -0.72, 0, 0, pv);
      S(leg * 0.62, mats.skin, 0, -0.62, -0.03, 1, 1.3, 1, pv);
      S(0.09 + leg * 0.2, mats.shoe, 0, 0.06 - hipY, 0.05, 1, 0.55, 1.6, pv);
      C(leg * 1.15, leg * 1.2, 0.26, mats.shorts, 0, -0.1, 0, 0, pv);
    });
    C(waist + 0.03, waist + 0.06, 0.16, mats.shorts, 0, hipY + 0.05, 0);
    // 몸통 (역삼각형)
    const torso = C(sh * 0.92, waist, 0.62, track === 'olympia' ? mats.skin : mats.shirt, 0, chestY - 0.22, 0);
    torso.scale.z = 0.62 + U * 0.25;
    S(sh * 0.62, track === 'olympia' ? mats.skin : mats.shirt, 0, chestY - 0.02, 0.04, 1.45, 0.62, 0.75 + U * 0.3); // 가슴
    // 어깨 · 팔 (어깨 관절에서 회전)
    [-1, 1].forEach((s) => {
      S(arm * 1.45, mats.skin, s * sh, chestY + 0.02, 0);
      const pv = new THREE.Group(); pv.position.set(s * sh, chestY + 0.02, 0); f.add(pv); rig.arms.push(pv);
      C(arm, arm * 0.85, 0.38, mats.skin, s * 0.05, -0.24, 0, s * 0.18, pv);
      S(arm * (1.15 + U * 0.5), mats.skin, s * 0.06, -0.19, 0.05, 1, 1.2, 1.05, pv);
      C(arm * 0.82, arm * 0.62, 0.36, mats.skin, s * 0.12, -0.57, 0.03, s * 0.12, pv);
      const hand = S(arm * 0.75, mats.skin, s * 0.15, -0.8, 0.04, 1, 1, 1, pv);
      pv.userData.hand = hand;
    });
    f.userData.rig = rig;
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
    /* ✨ 유명해질수록 화려해지는 코스튬 (단계 기준) */
    const tier = stage >= 7 ? 4 : stage >= 5 ? 3 : stage >= 3 ? 2 : stage >= 1 ? 1 : 0;
    const gold = new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.9, roughness: 0.25, emissive: 0x3a2600 });
    const team = new THREE.MeshStandardMaterial({ color: hex(color === '#3a3a42' ? '#e98ce6' : color), roughness: 0.4, metalness: 0.2 });
    if (tier >= 1) {   // 손목 밴드 · 머리띠
      rig.arms.forEach((pv, i) => { const b = C(arm * 0.95, arm * 0.95, 0.07, team, (i ? 1 : -1) * 0.13, -0.66, 0.03, 0, pv); b.rotation.z = (i ? 1 : -1) * 0.12; });
      if (track !== 'runner' && track !== 'baseball') C(0.178, 0.178, 0.045, team, 0, chestY + 0.52, 0);
    }
    if (tier >= 2) {   // 금목걸이 · 컬러 운동화 · 등번호 라인
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.13 + U * 0.05, 0.014, 8, 32), gold); chain.position.set(0, chestY + 0.12, 0.05); chain.rotation.x = Math.PI / 2.4; f.add(chain);
      rig.legs.forEach((pv) => { const sh2 = S(0.1 + leg * 0.2, team, 0, 0.07 - hipY, 0.05, 1.02, 0.4, 1.62, pv); sh2.castShadow = false; });
      const stripe = C(sh * 0.93, sh * 0.9, 0.05, tier >= 3 ? gold : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), 0, chestY - 0.42, 0); stripe.scale.z = 0.64 + U * 0.25;
    }
    if (tier >= 3) {   // 망토 · 금 어깨장식 · 광택 유니폼
      mats.shirt.metalness = 0.45; mats.shirt.roughness = 0.3;
      [-1, 1].forEach((s2) => S(arm * 1.2, gold, s2 * sh, chestY + 0.12, 0, 1.2, 0.5, 1.2));
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(sh * 2.1, 1.25, 1, 6), new THREE.MeshStandardMaterial({ color: hex(color === '#3a3a42' ? '#7c3aed' : color), side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3, emissive: 0x110022 }));
      cape.geometry.translate(0, -0.62, 0); cape.position.set(0, chestY + 0.05, -0.22 - U * 0.1); cape.rotation.x = 0.12; cape.castShadow = true; f.add(cape); f.userData.cape = cape;
      const trim = C(sh * 1.05, sh * 1.05, 0.04, gold, 0, chestY + 0.07, -0.2 - U * 0.1); trim.scale.z = 0.12;
    }
    if (tier >= 4) {   // 왕관 · 챔피언 벨트 · 황금 오라
      const crown = new THREE.Group(); crown.position.set(0, chestY + 0.62, 0); f.add(crown);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.08, 20), gold); crown.add(base);
      for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 8), gold); const a = (i / 6) * Math.PI * 2; sp.position.set(Math.sin(a) * 0.13, 0.09, Math.cos(a) * 0.13); crown.add(sp); }
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0x550010, metalness: 0.3, roughness: 0.2 })); gem.position.set(0, 0.02, 0.15); crown.add(gem);
      const belt = C(waist + 0.07, waist + 0.07, 0.14, gold, 0, hipY + 0.13, 0); belt.scale.z = 0.95;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.04), gold); plate.position.set(0, hipY + 0.13, waist * 0.72 + 0.06); f.add(plate);
      mats.shirt.emissive = hex(color === '#3a3a42' ? '#e98ce6' : color).multiplyScalar(0.18);
      const N = 70, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = 0.7 + Math.random() * 0.5; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 2.2; pos[i * 3 + 2] = Math.sin(a) * r; }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const aura = new THREE.Points(gg, new THREE.PointsMaterial({ color: 0xffd76a, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      f.add(aura); f.userData.aura = aura;
    }
    f.userData.tier = tier;
    f.scale.setScalar(1 + (U + L) * 0.08);
    f.userData.sy = f.scale.y;
    f.userData.top = (chestY + 0.75) * f.scale.y;
    return f;
  }
  // 이름표 (머리 위 말풍선)
  function nameTag(text, sub, me, live) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const x = c.getContext('2d');
    x.font = '800 64px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    const w = Math.min(500, Math.max(x.measureText(text).width + (live ? 70 : 40), 160));
    const left = (512 - w) / 2;
    x.fillStyle = me ? 'rgba(233,140,230,.95)' : 'rgba(17,17,24,.82)';
    x.beginPath(); x.roundRect ? x.roundRect(left, 8, w, 92, 46) : x.rect(left, 8, w, 92); x.fill();
    if (live) { x.fillStyle = '#22c55e'; x.beginPath(); x.arc(left + 36, 54, 12, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 256 + (live ? 16 : 0), 56);
    if (sub) { x.font = '700 34px -apple-system, "Apple SD Gothic Neo", sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(sub, 256, 132); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
    sp.scale.set(1.25, 0.39, 1);
    return sp;
  }
  let figs = [];
  function clearFigs() {
    figs.forEach((g) => { root.remove(g); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); }); });
    figs = [];
  }
  function build(opts) {
    clearFigs();
    const team = opts.team;
    if (!team) {
      const f = makeFigure(opts); root.add(f); figs.push(f);
      ring.material.color = hex(opts.color === '#3a3a42' ? '#e98ce6' : opts.color);
      camDist = 7.2; camLook = 1.35; camLift = 0;
      return;
    }
    buildGym(team);
  }
  let camDist = 7.2, camLook = 1.35, camLift = 0;


  /* ================= 🏋️ 볼류머 체육관 (다같이) ================= */
  const TASKS = {
    bench: { label: '💪 벤치프레스', station: 'bench' },
    squat: { label: '🏋️ 스쿼트 랙', station: 'rack' },
    run: { label: '🏃 러닝머신', station: 'tread' },
    curl: { label: '🧗 턱걸이', station: 'db' },
    stretch: { label: '🧘 스트레칭', station: 'mat' },
    rest: { label: '🥤 약수 한 사발', station: 'seat' },
    home: { label: '🏠 자기 짐에서 운동', station: 'home' },
    pray: { label: '🙏 기도 (스쿼트)', station: 'pray' },
    jail: { label: '🔒 수감 중', station: 'jail', hidden: true },
  };
  let gymScene = null, gymCam = null, stations = {}, agents = [], gymYaw = 0.25, onPick = null;
  let booths = {}, onBooth = null, memoData = {}, onStatue = null;
  let gymDist = 48, gymH = 26, gymTouched = 0;   // 산스장 카메라: 거리(줌) · 높이
  function buildGymScene() {
    /* ⛰️ 볼류머 산스장 — 산 정상을 평평하게 깎아 올린 헬스장 (구름 위) */
    gymScene = new THREE.Scene();
    const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256;
    const kx = sky.getContext('2d'), sg = kx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, '#26306a'); sg.addColorStop(0.4, '#7a5ea0'); sg.addColorStop(0.7, '#f39a6b'); sg.addColorStop(1, '#ffe0b0');
    kx.fillStyle = sg; kx.fillRect(0, 0, 4, 256);
    const skyT = new THREE.CanvasTexture(sky); skyT.encoding = THREE.sRGBEncoding;
    gymScene.background = skyT;
    gymScene.fog = new THREE.Fog(0xe7b9a8, 90, 220);
    gymCam = new THREE.PerspectiveCamera(46, 1, 0.1, 320);
    const M = (c, r = 0.85, m = 0.05, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e || 0x000000 });
    const MF = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
    const B = (w, h, d, mat, x, y, z, par = gymScene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
    const Cy = (r, h, mat, x, y, z, rx = 0, rz = 0, par = gymScene) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; par.add(o); return o; };
    // ── 🏟 실내 메가짐: 산 정상에 세운 거대한 실내 헬스장 (유리창 너머 산맥)
    const R = 18.5;   // 가운데 공용 구역 반지름 (각자 짐은 그 둘레)
    const HW = 40, HZ0 = -36, HZ1 = 28, HH = 17;   // 홀 크기: x ±40, z -36 ~ 28, 천장 17
    const FW = HW * 2, FD = HZ1 - HZ0, FZ = (HZ0 + HZ1) / 2;
    // 바닥: 고무매트 + 구역별 색 + 이음선
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), M(0x1c1d22, 0.95)); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, FZ); floor.receiveShadow = true; gymScene.add(floor);
    const zone = (w, d, x, z, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(c, 0.95)); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.receiveShadow = true; gymScene.add(m); };
    zone(R * 2 - 1, R * 2 - 1, 0, 0, 0x23252b);          // 가운데 공용
    zone(14, 50, -32, -4, 0x2a2420);                     // 왼쪽 머신존
    zone(14, 50, 32, -4, 0x1f2a2a);                      // 오른쪽 유산소존
    zone(44, 9, 0, -30.5, 0x2b2230);                     // 뒤 대불존
    for (let i = -38; i <= 38; i += 4) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.04, FD), M(0x15161a, 1)); l.rotation.x = -Math.PI / 2; l.position.set(i, 0.012, FZ); gymScene.add(l); }
    for (let z = HZ0 + 2; z < HZ1; z += 4) { const l = new THREE.Mesh(new THREE.PlaneGeometry(FW, 0.04), M(0x15161a, 1)); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.012, z); gymScene.add(l); }
    // 벽: 안쪽에서만 보이게(바깥 카메라에선 투명 → 인형집처럼 들여다봄) · 아래는 벽, 위는 큰 유리창
    const wallM = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.9, side: THREE.FrontSide });
    const glassM = new THREE.MeshStandardMaterial({ color: 0x9fc4ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.16, side: THREE.FrontSide, depthWrite: false });
    const frameM = M(0x14151a, 0.5, 0.6);
    const wall = (w, x, z, ry, cols = true) => {
      const lo = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), wallM); lo.position.set(x, 1.5, z); lo.rotation.y = ry; lo.receiveShadow = true; gymScene.add(lo);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, HH - 3), glassM); gl.position.set(x, 3 + (HH - 3) / 2, z); gl.rotation.y = ry; gymScene.add(gl);
      const n = Math.round(w / 6);
      for (let i = 0; cols && i <= n; i++) {   // 창틀 기둥
        const t = -w / 2 + (w * i) / n, c = Math.cos(ry), s2 = Math.sin(ry);
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, HH, 0.35), frameM); col.position.set(x + t * c, HH / 2, z - t * s2); gymScene.add(col);
      }
    };
    wall(FW, 0, HZ0, 0);                 // 뒤 (안쪽을 봄 = +z)
    wall(FD, -HW, FZ, Math.PI / 2);      // 왼쪽
    wall(FD, HW, FZ, -Math.PI / 2);      // 오른쪽
    wall(FW, 0, HZ1, Math.PI, false);    // 앞 (기둥 없음: 카메라 쪽)
    // 천장: 아래에서만 보임 + 조명 패널 줄
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({ color: 0x18191d, roughness: 1 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, HH, FZ); gymScene.add(ceil);
    const lampM = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (let x = -32; x <= 32; x += 8) for (let z = HZ0 + 6; z < HZ1 - 2; z += 8) { const l = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.6), lampM); l.rotation.x = Math.PI / 2; l.position.set(x, HH - 0.05, z); gymScene.add(l); }
    // 창밖: 먼 산맥 (유리 너머로 보임)
    const snow = M(0xf4f1f6, 0.8);
    const peak = (a, r, h, col) => {
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6), MF(col)); m.position.set(x, -8 + h / 2, z); m.rotation.y = a * 3; gymScene.add(m);
      const s2 = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9 * 0.22, h * 0.22, 6), snow); s2.position.set(x, -8 + h - h * 0.11 + 0.02, z); s2.rotation.y = a * 3; gymScene.add(s2);
    };
    for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2 + (i % 3) * 0.13; peak(a, 70 + (i * 13) % 25, 18 + (i * 7) % 14, [0x5b4f7c, 0x55497a, 0x63577f, 0x5d5480][i % 4]); }
    const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,240,200,1)', 'rgba(255,170,110,0)'), transparent: true, depthWrite: false, fog: false }));
    sunS.scale.set(30, 30, 1); sunS.position.set(-30, 18, -110); gymScene.add(sunS);
    // 조명 (실내: 밝고 고르게)
    gymScene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3a48, 0.7));
    const sun = new THREE.DirectionalLight(0xfff0dd, 0.85); sun.position.set(-10, 24, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 36, bottom: -36, far: 90 }); gymScene.add(sun);
    // ── 구역 꾸미기
    const blk = M(0x1d1e22, 0.5, 0.5), stl = M(0xd9dbe0, 0.25, 0.9), redM = M(0xd83a3a, 0.5, 0.3), padM = M(0x2b2c31, 0.6, 0.1);
    // 왼쪽 머신존: 케이블·레그프레스·체스트프레스 줄줄이
    for (let r = 0; r < 6; r++) for (let c = 0; c < 2; c++) {
      const x = -36 + c * 6, z = -24 + r * 8, g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.PI / 2; gymScene.add(g);
      if ((r + c) % 3 === 0) { B(0.14, 2.6, 0.14, blk, -1, 1.3, 0, g); B(0.14, 2.6, 0.14, blk, 1, 1.3, 0, g); B(2.1, 0.12, 0.12, blk, 0, 2.6, 0, g); B(0.35, 0.8, 0.2, blk, -1, 0.5, 0, g); B(0.35, 0.8, 0.2, blk, 1, 0.5, 0, g); }
      else if ((r + c) % 3 === 1) { B(0.9, 0.12, 2.2, blk, 0, 0.1, 0, g); const rl = B(0.12, 0.12, 2.0, blk, 0, 0.9, -0.2, g); rl.rotation.x = 0.7; const st = B(0.7, 0.12, 0.7, padM, 0, 0.55, 0.7, g); st.rotation.x = -0.6; [-0.5, 0.5].forEach((dx) => Cy(0.28, 0.08, redM, dx, 1.25, -0.6, 0, Math.PI / 2, g)); }
      else { B(1.2, 1.6, 0.25, blk, 0, 0.8, -0.7, g); B(0.6, 0.12, 0.6, padM, 0, 0.5, 0.1, g); B(0.6, 0.8, 0.1, padM, 0, 0.9, -0.3, g); [-0.55, 0.55].forEach((dx) => B(0.08, 0.08, 0.7, stl, dx, 1.2, 0.1, g)); }
    }
    // 오른쪽 유산소존: 러닝머신 2줄 (창밖 산맥 보며 달리기)
    for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) {
      const g = new THREE.Group(); g.position.set(30 + r * 6, 0, -26 + i * 6); g.rotation.y = -Math.PI / 2; gymScene.add(g);
      B(0.8, 0.22, 1.9, blk, 0, 0.11, 0, g); B(0.62, 0.02, 1.7, M(0x0e0e10, 0.9), 0, 0.23, 0, g);
      const con = B(0.78, 0.32, 0.14, blk, 0, 1.38, -0.92, g); con.rotation.x = -0.5;
      B(0.5, 0.18, 0.02, M(0x4fd1ff, 0.3, 0.1, 0x1a6a8a), 0, 1.42, -0.86, g).rotation.x = -0.5;
      [-0.36, 0.36].forEach((dx) => { const u = B(0.06, 1.2, 0.06, blk, dx, 0.8, -0.85, g); u.rotation.x = 0.15; });
    }
    // 뒤쪽 파워랙 줄 (대불 양옆)
    [-26, -20, 20, 26].forEach((x) => {
      const z = -30;
      [[-0.75, -0.5], [0.75, -0.5], [-0.75, 0.5], [0.75, 0.5]].forEach(([dx, dz]) => B(0.09, 2.4, 0.09, blk, x + dx, 1.2, z + dz));
      B(1.6, 0.08, 0.08, blk, x, 2.4, z - 0.5); B(1.6, 0.08, 0.08, blk, x, 2.4, z + 0.5);
      B(1.9, 0.05, 1.6, M(0x4a3524, 0.9), x, 0.03, z);
      const bar = Cy(0.025, 2.1, stl, x, 1.55, z, 0, Math.PI / 2); [-0.88, 0.88].forEach((o) => Cy(0.3, 0.09, M(0x121214, 0.7, 0.2), 0, o, 0, 0, 0, bar));
    });
    // 앞쪽 입구: 안내데스크 + 개찰구
    B(8, 1.1, 1.4, M(0xe9e4da, 0.5, 0.1), 0, 0.55, 24.5); B(8.2, 0.08, 1.6, M(0x16171b, 0.4, 0.5), 0, 1.14, 24.5);
    [-5.5, -4, 4, 5.5].forEach((x) => { B(0.2, 1.0, 1.2, stl, x, 0.5, 21); });
    // 정상석 + 간판
    const stone = document.createElement('canvas'); stone.width = 256; stone.height = 512;
    const tx = stone.getContext('2d'); tx.fillStyle = '#d8d3c8'; tx.fillRect(0, 0, 256, 512);
    tx.fillStyle = '#3a3530'; tx.textAlign = 'center'; tx.font = '900 92px -apple-system, "Apple SD Gothic Neo", sans-serif';
    ['볼', '류', '머', '봉'].forEach((c, i) => tx.fillText(c, 128, 110 + i * 96));
    tx.font = '700 40px -apple-system, sans-serif'; tx.fillText('1,000m', 128, 490);
    const stT = new THREE.CanvasTexture(stone); stT.encoding = THREE.sRGBEncoding;
    const stM = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.35), [M(0xc9c3b8), M(0xc9c3b8), M(0xc9c3b8), M(0xc9c3b8), new THREE.MeshStandardMaterial({ map: stT, roughness: 0.9 }), M(0xc9c3b8)]);
    stM.position.set(3.2, 0.7, 7.6); stM.rotation.y = -0.25; stM.castShadow = true; gymScene.add(stM);
    B(1.0, 0.18, 0.6, M(0x8a8478), 3.2, 0.09, 7.6);
    const sign = document.createElement('canvas'); sign.width = 1024; sign.height = 220;
    const sx = sign.getContext('2d'); sx.fillStyle = '#16171b'; sx.fillRect(0, 0, 1024, 220); sx.strokeStyle = '#e8b923'; sx.lineWidth = 12; sx.strokeRect(10, 10, 1004, 200);
    sx.fillStyle = '#fff'; sx.font = '900 104px -apple-system, "Apple SD Gothic Neo", sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText('⛰ 산스장 MEGA GYM', 512, 116);
    const st = new THREE.CanvasTexture(sign); st.encoding = THREE.sRGBEncoding;
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshStandardMaterial({ map: st, roughness: 0.6, emissive: 0x222222 }));
    signM.position.set(0, 2.1, 25.3); gymScene.add(signM);
    // 🖼 뒤쪽 벽: 큰 사진 액자 + 그 아래 작은 광고판 3개 (가로로)
    const BBS = [   // 날짜부터 바뀌는 광고판 모델 (가장 최근 것)
      { from: '', src: 'billboard.jpg', l1: '볼륨은', l2: '배신하지 않는다', sub: '오늘도 한 세트 더 — 해발 1,000m' },
      { from: '2026-11-03', src: 'billboard2.jpg', l1: '단백질은', l2: '배신하지 않는다', sub: '오늘의 식단: 치킨 🍗 — 해발 1,000m' },
      { from: '2026-11-04', src: 'billboard3.jpg', l1: '당 충전도', l2: '훈련이다', sub: '오늘의 보충제: 사탕 🍭 — 해발 1,000m' },
      { from: '2026-11-05', src: 'billboard4.jpg', l1: '관리도', l2: '운동이다', sub: '오늘의 셀프케어 🧖 — 해발 1,000m' },
      { from: '2026-11-06', src: 'billboard5.jpg', l1: '포즈도', l2: '근력이다', sub: '오늘의 브이 ✌️ — 해발 1,000m' },
      { from: '2026-11-07', src: 'billboard6.jpg', l1: '무표정도', l2: '집중이다', sub: '오늘의 출근길 🚇 — 해발 1,000m' },
    ];
    const today = typeof todayStr === 'function' ? todayStr() : '';
    const black = M(0x1d1e22, 0.5, 0.5), steel = M(0xd9dbe0, 0.25, 0.9), plate = M(0x121214, 0.7, 0.2), red = M(0xd83a3a, 0.5, 0.3), pad = M(0x2b2c31, 0.6, 0.1), conc = M(0xa9a59c, 0.95);
    const praySlots = [];
    const WZ = HZ0 + 0.2;   // 뒤 벽 바로 앞
    const glow = (x, y, z, k = 1.4) => { const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,240,200,.9)', 'rgba(255,240,200,0)'), transparent: true, depthWrite: false })); gl.scale.set(k, k, 1); gl.position.set(x, y, z); gymScene.add(gl); };
    // 광고 그리기 (사진 + 문구)
    function adTexture(bb) {
      const W = 1400, H = 520, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d'); cx.fillStyle = '#111'; cx.fillRect(0, 0, W, H);
      const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
      const text = () => {
        const g = cx.createLinearGradient(0, 0, 640, 0); g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g; cx.fillRect(0, 0, 640, H);
        cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
        cx.fillStyle = '#e8b923'; cx.font = '800 34px -apple-system, "Apple SD Gothic Neo", sans-serif'; cx.fillText('VOLUMER 산스장 공식 모델', 56, 150);
        cx.fillStyle = '#fff'; cx.font = '900 76px -apple-system, "Apple SD Gothic Neo", sans-serif'; cx.fillText(bb.l1, 52, 260); cx.fillText(bb.l2, 52, 350);
        cx.fillStyle = 'rgba(255,255,255,.75)'; cx.font = '600 30px -apple-system, "Apple SD Gothic Neo", sans-serif'; cx.fillText(bb.sub, 56, 420);
        tex.needsUpdate = true;
      };
      if (bb.src) { const img = new Image(); img.onload = () => { cx.drawImage(img, 0, 0, W, H); text(); }; img.onerror = text; img.src = bb.src; }
      else { const g2 = cx.createLinearGradient(0, 0, W, H); g2.addColorStop(0, '#2e1065'); g2.addColorStop(1, '#0b0b12'); cx.fillStyle = g2; cx.fillRect(0, 0, W, H); text(); }
      return tex;
    }
    // 광고판 3개: 오늘까지 공개된 모델 중 최근 3명 (모자라면 볼류머 광고)
    const shown = BBS.filter((b) => b.from <= today).slice(-3);
    const fillers = [{ l1: '오늘도', l2: '한 세트 더', sub: 'VOLUMER MEGA GYM — 해발 1,000m' }, { l1: '광고 문의', l2: '단톡방으로', sub: '다음 모델은 바로 당신 📸' }];
    while (shown.length < 3) shown.push(fillers[(shown.length + 1) % 2]);
    const aw = 7.2, ah = aw * 520 / 1400, ay = 0.9 + ah / 2, gap = 0.6;
    shown.forEach((bb, i) => {
      const x = (i - 1) * (aw + gap);
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), new THREE.MeshBasicMaterial({ map: adTexture(bb), toneMapped: false }));
      ad.position.set(x, ay, WZ + 0.12); gymScene.add(ad);
      B(aw + 0.25, ah + 0.25, 0.12, M(0x15161a, 0.5, 0.6), x, ay, WZ + 0.02);
    });
    // 큰 사진 액자 (wall-photo.jpg — 비율에 맞춰 크기 조절)
    const wallPhoto = new THREE.Group(); gymScene.add(wallPhoto);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.3 });
    const photoTop = HH - 0.8, maxH = photoTop - (ay + ah / 2) - 0.8;
    const placePhoto = (aspect, tex) => {
      while (wallPhoto.children.length) wallPhoto.remove(wallPhoto.children[0]);
      let ph = maxH, pw = ph * aspect; if (pw > 30) { pw = 30; ph = pw / aspect; }
      const cy = photoTop - ph / 2;
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: 0x2a2c33 }));
      pic.position.set(0, cy, WZ + 0.2); wallPhoto.add(pic);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.8, ph + 0.8, 0.2), frameMat); fr.position.set(0, cy, WZ + 0.06); wallPhoto.add(fr);
      if (!tex) {
        const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d');
        x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '800 44px -apple-system, "Apple SD Gothic Neo", sans-serif'; x.textAlign = 'center'; x.fillText('🖼 사진 걸 자리', 256, 140);
        const t = new THREE.CanvasTexture(c); const lab = new THREE.Mesh(new THREE.PlaneGeometry(pw * 0.6, pw * 0.3), new THREE.MeshBasicMaterial({ map: t, transparent: true })); lab.position.set(0, cy, WZ + 0.25); wallPhoto.add(lab);
      }
      [-pw / 3, 0, pw / 3].forEach((x) => glow(x, photoTop + 0.4, WZ + 0.8, 2.2));
    };
    placePhoto(4 / 3, null);
    (() => { const img = new Image(); img.onload = () => { const t = new THREE.Texture(img); t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; placePhoto(img.width / img.height, t); }; img.onerror = () => {}; img.src = 'wall-photo.jpg'; })();
    wallPhoto.userData.statue = true;
    gymScene.userData.statue = wallPhoto;
    // 벽 앞 기도 자리 (사진을 바라봄)
    (() => {
      const zc = WZ + 7, face = Math.PI;
      const matM = M(0xa0342a, 0.9);
      [-1.6, 0, 1.6].forEach((x) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 1.2), matM); m.position.set(x, 0.03, zc); gymScene.add(m);
        praySlots.push({ x, z: zc, face, y: 0.05, busy: null });
      });
      const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 0.5, 12), M(0x6b5a3a, 0.5, 0.6)); burner.position.set(0, 0.25, zc - 1.6); gymScene.add(burner);
      const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,.55)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false })); smoke.scale.set(1.2, 2.4, 1); smoke.position.set(0, 1.5, zc - 1.6); gymScene.add(smoke);
    })();
    // 소나무 몇 그루 (가장자리)
    const trunkM = M(0x5a3b24), pineM = M(0x2f5a3a, 0.9), pineM2 = M(0x3b6b44, 0.9);
    const potM = M(0xd9d3c7, 0.6);
    const pine = (x, z, k) => { Cy(0.55 * k, 0.6, potM, x, 0.3, z); Cy(0.12 * k, 1.2 * k, trunkM, x, 0.6 * k, z); [0, 1, 2].forEach((j) => { const c = new THREE.Mesh(new THREE.ConeGeometry((1.0 - j * 0.25) * k, 1.3 * k, 8), j % 2 ? pineM2 : pineM); c.position.set(x, (1.4 + j * 0.75) * k, z); c.castShadow = true; gymScene.add(c); }); };
    [[-8.6, -3.6, 1.1], [8.4, -4.4, 1.0], [7.9, 4.6, 0.85], [-4.6, -8.6, 0.8], [8.2, 5.4, 0.8]].forEach(([x, z, k]) => pine(x, z, k));
    stations = { bench: [], rack: [], tread: [], db: [], mat: [], seat: [], jail: [], pray: praySlots };
    // 벤치프레스 2대 (왼쪽)
    [-1.3, 1.3].forEach((dz) => {
      const x = -5.2, z = -1 + dz;
      B(1.5, 0.14, 0.42, pad, x, 0.48, z); B(0.1, 0.42, 0.1, black, x - 0.5, 0.21, z); B(0.1, 0.42, 0.1, black, x + 0.5, 0.21, z);
      Cy(0.04, 1.0, black, x - 0.55, 0.6, z - 0.45); Cy(0.04, 1.0, black, x - 0.55, 0.6, z + 0.45);
      B(0.5, 0.06, 1.1, black, x - 0.55, 0.05, z);
      const bar = Cy(0.025, 2.0, steel, x - 0.55, 1.3, z, Math.PI / 2);
      [-0.78, 0.78].forEach((o) => { const pl = Cy(0.26, 0.07, red, 0, o, 0, 0, 0, bar); pl.rotation.set(0, 0, 0); });
      stations.bench.push({ x: x + 0.15, z, face: Math.PI / 2, bar, barX: x - 0.55, busy: null });
    });
    // 파워랙 2개 (스쿼트)
    [-2.2, 0.4].forEach((x) => {
      const z = -4.4;
      [[-0.75, -0.5], [0.75, -0.5], [-0.75, 0.5], [0.75, 0.5]].forEach(([dx, dz]) => B(0.09, 2.4, 0.09, black, x + dx, 1.2, z + dz));
      [[-0.5], [0.5]].forEach(([dz]) => B(1.6, 0.08, 0.08, black, x, 2.4, z + dz));
      B(0.08, 0.08, 1.0, black, x - 0.75, 2.4, z); B(0.08, 0.08, 1.0, black, x + 0.75, 2.4, z);
      B(1.7, 0.04, 1.3, M(0x4a3524, 0.9), x, 0.03, z);
      const bar = Cy(0.025, 2.1, steel, x, 1.55, z + 0.05, 0, Math.PI / 2);
      [-0.88, 0.88].forEach((o) => Cy(0.3, 0.09, plate, 0, o, 0, 0, 0, bar));
      stations.rack.push({ x, z: z + 0.05, face: 0, bar, busy: null });
    });
    // 러닝머신 3대 (오른쪽 뒤, 구름 바다 보면서 달리기)
    [3.1, 4.6, 6.1].forEach((x) => {
      const z = -3.4;
      const fr = new THREE.Group(); fr.position.set(x, 0, z); gymScene.add(fr);
      B(0.8, 0.22, 1.9, black, 0, 0.11, 0, fr);
      B(0.62, 0.02, 1.7, M(0x0e0e10, 0.9), 0, 0.23, 0, fr);
      [-0.36, 0.36].forEach((dx) => { const u = B(0.06, 1.2, 0.06, black, dx, 0.8, -0.85, fr); u.rotation.x = 0.15; });
      const con = B(0.78, 0.32, 0.14, black, 0, 1.38, -0.92, fr); con.rotation.x = -0.5;
      B(0.5, 0.18, 0.02, M(0x4fd1ff, 0.3, 0.1, 0x1a6a8a), 0, 1.42, -0.86, fr).rotation.x = -0.5;
      stations.tread.push({ x, z: z + 0.15, y: 0.24, face: Math.PI, busy: null });
    });
    // 턱걸이 파워타워 3대 (오른쪽)
    [[5.6, -0.6, 2.3], [5.6, 0.9, 2.3], [5.6, 2.4, 2.3]].forEach(([x, z, h]) => {
      B(0.09, h + 0.1, 0.09, black, x + 0.35, (h + 0.1) / 2, z - 0.5); B(0.09, h + 0.1, 0.09, black, x + 0.35, (h + 0.1) / 2, z + 0.5);
      B(0.7, 0.06, 0.09, black, x + 0.05, 0.03, z - 0.5); B(0.7, 0.06, 0.09, black, x + 0.05, 0.03, z + 0.5);
      Cy(0.03, 1.15, steel, x, h, z, Math.PI / 2);
      B(0.06, 0.3, 0.35, pad, x + 0.35, 1.2, z);
      stations.db.push({ x: x + 0.02, z, face: Math.PI / 2, bar: h, busy: null });
    });
    // 스트레칭 매트 (가운데 앞)
    const matCols = [0x7a5cff, 0x2fbf8f, 0xff7a59, 0x3aa0ff, 0xf2c14e];
    [[-1.6, 2.4], [0, 2.4], [1.6, 2.4], [-0.8, 3.9], [0.8, 3.9]].forEach(([x, z], i) => {
      B(0.75, 0.025, 1.6, M(matCols[i], 0.9), x, 0.025, z);
      stations.mat.push({ x, z, face: 0, y: 0.04, busy: null });
    });
    // 장식 머신: 랫풀다운 · 레그프레스 · 케이블 크로스오버 · 덤벨 랙
    (() => { const x = -2.6, z = -7.0;   // 랫풀다운
      B(0.12, 2.5, 0.12, black, x, 1.25, z - 0.3); B(0.7, 0.08, 0.12, black, x, 2.5, z - 0.3).position.z = z - 0.1;
      Cy(0.02, 1.0, steel, x, 1.9, z + 0.2, 0, Math.PI / 2); B(0.4, 0.5, 0.2, plate, x, 0.4, z - 0.45); B(0.5, 0.1, 0.45, pad, x, 0.5, z + 0.45); B(0.08, 0.5, 0.08, black, x, 0.25, z + 0.45); })();
    (() => { const x = 2.4, z = -7.2;    // 레그프레스
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = 0.25; gymScene.add(g);
      B(0.9, 0.12, 2.2, black, 0, 0.1, 0, g); const rail = B(0.12, 0.12, 2.0, black, 0, 0.9, -0.2, g); rail.rotation.x = 0.7;
      const seat = B(0.7, 0.12, 0.7, pad, 0, 0.55, 0.7, g); seat.rotation.x = -0.6;
      B(0.8, 0.6, 0.1, steel, 0, 1.3, -0.8, g).rotation.x = 0.4; [-0.5, 0.5].forEach((dx) => Cy(0.28, 0.08, red, dx, 1.25, -0.6, 0, Math.PI / 2, g)); })();
    (() => { const z = -5.6;             // 케이블 크로스오버 (왼쪽 뒤)
      [-7.0, -4.6].forEach((x) => { B(0.14, 2.6, 0.14, black, x, 1.3, z); B(0.35, 0.8, 0.2, plate, x, 0.5, z); });
      B(2.55, 0.12, 0.12, black, -5.8, 2.6, z); Cy(0.015, 1.2, steel, -7.0, 1.8, z + 0.3, 0.6); Cy(0.015, 1.2, steel, -4.6, 1.8, z + 0.3, 0.6); })();
    (() => { const x = -8.3, z = 0.6;    // 덤벨 랙
      B(0.6, 0.06, 2.6, black, x, 0.7, z); B(0.6, 0.06, 2.6, black, x, 0.35, z); [-1.2, 1.2].forEach((dz) => B(0.08, 0.75, 0.5, black, x, 0.37, z + dz));
      for (let i = 0; i < 6; i++) { const dz = -1.05 + i * 0.42; [0.76, 0.41].forEach((y, j) => { const d = Cy(0.02, 0.32, steel, x, y, z + dz, 0, Math.PI / 2); [-0.12, 0.12].forEach((o) => Cy(0.06 + i * 0.008 + j * 0.01, 0.06, plate, 0, o, 0, 0, 0, d)); }); } })();
    // 🔒 볼류머 교도소 (광고판 옆, 오른쪽 뒤) — 어제 운동 안 한 사람 수감. 천장 없이 위에서 다 보이게
    const px = 5.0, pz = -6.9, JW = 3.0, JD = 2.4, JH = 2.5;
    const iron = M(0x2c2f36, 0.45, 0.8), ironL = M(0x4a4e57, 0.4, 0.8);
    B(JW + 0.3, 0.16, JD + 0.3, M(0x8d8a84, 0.95), px, 0.08, pz);   // 콘크리트 바닥
    const barRow = (x0, z0, x1, z1, skip) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 0.24);
      for (let i = 0; i <= n; i++) { if (skip && skip(i, n)) continue; const t = i / n; Cy(0.028, JH, iron, x0 + (x1 - x0) * t, 0.16 + JH / 2, z0 + (z1 - z0) * t); }
    };
    const x0 = px - JW / 2, x1 = px + JW / 2, z0 = pz - JD / 2, z1 = pz + JD / 2;
    barRow(x0, z0, x1, z0); barRow(x0, z0, x0, z1); barRow(x1, z0, x1, z1);
    barRow(x0, z1, x1, z1, (i, n) => i > n * 0.55 && i < n * 0.85);   // 앞쪽 문 자리
    [0.16 + JH, 0.16 + JH * 0.55, 0.22].forEach((y) => {   // 가로 띠 (천장은 뚫림)
      B(JW + 0.06, 0.08, 0.08, ironL, px, y, z0); B(JW + 0.06, 0.08, 0.08, ironL, px, y, z1);
      B(0.08, 0.08, JD + 0.06, ironL, x0, y, pz); B(0.08, 0.08, JD + 0.06, ironL, x1, y, pz);
    });
    [x0, x1].forEach((x) => [z0, z1].forEach((z) => B(0.14, JH + 0.1, 0.14, ironL, x, 0.16 + JH / 2, z)));
    // 철창 문 (살짝 열린 채 자물쇠)
    const door = new THREE.Group(); const dx0 = x0 + JW * 0.55; door.position.set(dx0, 0, z1); door.rotation.y = -0.18; gymScene.add(door);
    for (let i = 0; i <= 5; i++) Cy(0.028, JH - 0.1, iron, i * 0.2, 0.16 + JH / 2, 0, 0, 0, door);
    [0.35, JH * 0.55, JH].forEach((y) => B(1.08, 0.07, 0.07, ironL, 0.5, y, 0, door));
    B(0.16, 0.2, 0.1, M(0xd4a017, 0.3, 0.9), 0.95, 1.2, 0.08, door);
    // 간판
    const pl = document.createElement('canvas'); pl.width = 1024; pl.height = 256;
    const plx = pl.getContext('2d'); plx.fillStyle = '#16171b'; plx.fillRect(0, 0, 1024, 256);
    plx.fillStyle = '#e23b3b'; plx.fillRect(0, 0, 1024, 24); plx.fillRect(0, 232, 1024, 24);
    plx.textAlign = 'center'; plx.fillStyle = '#fff'; plx.font = '900 104px -apple-system, "Apple SD Gothic Neo", sans-serif'; plx.fillText('🔒 볼류머 교도소', 512, 128);
    plx.fillStyle = '#ffb3b3'; plx.font = '700 46px -apple-system, "Apple SD Gothic Neo", sans-serif'; plx.fillText('죄목: 어제 운동 안 함', 512, 204);
    const plT = new THREE.CanvasTexture(pl); plT.encoding = THREE.sRGBEncoding;
    const plM = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: plT, toneMapped: false }));
    plM.position.set(px, JH + 0.62, z0 + 0.05); gymScene.add(plM);
    Cy(0.03, 0.5, ironL, px - 1.0, JH + 0.25 + 0.16, z0); Cy(0.03, 0.5, ironL, px + 1.0, JH + 0.25 + 0.16, z0);
    // 감방 안: 2층 철침대 · 변기 · 쇠공
    const bx = px + JW / 2 - 0.55, bzz = pz - 0.3;
    [[0.5], [1.35]].forEach(([y]) => { B(0.8, 0.08, 1.9, ironL, bx, y, bzz); B(0.72, 0.1, 1.8, M(0xd9d4c4, 0.95), bx, y + 0.09, bzz); });
    [[-0.38, -0.92], [0.38, -0.92], [-0.38, 0.92], [0.38, 0.92]].forEach(([dx, dz]) => B(0.06, 1.6, 0.06, ironL, bx + dx, 0.95, bzz + dz));
    const wc = M(0xf4f4f4, 0.3, 0.1);
    Cy(0.2, 0.36, wc, px - JW / 2 + 0.35, 0.34, pz - JD / 2 + 0.35); B(0.42, 0.42, 0.16, wc, px - JW / 2 + 0.35, 0.6, pz - JD / 2 + 0.16);
    [[px - 0.8, pz + 0.5], [px - 0.1, pz + 0.6], [px - 0.5, pz - 0.6]].forEach(([x, z]) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), M(0x1a1a1e, 0.4, 0.7)); ball.position.set(x + 0.28, 0.33, z + 0.12); ball.castShadow = true; gymScene.add(ball);
    });
    // 수감자 자리: 앞쪽 철창 붙잡는 줄 + 뒤쪽 침대 · 바닥
    [[px - 1.1, pz + 0.85], [px - 0.4, pz + 0.85], [px + 0.3, pz + 0.85], [px - 0.95, pz - 0.3], [px - 0.3, pz - 0.6], [px + 0.1, pz + 0.1]].forEach(([x, z], i) =>
      stations.jail.push({ x, z, face: 0, y: 0.16, grip: i < 3, busy: null }));
    // 약수터 + 나무 벤치 (쉼터)
    B(0.9, 0.85, 0.6, conc, -8.4, 0.43, 1.9); Cy(0.03, 0.5, steel, -8.05, 0.8, 1.9, 0, Math.PI / 2);
    Cy(0.025, 0.5, new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7, emissive: 0x1b4a6b }), -7.82, 0.53, 1.9);
    B(0.6, 0.16, 0.45, conc, -7.82, 0.08, 1.9);
    const wood = M(0x8a5a34, 0.85);
    const sbx = 5.4, sbz = 5.3;
    B(2.6, 0.1, 0.5, wood, sbx, 0.5, sbz); B(2.6, 0.5, 0.08, wood, sbx, 0.8, sbz - 0.25);
    [-1.1, 1.1].forEach((dx) => B(0.1, 0.5, 0.45, iron, sbx + dx, 0.25, sbz));
    [[-0.8, 0], [0, 0], [0.8, 0]].forEach(([dx, dz]) => stations.seat.push({ x: sbx + dx, z: sbz + 0.12, face: 0, sit: 0.72, busy: null }));
  }

  // 각 동작 포즈 (매 프레임)
  function pose(a, s) {
    const f = a.fig, rig = f.userData.rig, t = s * (a.speed || 1) + a.phase;
    f.rotation.set(0, 0, 0); f.position.set(0, 0, 0);
    rig.legs.forEach((l) => l.rotation.set(0, 0, 0)); rig.arms.forEach((r) => r.rotation.set(0, 0, 0));
    if (a.db) a.db.forEach((d) => (d.visible = false));
    if (f.userData.cape) f.userData.cape.rotation.x = 0.12 + (a.mode === 'walk' ? 0.35 : 0) + Math.sin(s * 2.5 + a.phase) * 0.08;
    if (f.userData.aura) f.userData.aura.rotation.y = s * 0.6;
    if (a.mode === 'walk') {
      const w = Math.sin(t * 7) * 0.55;
      rig.legs[0].rotation.x = w; rig.legs[1].rotation.x = -w; rig.arms[0].rotation.x = -w * 0.8; rig.arms[1].rotation.x = w * 0.8;
      f.position.y = Math.abs(Math.cos(t * 7)) * 0.04;
      return;
    }
    const k = a.task;
    if (k === 'run') {   // 러닝머신 달리기
      const w = Math.sin(t * 9) * 0.8;
      rig.legs[0].rotation.x = w; rig.legs[1].rotation.x = -w;
      rig.arms[0].rotation.x = -w * 0.9; rig.arms[1].rotation.x = w * 0.9;
      f.rotation.x = 0.12;
      f.position.y = a.slot.y + Math.abs(Math.cos(t * 9)) * 0.06;
    } else if (k === 'bench') {
      const rep = (Math.sin(t * 2.4) + 1) / 2;
      f.rotation.x = -Math.PI / 2; f.position.set(0, 0.6, 0);
      rig.legs.forEach((l) => (l.rotation.x = 1.3));
      rig.arms.forEach((r) => (r.rotation.x = -Math.PI / 2 - 0.2 * 0 + 0));
      rig.arms.forEach((r) => { r.rotation.x = Math.PI; r.rotation.z = (r === rig.arms[0] ? -1 : 1) * (0.6 - rep * 0.5); });
      if (a.slot.bar) a.slot.bar.position.y = 1.0 + rep * 0.45;
    } else if (k === 'squat') {
      const rep = (Math.sin(t * 2) + 1) / 2;
      f.position.y = -rep * 0.38;
      rig.legs.forEach((l) => (l.rotation.x = -rep * 1.1));
      f.rotation.x = rep * 0.25;
      rig.arms.forEach((r, i) => { r.rotation.x = -2.6; r.rotation.z = (i ? 1 : -1) * 0.5; });
      if (a.slot.bar) a.slot.bar.position.y = 1.55 + (1 - rep) * 0 - rep * 0.38 + 0.05;
    } else if (k === 'curl') {   // 철봉 턱걸이
      const rep = (Math.sin(t * 2.2) + 1) / 2;
      rig.arms.forEach((r, i) => { r.rotation.x = Math.PI; r.rotation.z = (i ? -1 : 1) * 0.25; });
      f.position.y = (a.slot.bar || 2.2) - 2.25 + rep * 0.45;
      rig.legs.forEach((l, i) => (l.rotation.x = 0.35 + (i ? 0.1 : 0)));
    } else if (k === 'stretch') {   // 허리돌리기
      f.position.y = a.slot.y || 0.13;
      f.rotation.y = Math.sin(t * 1.8) * 0.75;
      rig.arms.forEach((r) => (r.rotation.x = -1.35));
    } else if (k === 'jail') {   // 🔒 철창 붙잡고 흔들기 / 바닥에 쭈그려 앉기
      f.position.y = a.slot.y || 0.16;
      if (a.slot.grip) {
        const sh = Math.sin(t * 6) * Math.max(0, Math.sin(t * 0.6));
        f.position.z = 0.12 + sh * 0.05;
        rig.arms.forEach((r, i) => { r.rotation.x = -1.9; r.rotation.z = (i ? 1 : -1) * 0.25; });
        f.rotation.y = Math.sin(t * 0.9) * 0.15;
      } else {
        f.position.y = (a.slot.y || 0.16) - 0.45;
        rig.legs.forEach((l) => (l.rotation.x = -1.5));
        rig.arms.forEach((r) => (r.rotation.x = -0.9));
        f.rotation.x = 0.35;   // 고개 푹
      }
    } else if (k === 'pray') {   // 🙏 기도 = 스쿼트 + 합장
      const rep = (Math.sin(t * 1.8) + 1) / 2;
      f.position.y = (a.slot.y || 0) - rep * 0.36;
      rig.legs.forEach((l) => (l.rotation.x = -rep * 1.1));
      f.rotation.x = rep * 0.2;
      rig.arms.forEach((r, i) => { r.rotation.x = -1.35; r.rotation.z = (i ? -1 : 1) * 0.42; });
    } else if (k === 'home') {   // 🏠 내 짐: 덤벨 번갈아 컬
      const c1 = (Math.sin(t * 2.6) + 1) / 2, c2 = (Math.sin(t * 2.6 + Math.PI) + 1) / 2;
      rig.arms[0].rotation.x = -c1 * 1.9; rig.arms[1].rotation.x = -c2 * 1.9;
      f.position.y = 0.12;
    } else if (k === 'rest') {
      f.position.y = (a.slot.sit || 0.5) - 0.95 + 0.05;
      rig.legs.forEach((l) => (l.rotation.x = -1.45));
      rig.arms[1].rotation.x = -1.4 - Math.max(0, Math.sin(t * 0.7)) * 0.5;   // 물 마시기
    }
  }

  function freeSlot(station) { const list = stations[station] || []; return list.find((x) => !x.busy) || null; }
  const FOCUS_TASK = { '가슴': 'bench', '하체': 'squat', '유산소': 'run', '팔': 'curl', '등': 'curl', '어깨': 'bench', '축구': 'run' };
  const TEMP_MS = 30000;   // 남이 시킨 건 30초만
  function pickTask(a) {
    if (a.jail) return 'jail';
    if (a.temp && performance.now() < a.tempUntil) return a.temp;
    a.temp = null;
    if (a.order && TASKS[a.order] && !TASKS[a.order].hidden) return a.order;   // 주인장이 시킨 것
    if (a.live || a.today) return FOCUS_TASK[a.focus] || 'home';              // 오늘 한 운동
    return 'home';                                                            // 아니면 자기 짐에서
  }
  function goTo(a, k) {
    if (a.slot) { a.slot.busy = null; const br = a.slot.bar; if (br && br.position) br.position.y = a.slot.barX !== undefined ? 1.3 : 1.55; }
    let slot = k === 'home' ? (booths[a.id] && booths[a.id].slot) : freeSlot(TASKS[k].station);
    if (!slot && k === 'jail') slot = { x: 5.0 + (Math.random() - 0.5) * 1.6, z: -6.9 + (Math.random() - 0.5) * 1.6, face: 0, y: 0.16 };
    if (!slot) { k = 'stretch'; slot = freeSlot('mat') || freeSlot('seat'); }
    if (!slot) { slot = { x: (Math.random() - 0.5) * 6, z: 1 + Math.random() * 2, face: 0 }; k = 'stretch'; }
    slot.busy = a; a.slot = slot; a.task = k; a.mode = 'walk';
    a.tagSub((a.temp === k ? '📣 ' : a.order === k ? '👑 ' : '') + TASKS[k].label);
  }
  /* ================= 🏠 각자 짐 + 메모판 ================= */
  const MEMO_COL = { y: '#ffe36e', p: '#ffb3d1', g: '#b8f0a8', b: '#a8d8ff' };
  function drawMemoBoard(b) {
    const c = b.cv, x = c.getContext('2d'), W = c.width, H = c.height;
    x.fillStyle = '#b98a57'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${90 + (i * 37) % 60},${60 + (i * 13) % 40},30,.25)`; x.fillRect((i * 97) % W, (i * 61) % H, 3, 3); }
    x.strokeStyle = '#6b4a2e'; x.lineWidth = 18; x.strokeRect(9, 9, W - 18, H - 18);
    const list = (memoData[b.id] || []).slice(0, 6);
    if (!list.length) {
      x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '800 40px -apple-system, "Apple SD Gothic Neo", sans-serif'; x.textAlign = 'center';
      x.fillText('📌 메모를 붙여주세요', W / 2, H / 2 + 14);
    }
    list.forEach((m, i) => {
      const col = i % 3, row = Math.floor(i / 3), w = 170, h = 150;
      const px = 30 + col * (w + 12), py = 30 + row * (h + 14), rot = ((i * 7) % 5 - 2) * 0.03;
      x.save(); x.translate(px + w / 2, py + h / 2); x.rotate(rot);
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(-w / 2 + 4, -h / 2 + 6, w, h);
      x.fillStyle = MEMO_COL[m.c] || MEMO_COL.y; x.fillRect(-w / 2, -h / 2, w, h);
      x.fillStyle = '#e23b3b'; x.beginPath(); x.arc(0, -h / 2 + 12, 8, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a2420'; x.textAlign = 'left'; x.font = '700 25px -apple-system, "Apple SD Gothic Neo", sans-serif';
      const words = String(m.text || ''); let line = '', ly = -h / 2 + 46; const lines = [];
      for (const ch of words) { if (x.measureText(line + ch).width > w - 22) { lines.push(line); line = ch; } else line += ch; }
      lines.push(line); lines.slice(0, 3).forEach((ln, k) => x.fillText(k === 2 && lines.length > 3 ? ln.slice(0, -1) + '…' : ln, -w / 2 + 11, ly + k * 30));
      x.fillStyle = 'rgba(42,36,32,.6)'; x.font = '700 19px -apple-system, "Apple SD Gothic Neo", sans-serif'; x.fillText(`- ${m.who || ''}`, -w / 2 + 11, h / 2 - 12);
      x.restore();
    });
    b.tex.needsUpdate = true;
  }
  function buildBooths(team) {
    Object.values(booths).forEach((b) => { gymScene.remove(b.g); b.tex.dispose(); });
    booths = {};
    const M = (c, r = 0.8, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const BX = (w, h, d, mat, x, y, z, par) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
    const n = team.length, gap = 0.9, span = Math.PI * 2 - gap * 2, RR = 14.6;
    const dark = M(0x1d1e22, 0.5, 0.5), steel = M(0xd9dbe0, 0.25, 0.9), wood = M(0x8a5a34, 0.85);
    team.forEach((m, i) => {
      const ang = Math.PI + gap + (n === 1 ? span / 2 : (span * i) / (n - 1));
      const g = new THREE.Group(); g.position.set(Math.sin(ang) * RR, 0, Math.cos(ang) * RR); g.rotation.y = ang + Math.PI;   // 가운데를 바라봄
      g.userData.booth = m.id;
      const col = new THREE.Color(m.color || '#3a3a42');
      // 바닥 (내 색) + 벽 + 기둥
      BX(3.4, 0.08, 2.8, M(col.clone().lerp(new THREE.Color('#222'), 0.35), 0.9), 0, 0.04, 0, g);
      BX(3.4, 2.4, 0.14, M(0xf1ece2, 0.95), 0, 1.2, -1.33, g);
      [-1.7, 1.7].forEach((x) => BX(0.14, 2.6, 0.14, dark, x, 1.3, -1.33, g));
      BX(3.6, 0.16, 0.2, M(col, 0.6), 0, 2.5, -1.3, g);
      // 메모판 (코르크)
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 360;
      const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      board.position.set(-0.45, 1.45, -1.25); g.add(board);
      const board2 = board.clone(); board2.position.set(0.45, 1.45, -1.41); board2.rotation.y = Math.PI; g.add(board2);   // 뒤에서도 보이게
      // 이름 간판
      const sc = document.createElement('canvas'); sc.width = 512; sc.height = 112;
      const sx = sc.getContext('2d'); sx.fillStyle = '#16171b'; sx.fillRect(0, 0, 512, 112); sx.fillStyle = m.color || '#8b5cf6'; sx.fillRect(0, 100, 512, 12);
      sx.fillStyle = '#fff'; sx.font = '900 60px -apple-system, "Apple SD Gothic Neo", sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle';
      sx.fillText(`🏠 ${m.nick} GYM`, 256, 54);
      const st = new THREE.CanvasTexture(sc); st.encoding = THREE.sRGBEncoding;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.5), new THREE.MeshBasicMaterial({ map: st, toneMapped: false }));
      sign.position.set(0, 2.95, -1.22); g.add(sign);
      const sign2 = sign.clone(); sign2.position.set(0, 2.95, -1.24); sign2.rotation.y = Math.PI; g.add(sign2);
      [-0.9, 0.9].forEach((x) => BX(0.05, 0.4, 0.05, dark, x, 2.7, -1.26, g));
      // 작은 덤벨랙 + 벤치
      BX(0.5, 0.06, 1.0, dark, 1.25, 0.6, -0.7, g); BX(0.5, 0.06, 1.0, dark, 1.25, 0.32, -0.7, g); BX(0.08, 0.62, 0.9, dark, 1.25, 0.31, -0.7, g);
      for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), steel); d.rotation.x = Math.PI / 2; d.position.set(1.25, 0.67, -1.0 + k * 0.3); d.rotation.set(0, 0, Math.PI / 2); g.add(d); [-0.12, 0.12].forEach((o) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), dark); p.rotation.z = Math.PI / 2; p.position.set(1.25 + o, 0.67, -1.0 + k * 0.3); g.add(p); }); }
      BX(1.2, 0.1, 0.4, wood, -0.4, 0.42, 0.55, g); [-0.9, 0.1].forEach((x) => BX(0.08, 0.4, 0.35, dark, x, 0.2, 0.55, g));
      gymScene.add(g);
      // 내 짐 운동 자리 (월드 좌표)
      const lp = new THREE.Vector3(0.35, 0, -0.35).applyMatrix4(new THREE.Matrix4().makeRotationY(g.rotation.y)).add(g.position);
      const b = { id: m.id, g, cv, tex, slot: { x: lp.x, z: lp.z, face: g.rotation.y, busy: null } };
      booths[m.id] = b;
      drawMemoBoard(b);
    });
  }
  /** 각자 짐 메모 갱신: { id: [{text, who, c}] } */
  function setMemos(map) {
    memoData = map || {};
    Object.values(booths).forEach(drawMemoBoard);
  }
  function buildGym(team) {
    if (!gymScene) buildGymScene();
    buildBooths(team);
    photo = null; if (gymScene.userData.riser) gymScene.userData.riser.visible = false;
    agents.forEach((a) => { gymScene.remove(a.g); if (a.slot) a.slot.busy = null; });
    agents = [];
    team.forEach((m, i) => {
      const g = new THREE.Group();
      const f = makeFigure(m); g.add(f);
      f.scale.multiplyScalar(0.82); f.userData.sy = f.scale.y; f.userData.sx = f.scale.x;
      let tag = null;
      let a = null;
      const setTag = (sub) => { if (tag) { g.remove(tag); tag.material.map.dispose(); } tag = nameTag(m.nick, sub, m.me, m.live); tag.position.y = f.userData.top * 0.82 + 0.6; tag.scale.multiplyScalar(2.1); g.add(tag); if (a) a.tag = tag; };
      a = { order: m.order || null, temp: null, id: m.id, nick: m.nick, me: m.me, live: m.live, today: m.today, focus: m.focus, jail: !!m.jail, g, fig: f, phase: i * 1.7, speed: 1, mode: 'walk', task: 'rest', slot: null, timer: 0, tagSub: setTag };
      g.position.set(-1 + (i % 4) * 0.9, 0, 5.2 + Math.floor(i / 4) * 0.8);   // 입구에서 입장
      g.userData.agent = a;
      gymScene.add(g); agents.push(a);
      goTo(a, pickTask(a));
      if (a.jail) { g.position.set(a.slot.x, 0, a.slot.z); a.mode = 'do'; a.timer = 20 + Math.random() * 20; a.g.rotation.y = a.slot.face; }
    });
  }
  function updateAgents(dt, s) {
    agents.forEach((a) => {
      const p = a.g.position, sl = a.slot;
      if (a.mode === 'photo') { posePhoto(a, s); return; }
      if (a.mode === 'walk') {
        const dx = sl.x - p.x, dz = sl.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.06) { p.x = sl.x; p.z = sl.z; a.mode = 'do'; a.timer = a.temp ? Math.max(2, (a.tempUntil - performance.now()) / 1000) : 20; a.g.rotation.y = sl.face; }
        else { const v = Math.min(d, 1.5 * dt); p.x += (dx / d) * v; p.z += (dz / d) * v; a.g.rotation.y = Math.atan2(dx, dz); }
      } else {
        a.timer -= dt;
        if (a.timer <= 0) { const k = pickTask(a); if (k === a.task && a.slot && a.slot.busy === a) { a.timer = 20; a.tagSub((a.order === k ? '👑 ' : '') + TASKS[k].label); } else goTo(a, k); }
      }
      pose(a, s);
    });
  }

  /* ================= 📸 단체사진 (아이레벨, 오늘 한 운동대로 포징) ================= */
  let photo = null;
  const PHOTO_POSES = {
    '가슴': '💪 갑빠 자랑', '등': '🦅 광배 펼치기', '하체': '🦵 허벅지 자랑', '어깨': '🙌 어깨 만세',
    '팔': '💪 더블 바이셉스', '유산소': '🏃 질주 포즈', '축구': '⚽ 슈팅 포즈', '': '✌️ 브이', rest: '🫠 쉬었음 청년',
  };
  function release(a) {
    if (!a.slot) return;
    a.slot.busy = null; const br = a.slot.bar; if (br && br.position) br.position.y = a.slot.barX !== undefined ? 1.3 : 1.55;
    a.slot = null;
  }
  // 📸 앵글: 카메라 위치는 고정, 고개만 좌우(패닝)·위아래(틸트), 줌은 화각
  const PHOTO_EYE = [0, 1.55, 10.6], PHOTO_PITCH0 = Math.atan2(1.5 - 1.55, 10.6 - 2.2);
  function aimPhoto() {
    if (!photo) return;
    const c = photo.cam, yawA = -photo.pan, pitch = PHOTO_PITCH0 + photo.tilt;
    c.position.set(...PHOTO_EYE);
    c.lookAt(PHOTO_EYE[0] + Math.sin(yawA) * Math.cos(pitch), PHOTO_EYE[1] + Math.sin(pitch), PHOTO_EYE[2] - Math.cos(yawA) * Math.cos(pitch));
    c.fov = 34 / photo.zoom; c.updateProjectionMatrix();
  }
  function photoZoom(z) { if (!photo) return; photo.zoom = Math.max(0.6, Math.min(3, z)); }
  function photoAngle(cmd) {
    if (!photo) return;
    if (cmd === 'in') photoZoom(photo.zoom * 1.25);
    else if (cmd === 'out') photoZoom(photo.zoom / 1.25);
    else if (cmd === 'reset') { photo.pan = 0; photo.tilt = 0; photo.zoom = 1; }
  }
  function startPhoto() {
    room = null;
    if (!gymScene || !agents.length) return false;
    const cam = new THREE.PerspectiveCamera(34, 4 / 3, 0.1, 260);
    cam.position.set(0, 1.55, 10.6); cam.lookAt(0, 1.5, 2.2);
    photo = { cam, pan: 0, tilt: 0, zoom: 1 };
    aimPhoto();
    if (renderer) renderer.domElement.style.touchAction = 'none';
    const crew = agents.filter((a) => !a.jail).sort((a, b) => (b.me - a.me) || (b.today - a.today));
    const stand = crew.filter((a) => a.today), sit = crew.filter((a) => !a.today);   // 쉬었음 청년들은 맨 앞 바닥에
    const n = stand.length, frontN = n > 5 ? Math.ceil(n / 2) : n, backN = n - frontN, gap = 1.2;
    // 가운데부터 좌우로 채우기 (나는 가운데)
    const row = (cnt, g = gap) => { const xs = []; for (let i = 0; i < cnt; i++) xs.push((i - (cnt - 1) / 2) * g); return xs.sort((a, b) => Math.abs(a) - Math.abs(b)); };
    const fx = row(frontN), bx = row(backN).map((x) => x + (backN === frontN ? gap / 2 : 0)), sx = row(sit.length, 1.05);
    if (!gymScene.userData.riser) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 1.0), new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.85 }));
      r.position.set(0, 0.3, 1.45); r.castShadow = true; r.receiveShadow = true; gymScene.add(r); gymScene.userData.riser = r;
    }
    gymScene.userData.riser.visible = backN > 0;
    if (backN > 0) { gymScene.userData.riser.scale.x = Math.max(0.4, (backN * gap + 0.8) / 7); gymScene.userData.riser.position.x = backN === frontN ? gap / 2 : 0; }
    const place = (a, x, y, z, pk) => {
      release(a);
      a.g.position.set(x, y, z); a.g.rotation.y = 0;
      a.mode = 'photo'; a.pk = pk;
      a.tagSub(PHOTO_POSES[pk]);
      if (a.tag) { a.tag.scale.multiplyScalar(0.5); a.tag.position.y = a.fig.userData.top * 0.82 + (pk === 'rest' ? -0.7 : 0.32); }
    };
    stand.forEach((a, i) => { const back = i >= frontN; place(a, back ? bx[i - frontN] : fx[i], back ? 0.6 : 0, back ? 1.45 : 2.95, PHOTO_POSES[a.focus] ? a.focus : ''); });
    sit.forEach((a, i) => place(a, sx[i], 0, 4.15, 'rest'));
    return true;
  }
  function endPhoto() {
    if (!photo) return;
    photo = null;
    if (renderer) renderer.domElement.style.touchAction = immersive ? 'none' : 'pan-y';
    if (gymScene && gymScene.userData.riser) gymScene.userData.riser.visible = false;
    agents.forEach((a) => { if (a.mode === 'photo') { a.g.position.set(a.g.position.x, 0, a.g.position.z + 0.6); goTo(a, pickTask(a)); } });
  }
  function posePhoto(a, s) {
    const f = a.fig, rig = f.userData.rig, t = s + a.phase;
    f.rotation.set(0, 0, 0); f.position.set(0, 0, 0);
    rig.legs.forEach((l) => l.rotation.set(0, 0, 0)); rig.arms.forEach((r) => r.rotation.set(0, 0, 0));
    if (f.userData.cape) f.userData.cape.rotation.x = 0.15 + Math.sin(s * 2 + a.phase) * 0.06;
    if (f.userData.aura) f.userData.aura.rotation.y = s * 0.6;
    const L = rig.arms[0], Rr = rig.arms[1], side = (r) => (r === L ? -1 : 1);
    const flex = 0.04 * Math.sin(t * 3);
    switch (a.pk) {
      case '팔':   // 더블 바이셉스: 양팔 옆으로 들어 올리기
        rig.arms.forEach((r) => { r.rotation.z = side(r) * (2.35 + flex); r.rotation.x = -0.25; });
        break;
      case '가슴':  // 모스트 머스큘러: 팔을 앞으로 모아 가슴 쥐어짜기
        rig.arms.forEach((r) => { r.rotation.x = -0.75; r.rotation.z = -side(r) * (0.55 + flex); });
        f.rotation.x = 0.08;
        break;
      case '등':   // 랫 스프레드: 손은 허리, 팔꿈치 활짝
        rig.arms.forEach((r) => { r.rotation.z = side(r) * (0.75 + flex); r.rotation.x = 0.15; });
        f.scale.x = f.userData.sx * 1.1;
        break;
      case '어깨':  // 만세
        rig.arms.forEach((r) => { r.rotation.x = Math.PI; r.rotation.z = -side(r) * (0.35 + flex); });
        break;
      case '하체':  // 한쪽 다리 앞으로 내밀고 허리에 손
        rig.legs[0].rotation.x = -0.45; rig.legs[0].rotation.z = -0.12;
        rig.arms.forEach((r) => { r.rotation.z = side(r) * 0.6; });
        f.position.y = -0.03;
        break;
      case '유산소': // 질주 정지 화면
        rig.legs[0].rotation.x = -0.75; rig.legs[1].rotation.x = 0.6;
        rig.arms[0].rotation.x = 0.7; rig.arms[1].rotation.x = -0.8;
        f.rotation.x = 0.1; f.position.y = 0.04;
        break;
      case '축구':  // 슈팅
        rig.legs[0].rotation.x = -1.15 - flex * 2; rig.arms.forEach((r) => { r.rotation.z = side(r) * 1.1; });
        f.rotation.x = -0.12;
        break;
      case 'rest': {  // 🫠 운동 쉬었음 청년: 바닥에 주저앉아 축 처짐
        const sigh = Math.sin(t * 0.8) * 0.04;
        f.position.y = -0.74; f.position.z = -0.1;
        f.rotation.x = 0.42 + sigh;
        rig.legs.forEach((l, i) => { l.rotation.x = -1.35; l.rotation.z = (i ? 1 : -1) * 0.12; });
        rig.arms.forEach((r) => { r.rotation.x = -0.55; r.rotation.z = -side(r) * 0.15; });
        break;
      }
      default:     // ✌️ 한 손 브이 흔들기
        Rr.rotation.x = Math.PI - 0.25; Rr.rotation.z = -side(Rr) * (0.3 + Math.sin(t * 4) * 0.15);
    }
    if (a.pk !== '등') f.scale.x = f.userData.sx;
  }
  /** 지금 화면 그대로 고해상도 단체사진 찍기 */
  function snap(W = 1440, H = 1080) {
    if (!photo || !renderer) return null;
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    photo.cam.aspect = W / H; photo.cam.updateProjectionMatrix();
    renderer.render(gymScene, photo.cam);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.92);
    renderer.setPixelRatio(pr); resize();
    return url;
  }
  /** 사람 눌러서 시키기 */
  /** 사람 눌러서 시키기 — own: 주인장(본인)이 시킨 것은 계속, 남이 시킨 건 잠깐 */
  function assign(id, k, own) {
    const a = agents.find((x) => x.id === id);
    if (!a || a.jail) return false;
    if (own) { a.order = k === 'auto' ? null : k; a.temp = null; goTo(a, pickTask(a)); return true; }
    if (!TASKS[k]) return false;
    a.temp = k; a.tempUntil = performance.now() + TEMP_MS;
    goTo(a, k);
    return true;
  }

  /* ================= 🏠 방 구경 (짐 앞으로 카메라 이동, 옆 방 넘기기) ================= */
  let room = null, flyUntil = 0;
  let gCamPos = null, gCamLook = null;
  function viewRoom(id) { room = id && booths[id] ? id : null; flyUntil = performance.now() + 1600; return room; }
  const roomIds = () => Object.keys(booths);
  let immersive = false;
  /** 산스장 들어가기(전체화면): 위아래 드래그로 높이, 핀치·휠로 줌 */
  function setImmersive(on) {
    immersive = !!on;
    if (renderer) renderer.domElement.style.touchAction = on || photo ? 'none' : 'pan-y';
    if (!on) { gymDist = 48; gymH = 26; }
  }
  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!box || !box.isConnected || box.offsetParent === null || document.hidden) return;   // 안 보일 땐 쉼
    const s = (t - t0) / 1000;
    const dt = Math.min(0.05, s - (tick.last || s)); tick.last = s;
    if (want && want.team && gymScene) {
      if (!room && !drag && !reduce && performance.now() - gymTouched > 8000) gymYaw += (Math.sin(s * 0.08) * 0.35 + 0.15 - gymYaw) * 0.005;
      const low = Math.max(0, Math.min(1, (16 - gymH) / 13));
      let dp, dl;
      if (room && booths[room]) {
        const g = booths[room].g, Y = new THREE.Vector3(0, 1, 0);
        dp = new THREE.Vector3(0, 2.1, 5.6).applyAxisAngle(Y, g.rotation.y).add(g.position);
        dl = new THREE.Vector3(0, 1.35, -1.0).applyAxisAngle(Y, g.rotation.y).add(g.position);
      } else {
        dp = new THREE.Vector3(Math.sin(gymYaw) * gymDist, gymH, Math.cos(gymYaw) * gymDist + 1.5);
        dl = new THREE.Vector3(0, -0.6 + low * 1.8, 0);
      }
      if (!gCamPos) { gCamPos = dp.clone(); gCamLook = dl.clone(); }
      const nowT = performance.now(), dtc = Math.min(0.5, (nowT - (tick.camT || nowT)) / 1000); tick.camT = nowT;
      const kf = room || nowT < flyUntil ? 1 - Math.exp(-Math.max(dtc, 0.016) * 4) : 1;
      gCamPos.lerp(dp, kf); gCamLook.lerp(dl, kf);
      gymCam.position.copy(gCamPos); gymCam.lookAt(gCamLook);
      updateAgents(dt, s);
      if (photo) {
        const w = box.clientWidth || 300, h = box.clientHeight || 360;
        aimPhoto();
        photo.cam.aspect = w / h; photo.cam.updateProjectionMatrix();
        renderer.render(gymScene, photo.cam);
        return;
      }
      renderer.render(gymScene, gymCam);
      return;
    }
    if (!drag && !reduce) yaw += 0.0025;
    camera.position.set(Math.sin(yaw) * camDist, 2.0 + camLift + Math.sin(s * 0.25) * 0.08, Math.cos(yaw) * camDist);
    camera.lookAt(0, camLook, 0);
    // 달은 항상 화면 왼쪽 위 먼 곳에
    const [moon, disc] = scene.userData.moon;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const mp = camera.position.clone().addScaledVector(fwd, 13).addScaledVector(right, -2.6);
    mp.y += 3.2;
    moon.position.copy(mp); disc.position.copy(mp).addScaledVector(fwd, 0.05); disc.lookAt(camera.position);
    figs.forEach((g, i) => {
      const f = g.userData.fig || g;
      const br = 1 + Math.sin(s * 1.6 + i * 0.9) * 0.012;
      f.children.forEach((o) => { if (o.userData.spin) { o.rotation.x = s * 2; } });
      f.scale.y = f.userData.sy * br;
      if (f.userData.cape) f.userData.cape.rotation.x = 0.12 + Math.sin(s * 2.2 + i) * 0.07;
      if (f.userData.aura) f.userData.aura.rotation.y = s * 0.6;
    });
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
    if (key !== lastKey) { lastKey = key; build(want); resize(); }
    if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(tick); }
    return true;
  }
  return { show, assign, onPick: (fn) => { onPick = fn; }, tasks: TASKS, supported: () => !failed, startPhoto, endPhoto, snap, photoAngle, setImmersive, viewRoom, roomIds, inRoom: () => room, onStatue: (fn) => { onStatue = fn; }, setMemos, onBooth: (fn) => { onBooth = fn; }, openBooth: (id) => { if (onBooth && booths[id]) onBooth(id); }, inPhoto: () => !!photo, poses: PHOTO_POSES };
})();
