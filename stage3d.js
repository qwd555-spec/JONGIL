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
      if (drag && !drag.moved && want && want.team && gymScene && !photo && onPick && e && e.clientX !== undefined) {
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
    jail: { label: '🔒 수감 중', station: 'jail', hidden: true },
  };
  let gymScene = null, gymCam = null, stations = {}, agents = [], gymYaw = 0.25, onPick = null;
  function buildGymScene() {
    /* ⛰️ 볼류머 산스장 — 산 정상을 평평하게 깎아 올린 헬스장 (구름 위) */
    gymScene = new THREE.Scene();
    const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256;
    const kx = sky.getContext('2d'), sg = kx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, '#26306a'); sg.addColorStop(0.4, '#7a5ea0'); sg.addColorStop(0.7, '#f39a6b'); sg.addColorStop(1, '#ffe0b0');
    kx.fillStyle = sg; kx.fillRect(0, 0, 4, 256);
    const skyT = new THREE.CanvasTexture(sky); skyT.encoding = THREE.sRGBEncoding;
    gymScene.background = skyT;
    gymScene.fog = new THREE.Fog(0xe7b9a8, 34, 110);
    gymCam = new THREE.PerspectiveCamera(46, 1, 0.1, 260);
    const M = (c, r = 0.85, m = 0.05, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e || 0x000000 });
    const MF = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
    const B = (w, h, d, mat, x, y, z, par = gymScene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
    const Cy = (r, h, mat, x, y, z, rx = 0, rz = 0, par = gymScene) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; par.add(o); return o; };
    // ── 산 정상: 평평하게 깎은 고원 + 아래로 떨어지는 바위 산체
    const R = 10.6;
    const rockA = MF(0x7d7268), rockB = MF(0x6a5f57), rockC = MF(0x8c8075);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 2.2, 2.2, 14), rockA); cap.position.y = -1.1; cap.receiveShadow = true; gymScene.add(cap);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R + 2.2, R + 9, 8, 12), rockB); body.position.y = -6.2; gymScene.add(body);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 9, R + 22, 14, 11), rockC); base.position.y = -17; gymScene.add(base);
    for (let i = 0; i < 16; i++) {   // 울퉁불퉁 바위 턱
      const a = (i / 16) * Math.PI * 2 + 0.2, r = R + 1.4 + (i % 3) * 0.8;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2 + (i % 4) * 0.45), i % 2 ? rockA : rockC);
      b.position.set(Math.sin(a) * r, -1.6 - (i % 3) * 1.4, Math.cos(a) * r); b.rotation.set(i, i * 1.7, 0); gymScene.add(b);
    }
    // 바닥: 헬스장 고무매트 (가장자리 흙 테두리)
    const rim = new THREE.Mesh(new THREE.CircleGeometry(R, 48), M(0x9b7b55, 1)); rim.rotation.x = -Math.PI / 2; rim.position.y = 0.0; rim.receiveShadow = true; gymScene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R - 1.1, 48), M(0x1c1d22, 0.95)); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true; gymScene.add(floor);
    for (let i = -8; i <= 8; i += 2) {   // 매트 이음선
      const len = 2 * Math.sqrt(Math.max(0, (R - 1.1) ** 2 - i * i));
      const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.03, len), M(0x1c1d21, 1)); l1.rotation.x = -Math.PI / 2; l1.position.set(i, 0.015, 0); gymScene.add(l1);
      const l2 = l1.clone(); l2.rotation.z = Math.PI / 2; l2.position.set(0, 0.015, i); gymScene.add(l2);
    }
    // 안전 난간
    const railM = M(0xc9c9cf, 0.4, 0.7);
    const NP = 30;
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2, x = Math.sin(a) * (R - 0.3), z = Math.cos(a) * (R - 0.3);
      if (z > 6.5 && Math.abs(x) < 4) continue;   // 앞쪽 계단 입구
      Cy(0.04, 1.0, railM, x, 0.5, z);
      const a2 = ((i + 1) / NP) * Math.PI * 2, x2 = Math.sin(a2) * (R - 0.3), z2 = Math.cos(a2) * (R - 0.3);
      if (z2 > 6.5 && Math.abs(x2) < 4) continue;
      const seg = Math.hypot(x2 - x, z2 - z);
      [0.95, 0.5].forEach((h) => { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, seg, 6), railM); r.position.set((x + x2) / 2, h, (z + z2) / 2); r.rotation.set(Math.PI / 2, 0, 0); r.lookAt(x2, h, z2); r.rotateX(Math.PI / 2); gymScene.add(r); });
    }
    // ── 구름 바다 + 구름 위로 솟은 먼 봉우리
    const cloudT = radialTexture('rgba(255,244,236,0.95)', 'rgba(255,230,220,0)');
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + (i % 5) * 0.21, r = 24 + ((i * 37) % 50);
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudT, transparent: true, depthWrite: false, opacity: 0.85 }));
      const k = 9 + ((i * 13) % 10);
      c.scale.set(k * 1.8, k * 0.7, 1); c.position.set(Math.sin(a) * r, -8 - (i % 4) * 1.3, Math.cos(a) * r); gymScene.add(c);
    }
    const snow = M(0xf4f1f6, 0.8);
    const peak = (a, r, h, col) => {
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6), MF(col)); m.position.set(x, -19 + h / 2, z); m.rotation.y = a * 3; gymScene.add(m);
      const s = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9 * 0.22, h * 0.22, 6), snow); s.position.set(x, -19 + h - h * 0.11 + 0.02, z); s.rotation.y = a * 3; gymScene.add(s);
    };
    [[0.3, 58, 17, 0x5b4f7c], [-0.5, 64, 20, 0x55497a], [-1.4, 52, 14, 0x63577f], [1.3, 60, 15, 0x5d5480], [2.4, 55, 13, 0x6a5d86], [-2.5, 62, 16, 0x584c7a], [3.1, 66, 14, 0x5f5280], [-0.1, 75, 22, 0x4d4472], [1.9, 70, 18, 0x564a7b], [-1.9, 72, 19, 0x52477a]].forEach(([a, r, h, c]) => peak(a + Math.PI, r, h, c));
    // 지는 해
    const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,240,200,1)', 'rgba(255,170,110,0)'), transparent: true, depthWrite: false, fog: false }));
    sunS.scale.set(22, 22, 1); sunS.position.set(-24, 4, -70); gymScene.add(sunS);
    // 조명
    gymScene.add(new THREE.HemisphereLight(0xffd9c0, 0x5a4a6a, 0.8));
    const sun = new THREE.DirectionalLight(0xffc28a, 1.35); sun.position.set(-8, 9, -6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 }); gymScene.add(sun);
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
    sx.fillStyle = '#fff'; sx.font = '900 104px -apple-system, "Apple SD Gothic Neo", sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText('⛰ 볼류머 산스장', 512, 116);
    const st = new THREE.CanvasTexture(sign); st.encoding = THREE.sRGBEncoding;
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshStandardMaterial({ map: st, roughness: 0.6, emissive: 0x222222 }));
    signM.position.set(0, 2.05, -10.2); gymScene.add(signM);
    // 📢 뒤쪽 대형 광고판 (가로로 길게)
    (() => {
      const W = 1400, H = 520, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d'); cx.fillStyle = '#111'; cx.fillRect(0, 0, W, H);
      const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
      const img = new Image();
      img.onload = () => {
        cx.drawImage(img, 0, 0, W, H);
        const g = cx.createLinearGradient(0, 0, 640, 0); g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g; cx.fillRect(0, 0, 640, H);
        cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
        cx.fillStyle = '#e8b923'; cx.font = '800 34px -apple-system, "Apple SD Gothic Neo", sans-serif'; cx.fillText('VOLUMER 산스장 공식 모델', 56, 150);
        cx.fillStyle = '#fff'; cx.font = '900 76px -apple-system, "Apple SD Gothic Neo", sans-serif';
        cx.fillText('볼륨은', 52, 260); cx.fillText('배신하지 않는다', 52, 350);
        cx.fillStyle = 'rgba(255,255,255,.75)'; cx.font = '600 30px -apple-system, "Apple SD Gothic Neo", sans-serif'; cx.fillText('오늘도 한 세트 더 — 해발 1,000m', 56, 420);
        tex.needsUpdate = true;
      };
      img.src = 'billboard.jpg';
      const bw = 9.6, bh = bw * H / W, by = 4.5, bz = -10.4;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      board.position.set(0, by, bz + 0.09); gymScene.add(board);
      const fm = M(0x15161a, 0.5, 0.6);
      B(bw + 0.35, bh + 0.35, 0.15, fm, 0, by, bz);
      [-bw * 0.32, bw * 0.32].forEach((x) => B(0.22, by + 6, 0.22, fm, x, (by - 6) / 2, bz - 0.2));
      B(bw * 0.8, 0.1, 0.5, fm, 0, by + bh / 2 + 0.3, bz + 0.25);
      for (let i = 0; i < 4; i++) { const x = -bw * 0.36 + i * bw * 0.24; B(0.12, 0.25, 0.35, M(0x333333, 0.4, 0.6), x, by + bh / 2 + 0.36, bz + 0.45);
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,240,200,.9)', 'rgba(255,240,200,0)'), transparent: true, depthWrite: false })); gl.scale.set(1.2, 1.2, 1); gl.position.set(x, by + bh / 2 + 0.2, bz + 0.6); gymScene.add(gl); }
    })();
    const black = M(0x1d1e22, 0.5, 0.5), steel = M(0xd9dbe0, 0.25, 0.9), plate = M(0x121214, 0.7, 0.2), red = M(0xd83a3a, 0.5, 0.3), pad = M(0x2b2c31, 0.6, 0.1), conc = M(0xa9a59c, 0.95);
    // 소나무 몇 그루 (가장자리)
    const trunkM = M(0x5a3b24), pineM = M(0x2f5a3a, 0.9), pineM2 = M(0x3b6b44, 0.9);
    const pine = (x, z, k) => { Cy(0.12 * k, 1.2 * k, trunkM, x, 0.6 * k, z); [0, 1, 2].forEach((j) => { const c = new THREE.Mesh(new THREE.ConeGeometry((1.0 - j * 0.25) * k, 1.3 * k, 8), j % 2 ? pineM2 : pineM); c.position.set(x, (1.4 + j * 0.75) * k, z); c.castShadow = true; gymScene.add(c); }); };
    [[-8.6, -3.6, 1.1], [8.4, -4.4, 1.0], [7.9, 4.6, 0.85], [-4.6, -8.6, 0.8], [8.2, 5.4, 0.8]].forEach(([x, z, k]) => pine(x, z, k));
    stations = { bench: [], rack: [], tread: [], db: [], mat: [], seat: [], jail: [] };
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
    } else if (k === 'rest') {
      f.position.y = (a.slot.sit || 0.5) - 0.95 + 0.05;
      rig.legs.forEach((l) => (l.rotation.x = -1.45));
      rig.arms[1].rotation.x = -1.4 - Math.max(0, Math.sin(t * 0.7)) * 0.5;   // 물 마시기
    }
  }

  function freeSlot(station) { const list = stations[station] || []; return list.find((x) => !x.busy) || null; }
  function pickTask(a) {
    if (a.jail) return 'jail';
    if (a.forced) { const k = a.forced; a.forced = null; return k; }
    const pool = a.live
      ? { '가슴': 'bench', '하체': 'squat', '유산소': 'run', '팔': 'curl', '등': 'curl', '어깨': 'bench', '축구': 'run' }[a.focus] || ['bench', 'squat', 'run', 'curl'][Math.floor(Math.random() * 4)]
      : (a.today ? ['stretch', 'rest', 'curl', 'run'] : ['rest', 'rest', 'stretch', 'run'])[Math.floor(Math.random() * 4)];
    return pool;
  }
  function goTo(a, k) {
    if (a.slot) { a.slot.busy = null; const br = a.slot.bar; if (br && br.position) br.position.y = a.slot.barX !== undefined ? 1.3 : 1.55; }
    let slot = freeSlot(TASKS[k].station);
    if (!slot && k === 'jail') slot = { x: 5.0 + (Math.random() - 0.5) * 1.6, z: -6.9 + (Math.random() - 0.5) * 1.6, face: 0, y: 0.16 };
    if (!slot) { k = 'stretch'; slot = freeSlot('mat') || freeSlot('seat'); }
    if (!slot) { slot = { x: (Math.random() - 0.5) * 6, z: 1 + Math.random() * 2, face: 0 }; k = 'stretch'; }
    slot.busy = a; a.slot = slot; a.task = k; a.mode = 'walk';
    a.tagSub(TASKS[k].label);
  }
  function buildGym(team) {
    if (!gymScene) buildGymScene();
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
      a = { id: m.id, nick: m.nick, me: m.me, live: m.live, today: m.today, focus: m.focus, jail: !!m.jail, g, fig: f, phase: i * 1.7, speed: 1, mode: 'walk', task: 'rest', slot: null, timer: 0, tagSub: setTag };
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
        if (d < 0.06) { p.x = sl.x; p.z = sl.z; a.mode = 'do'; a.timer = 14 + Math.random() * 16; a.g.rotation.y = sl.face; }
        else { const v = Math.min(d, 1.5 * dt); p.x += (dx / d) * v; p.z += (dz / d) * v; a.g.rotation.y = Math.atan2(dx, dz); }
      } else {
        a.timer -= dt;
        if (a.timer <= 0) goTo(a, pickTask(a));
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
  function startPhoto() {
    if (!gymScene || !agents.length) return false;
    const cam = new THREE.PerspectiveCamera(34, 4 / 3, 0.1, 260);
    cam.position.set(0, 1.55, 10.6); cam.lookAt(0, 1.5, 2.2);
    photo = { cam };
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
  function assign(id, k) {
    const a = agents.find((x) => x.id === id);
    if (!a || !TASKS[k] || a.jail) return false;
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
      gymCam.position.set(Math.sin(gymYaw) * 21, 12.5, Math.cos(gymYaw) * 21 + 1.5);
      gymCam.lookAt(0, -0.6, 0);
      updateAgents(dt, s);
      if (photo) {
        const w = box.clientWidth || 300, h = box.clientHeight || 360;
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
  return { show, assign, onPick: (fn) => { onPick = fn; }, tasks: TASKS, supported: () => !failed, startPhoto, endPhoto, snap, inPhoto: () => !!photo, poses: PHOTO_POSES };
})();
