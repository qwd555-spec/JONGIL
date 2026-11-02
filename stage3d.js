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
    dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw, gy: gymYaw, moved: false }; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
      if (want && want.team) gymYaw = drag.gy - (e.clientX - drag.x) * 0.008; else { yaw = drag.yaw - (e.clientX - drag.x) * 0.012; yawV = 0; }
    });
    const up = (e) => {
      if (drag && !drag.moved && want && want.team && gymScene && onPick && e && e.clientX !== undefined) {
        const r = dom.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), gymCam);
        const hit = ray.intersectObjects(agents.map((a) => a.g), true)[0];
        if (hit) { let o = hit.object; while (o && !o.userData.agent) o = o.parent; if (o) onPick(o.userData.agent); }
      }
      drag = null;
    };
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
    if (gymCam) { gymCam.aspect = w / h; gymCam.updateProjectionMatrix(); }
  }

  /* ---- 선수 만들기 (근육량 = 진짜 운동 레벨) ---- */
  function makeFigure({ up = 0, low = 0, color = '#3a3a42', track = '' }) {
    const mats = {};
    const U = Math.min(up, 40) / 40, L = Math.min(low, 40) / 40;
    const hulk = Math.max(0, Math.min(1, ((up + low) / 2 - 16) / 14));
    mats.skin = new THREE.MeshStandardMaterial({ color: mix('#e9b994', '#5fb840', hulk), roughness: 0.55, metalness: 0.05 });
    mats.shirt = new THREE.MeshStandardMaterial({ color: hex(color), roughness: 0.7 });
    mats.shorts = new THREE.MeshStandardMaterial({ color: 0x1d1d24, roughness: 0.8 });
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
    bench: { label: '🏋️ 벤치프레스', station: 'bench' },
    squat: { label: '🦵 스쿼트', station: 'rack' },
    run: { label: '🏃 러닝머신', station: 'tread' },
    curl: { label: '💪 덤벨 컬', station: 'db' },
    stretch: { label: '🧘 스트레칭', station: 'mat' },
    rest: { label: '🥤 휴식', station: 'seat' },
  };
  let gymScene = null, gymCam = null, stations = {}, agents = [], gymYaw = 0.25, onPick = null;
  function buildGymScene() {
    gymScene = new THREE.Scene();
    gymScene.background = hex('#0d0d14');
    gymScene.fog = new THREE.Fog(0x0d0d14, 24, 42);
    gymCam = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    const M = (c, r = 0.8, m = 0.1, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e || 0x000000 });
    const B = (w, h, d, mat, x, y, z, par = gymScene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
    const Cy = (r, h, mat, x, y, z, rx = 0, rz = 0, par = gymScene) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; par.add(o); return o; };
    // 바닥 · 벽
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), M(0x26262e, 0.9)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; gymScene.add(floor);
    const wood = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), M(0x8a5a34, 0.6)); wood.rotation.x = -Math.PI / 2; wood.position.set(0, 0.005, 3.2); wood.receiveShadow = true; gymScene.add(wood);
    B(18, 5, 0.2, M(0x1a1a22, 0.95), 0, 2.5, -6.5);
    B(0.2, 5, 13, M(0x16161d, 0.95), -9, 2.5, 0);
    B(0.2, 5, 13, M(0x16161d, 0.95), 9, 2.5, 0);
    // 창문 빛 · 거울 · 간판
    for (let i = -3; i <= 3; i++) B(1.6, 1.1, 0.05, M(0x223, 0.2, 0, 0x2a3a66), i * 2.3, 3.4, -6.38);
    B(0.05, 2.2, 5, M(0x9fb3c8, 0.05, 0.9), 8.88, 1.5, 0);   // 거울
    const sign = document.createElement('canvas'); sign.width = 1024; sign.height = 160;
    const sx = sign.getContext('2d'); sx.fillStyle = '#e98ce6'; sx.font = '900 120px -apple-system, sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText('✦ VOLUMER GYM', 512, 84);
    const st = new THREE.CanvasTexture(sign); st.encoding = THREE.sRGBEncoding;
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.95), new THREE.MeshBasicMaterial({ map: st, transparent: true }));
    signM.position.set(0, 4.45, -6.38); gymScene.add(signM);
    // 조명
    gymScene.add(new THREE.HemisphereLight(0x9aa4d6, 0x18181f, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1dc, 0.9); sun.position.set(4, 10, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 }); gymScene.add(sun);
    [[-4, -2], [2, -3], [4, 2], [-3, 3]].forEach(([x, z]) => { const l = new THREE.PointLight(0xffe2c4, 0.5, 9); l.position.set(x, 4.2, z); gymScene.add(l); B(1.4, 0.06, 0.4, M(0xffffff, 0.3, 0, 0xffe6c8), x, 4.6, z); });
    const steel = M(0x9aa0aa, 0.35, 0.8), black = M(0x111116, 0.6, 0.3), pad = M(0x2d2d38, 0.7), red = M(0xd14b3c, 0.5);
    stations = { bench: [], rack: [], tread: [], db: [], mat: [], seat: [] };
    // 벤치프레스 2대 (왼쪽)
    [-1.2, 1.2].forEach((dz) => {
      const x = -5.6, z = -1 + dz;
      B(1.5, 0.12, 0.42, pad, x, 0.48, z); B(0.12, 0.45, 0.12, steel, x - 0.5, 0.22, z); B(0.12, 0.45, 0.12, steel, x + 0.5, 0.22, z);
      Cy(0.03, 0.95, steel, x - 0.55, 0.95, z - 0.45, 0, 0); Cy(0.03, 0.95, steel, x - 0.55, 0.95, z + 0.45, 0, 0);
      const bar = Cy(0.025, 1.9, steel, x - 0.55, 1.3, z, Math.PI / 2); Cy(0.2, 0.08, black, x - 0.55, 1.3, z - 0.8, Math.PI / 2); Cy(0.2, 0.08, black, x - 0.55, 1.3, z + 0.8, Math.PI / 2);
      stations.bench.push({ x: x + 0.15, z, face: Math.PI / 2, bar, barX: x - 0.55, busy: null });
    });
    // 스쿼트 랙 2대 (뒤)
    [-2.2, 0.4].forEach((x) => {
      const z = -4.6;
      [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]].forEach(([dx, dz]) => B(0.08, 2.4, 0.08, steel, x + dx, 1.2, z + dz));
      B(1.4, 0.06, 0.06, steel, x, 2.4, z - 0.35); B(1.4, 0.06, 0.06, steel, x, 2.4, z + 0.35);
      const bar = Cy(0.025, 2.1, steel, x, 1.55, z + 0.05, 0, Math.PI / 2); Cy(0.24, 0.1, red, x - 0.9, 1.55, z + 0.05, 0, Math.PI / 2); Cy(0.24, 0.1, red, x + 0.9, 1.55, z + 0.05, 0, Math.PI / 2);
      stations.rack.push({ x, z: z + 0.05, face: 0, bar, busy: null });
    });
    // 러닝머신 3대 (오른쪽 뒤)
    [3, 4.5, 6].forEach((x) => {
      const z = -4.4;
      B(0.9, 0.2, 2.0, black, x, 0.1, z); B(0.75, 0.03, 1.8, M(0x33333d, 0.9), x, 0.215, z);
      B(0.06, 1.2, 0.06, steel, x - 0.4, 0.8, z + 0.85); B(0.06, 1.2, 0.06, steel, x + 0.4, 0.8, z + 0.85);
      B(0.9, 0.35, 0.15, M(0x111118, 0.4, 0.2, 0x10204a), x, 1.45, z + 0.9);
      stations.tread.push({ x, z: z - 0.1, y: 0.23, face: 0, busy: null });
    });
    // 덤벨 존 (오른쪽, 거울 앞)
    B(0.6, 0.8, 3, black, 6.9, 0.4, 0.8);
    for (let i = 0; i < 6; i++) { const z = -0.4 + i * 0.48; Cy(0.06, 0.35, steel, 6.9, 0.85, z, 0, Math.PI / 2); Cy(0.1, 0.07, black, 6.7, 0.85, z, 0, Math.PI / 2); Cy(0.1, 0.07, black, 7.1, 0.85, z, 0, Math.PI / 2); }
    [-0.4, 0.8, 2.0].forEach((z) => stations.db.push({ x: 5.8, z, face: Math.PI / 2, busy: null }));
    // 매트 (가운데 앞, 나무 바닥 위)
    [[-1.6, 2.6], [0, 2.6], [1.6, 2.6], [-0.8, 3.9], [0.8, 3.9]].forEach(([x, z]) => {
      B(1.0, 0.03, 1.8, M(0x5b3fa0, 0.85), x, 0.02, z);
      stations.mat.push({ x, z, face: 0, busy: null });
    });
    // 휴식 벤치 · 정수기 (왼쪽 앞)
    B(3.2, 0.1, 0.5, M(0x6b4a2e, 0.6), -5.6, 0.48, 4.2); B(0.1, 0.45, 0.4, steel, -6.9, 0.23, 4.2); B(0.1, 0.45, 0.4, steel, -4.3, 0.23, 4.2);
    B(0.5, 1.3, 0.5, M(0xdfe6ee, 0.4), -8.2, 0.65, 4.4); Cy(0.2, 0.5, M(0x7cc4ff, 0.2, 0, 0x0a2440), -8.2, 1.55, 4.4);
    [-6.6, -5.6, -4.6].forEach((x) => stations.seat.push({ x, z: 4.0, face: 0, sit: 0.52, busy: null }));
  }

  // 각 동작 포즈 (매 프레임)
  function pose(a, s) {
    const f = a.fig, rig = f.userData.rig, t = s * (a.speed || 1) + a.phase;
    f.rotation.set(0, 0, 0); f.position.set(0, 0, 0);
    rig.legs.forEach((l) => l.rotation.set(0, 0, 0)); rig.arms.forEach((r) => r.rotation.set(0, 0, 0));
    if (a.db) a.db.forEach((d) => (d.visible = false));
    if (a.mode === 'walk') {
      const w = Math.sin(t * 7) * 0.55;
      rig.legs[0].rotation.x = w; rig.legs[1].rotation.x = -w; rig.arms[0].rotation.x = -w * 0.8; rig.arms[1].rotation.x = w * 0.8;
      f.position.y = Math.abs(Math.cos(t * 7)) * 0.04;
      return;
    }
    const k = a.task;
    if (k === 'run') {
      const w = Math.sin(t * 11) * 0.9;
      rig.legs[0].rotation.x = w; rig.legs[1].rotation.x = -w; rig.arms[0].rotation.x = -w; rig.arms[1].rotation.x = w;
      f.position.y = a.slot.y + Math.abs(Math.cos(t * 11)) * 0.08;
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
    } else if (k === 'curl') {
      const r1 = (Math.sin(t * 3) + 1) / 2, r2 = (Math.sin(t * 3 + Math.PI) + 1) / 2;
      rig.arms[0].rotation.x = -r1 * 2.2; rig.arms[1].rotation.x = -r2 * 2.2;
      if (!a.db) a.db = rig.arms.map((r) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.5 })); d.rotation.z = Math.PI / 2; d.position.copy(r.userData.hand.position); r.add(d); return d; });
      a.db.forEach((d) => (d.visible = true));
    } else if (k === 'stretch') {
      const sw = Math.sin(t * 1.2);
      rig.arms.forEach((r, i) => { r.rotation.z = (i ? 1 : -1) * -2.9; });
      f.rotation.z = sw * 0.25;
    } else if (k === 'rest') {
      f.position.y = (a.slot.sit || 0.5) - 0.95 + 0.05;
      rig.legs.forEach((l) => (l.rotation.x = -1.45));
      rig.arms[1].rotation.x = -1.4 - Math.max(0, Math.sin(t * 0.7)) * 0.5;   // 물 마시기
    }
  }

  function freeSlot(station) { const list = stations[station] || []; return list.find((x) => !x.busy) || null; }
  function pickTask(a) {
    if (a.forced) { const k = a.forced; a.forced = null; return k; }
    const pool = a.live
      ? { '가슴': 'bench', '하체': 'squat', '유산소': 'run', '팔': 'curl', '등': 'curl', '어깨': 'curl' }[a.focus] || ['bench', 'squat', 'run', 'curl'][Math.floor(Math.random() * 4)]
      : (a.today ? ['stretch', 'rest', 'curl', 'run'] : ['rest', 'rest', 'stretch', 'run'])[Math.floor(Math.random() * 4)];
    return pool;
  }
  function goTo(a, k) {
    if (a.slot) { a.slot.busy = null; if (a.slot.bar && a.slot.barX !== undefined) a.slot.bar.position.y = 1.3; if (a.slot.bar && a.slot.barX === undefined) a.slot.bar.position.y = 1.55; }
    let slot = freeSlot(TASKS[k].station);
    if (!slot) { k = 'stretch'; slot = freeSlot('mat') || freeSlot('seat'); }
    if (!slot) { slot = { x: (Math.random() - 0.5) * 6, z: 1 + Math.random() * 2, face: 0 }; k = 'stretch'; }
    slot.busy = a; a.slot = slot; a.task = k; a.mode = 'walk';
    a.tagSub(TASKS[k].label);
  }
  function buildGym(team) {
    if (!gymScene) buildGymScene();
    agents.forEach((a) => { gymScene.remove(a.g); if (a.slot) a.slot.busy = null; });
    agents = [];
    team.forEach((m, i) => {
      const g = new THREE.Group();
      const f = makeFigure(m); g.add(f);
      f.scale.multiplyScalar(0.82); f.userData.sy = f.scale.y;
      let tag = null;
      const setTag = (sub) => { if (tag) { g.remove(tag); tag.material.map.dispose(); } tag = nameTag(m.nick, sub, m.me, m.live); tag.position.y = f.userData.top * 0.82 + 0.6; tag.scale.multiplyScalar(2.1); g.add(tag); };
      const a = { id: m.id, nick: m.nick, me: m.me, live: m.live, today: m.today, focus: m.focus, g, fig: f, phase: i * 1.7, speed: 1, mode: 'walk', task: 'rest', slot: null, timer: 0, tagSub: setTag };
      g.position.set(-1 + (i % 4) * 0.9, 0, 5.2 + Math.floor(i / 4) * 0.8);   // 입구에서 입장
      g.userData.agent = a;
      gymScene.add(g); agents.push(a);
      goTo(a, pickTask(a));
    });
  }
  function updateAgents(dt, s) {
    agents.forEach((a) => {
      const p = a.g.position, sl = a.slot;
      if (a.mode === 'walk') {
        const dx = sl.x - p.x, dz = sl.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.06) { p.x = sl.x; p.z = sl.z; a.mode = 'do'; a.timer = 14 + Math.random() * 16; a.g.rotation.y = sl.face; }
        else { const v = Math.min(d, 1.5 * dt); p.x += (dx / d) * v; p.z += (dz / d) * v; a.g.rotation.y = Math.atan2(dx, dz); }
      } else {
        a.timer -= dt;
        if (a.timer <= 0) goTo(a, pickTask(a));
      }
      pose(a, s);
    });
  }
  /** 사람 눌러서 시키기 */
  function assign(id, k) {
    const a = agents.find((x) => x.id === id);
    if (!a || !TASKS[k]) return false;
    goTo(a, k);
    return true;
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!box || !box.isConnected || box.offsetParent === null || document.hidden) return;   // 안 보일 땐 쉼
    const s = (t - t0) / 1000;
    const dt = Math.min(0.05, s - (tick.last || s)); tick.last = s;
    if (want && want.team && gymScene) {
      if (!drag && !reduce) gymYaw += (Math.sin(s * 0.08) * 0.35 + 0.15 - gymYaw) * 0.005;
      gymCam.position.set(Math.sin(gymYaw) * 15.5, 12.5, Math.cos(gymYaw) * 15.5 + 1.5);
      gymCam.lookAt(0, 0, 0.2);
      updateAgents(dt, s);
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
  return { show, assign, onPick: (fn) => { onPick = fn; }, tasks: TASKS, supported: () => !failed };
})();
