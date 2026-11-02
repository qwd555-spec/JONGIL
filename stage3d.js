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
  function makeFigure({ up = 0, low = 0, color = '#3a3a42', track = '', stage = 0 }) {
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
    bench: { label: '💪 녹슨 벤치프레스', station: 'bench' },
    squat: { label: '🏋️ 역기 스쿼트', station: 'rack' },
    run: { label: '🚶 하늘걷기', station: 'tread' },
    curl: { label: '🧗 철봉 턱걸이', station: 'db' },
    stretch: { label: '🌀 허리돌리기', station: 'mat' },
    rest: { label: '🥤 약수 한 사발', station: 'seat' },
  };
  let gymScene = null, gymCam = null, stations = {}, agents = [], gymYaw = 0.25, onPick = null;
  function buildGymScene() {
    /* ⛰️ 볼류머 산스장 — 해 질 녘 산 위 야외 운동기구 */
    gymScene = new THREE.Scene();
    const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256;
    const kx = sky.getContext('2d'), sg = kx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, '#2b2d5c'); sg.addColorStop(0.45, '#8a5a8f'); sg.addColorStop(0.75, '#f08a5d'); sg.addColorStop(1, '#ffd29a');
    kx.fillStyle = sg; kx.fillRect(0, 0, 4, 256);
    const skyT = new THREE.CanvasTexture(sky); skyT.encoding = THREE.sRGBEncoding;
    gymScene.background = skyT;
    gymScene.fog = new THREE.Fog(0xc98a7a, 26, 70);
    gymCam = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    const M = (c, r = 0.85, m = 0.05, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e || 0x000000, flatShading: false });
    const B = (w, h, d, mat, x, y, z, par = gymScene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
    const Cy = (r, h, mat, x, y, z, rx = 0, rz = 0, par = gymScene) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; par.add(o); return o; };
    // 땅: 흙 마당 + 풀
    const grass = new THREE.Mesh(new THREE.CircleGeometry(60, 48), M(0x4a6b3a, 1)); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.01; grass.receiveShadow = true; gymScene.add(grass);
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(9.5, 40), M(0x9b7b55, 1)); dirt.rotation.x = -Math.PI / 2; dirt.receiveShadow = true; gymScene.add(dirt);
    // 먼 산 능선 (겹겹이)
    const ridge = (dist, h, col, n, seed) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + seed; const r = dist + Math.sin(i * 3.1 + seed) * 4; const hh = h * (0.7 + ((i * 37) % 10) / 20); const m = new THREE.Mesh(new THREE.ConeGeometry(hh * 1.5, hh, 5), new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true })); m.position.set(Math.sin(a) * r, hh / 2 - 0.5, Math.cos(a) * r); m.rotation.y = i; gymScene.add(m); } };
    ridge(48, 16, 0x5d4f7a, 18, 0.2); ridge(34, 9, 0x4a5a63, 16, 1.1);
    // 해 (지는 해)
    const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,236,190,1)', 'rgba(255,170,110,0)'), transparent: true, depthWrite: false, fog: false }));
    sunS.scale.set(14, 14, 1); sunS.position.set(-18, 7, -45); gymScene.add(sunS);
    // 조명
    gymScene.add(new THREE.HemisphereLight(0xffc9a8, 0x3b4a2c, 0.75));
    const sun = new THREE.DirectionalLight(0xffb27a, 1.35); sun.position.set(-8, 7, -6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 }); gymScene.add(sun);
    // 소나무
    const trunkM = M(0x5a3b24), pineM = M(0x2f5a3a, 0.9), pineM2 = M(0x3b6b44, 0.9);
    const pine = (x, z, k) => { Cy(0.12 * k, 1.2 * k, trunkM, x, 0.6 * k, z); [0, 1, 2].forEach((j) => { const c = new THREE.Mesh(new THREE.ConeGeometry((1.0 - j * 0.25) * k, 1.3 * k, 8), j % 2 ? pineM2 : pineM); c.position.set(x, (1.4 + j * 0.75) * k, z); c.castShadow = true; gymScene.add(c); }); };
    for (let i = 0; i < 34; i++) { const a = (i / 34) * Math.PI * 2 + 0.3; const r = 10.5 + ((i * 7) % 5) * 0.9; if (Math.sin(a) > 0.5 && Math.cos(a) > -0.2 && r < 12) continue; pine(Math.sin(a) * r, Math.cos(a) * r, 0.9 + ((i * 13) % 6) / 10); }
    const rockM = M(0x8a8a86, 0.95);
    [[-7.5, 6], [7.8, 5.5], [-8.6, -4], [6.5, -6.5], [8.6, 0.5]].forEach(([x, z], i) => { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + (i % 3) * 0.25), rockM); r.position.set(x, 0.25, z); r.rotation.set(i, i * 2, 0); r.castShadow = true; gymScene.add(r); });
    // 나무 간판
    const sign = document.createElement('canvas'); sign.width = 1024; sign.height = 220;
    const sx = sign.getContext('2d'); sx.fillStyle = '#6b4a2e'; sx.fillRect(0, 0, 1024, 220); sx.strokeStyle = '#3f2a18'; sx.lineWidth = 16; sx.strokeRect(8, 8, 1008, 204);
    sx.fillStyle = '#fff3d6'; sx.font = '900 112px -apple-system, "Apple SD Gothic Neo", sans-serif'; sx.textAlign = 'center'; sx.textBaseline = 'middle'; sx.fillText('⛰ 볼류머 산스장', 512, 116);
    const st = new THREE.CanvasTexture(sign); st.encoding = THREE.sRGBEncoding;
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshStandardMaterial({ map: st, roughness: 0.9 }));
    signM.position.set(0, 2.6, -7.2); gymScene.add(signM); Cy(0.08, 2.6, trunkM, -1.9, 1.3, -7.25); Cy(0.08, 2.6, trunkM, 1.9, 1.3, -7.25);
    // 산스장 기구 (초록 · 파랑 · 노랑 페인트, 콘크리트 원판)
    const green = M(0x2e9e6a, 0.5, 0.3), blue = M(0x2f6fd6, 0.5, 0.3), yellow = M(0xe8b923, 0.5, 0.3), rust = M(0x8a5a3a, 0.8, 0.4), conc = M(0xa9a59c, 0.95);
    stations = { bench: [], rack: [], tread: [], db: [], mat: [], seat: [] };
    // 녹슨 벤치프레스 2대 (왼쪽)
    [-1.3, 1.3].forEach((dz) => {
      const x = -5.2, z = -1 + dz;
      B(1.5, 0.12, 0.42, blue, x, 0.48, z); B(0.12, 0.45, 0.12, rust, x - 0.5, 0.22, z); B(0.12, 0.45, 0.12, rust, x + 0.5, 0.22, z);
      Cy(0.035, 0.95, rust, x - 0.55, 0.95, z - 0.45); Cy(0.035, 0.95, rust, x - 0.55, 0.95, z + 0.45);
      const bar = Cy(0.03, 1.9, rust, x - 0.55, 1.3, z, Math.PI / 2); Cy(0.22, 0.12, conc, x - 0.55, 1.3, z - 0.82, Math.PI / 2); Cy(0.22, 0.12, conc, x - 0.55, 1.3, z + 0.82, Math.PI / 2);
      stations.bench.push({ x: x + 0.15, z, face: Math.PI / 2, bar, barX: x - 0.55, busy: null });
    });
    // 역기 (스쿼트) 2개 — 콘크리트 원판 바벨 + 받침대
    [-2.2, 0.4].forEach((x) => {
      const z = -4.4;
      B(0.12, 1.45, 0.12, yellow, x - 0.75, 0.72, z); B(0.12, 1.45, 0.12, yellow, x + 0.75, 0.72, z);
      const bar = Cy(0.03, 2.1, rust, x, 1.55, z + 0.05, 0, Math.PI / 2); Cy(0.27, 0.16, conc, x - 0.92, 1.55, z + 0.05, 0, Math.PI / 2); Cy(0.27, 0.16, conc, x + 0.92, 1.55, z + 0.05, 0, Math.PI / 2);
      stations.rack.push({ x, z: z + 0.05, face: 0, bar, busy: null });
    });
    // 하늘걷기 3대 (오른쪽 뒤)
    [3.1, 4.6, 6.1].forEach((x) => {
      const z = -4.2;
      const fr = new THREE.Group(); fr.position.set(x, 0, z); gymScene.add(fr);
      [-0.45, 0.45].forEach((dx) => { const l = Cy(0.06, 2.2, green, dx, 1.05, -0.35, 0.3, 0, fr); const l2 = Cy(0.06, 2.2, green, dx, 1.05, 0.35, -0.3, 0, fr); });
      Cy(0.06, 1.0, green, 0, 2.05, 0, 0, Math.PI / 2, fr);
      B(0.8, 0.06, 0.06, green, 0, 1.4, 0.35, fr);
      stations.tread.push({ x, z: z + 0.05, y: 0.3, face: 0, busy: null });
    });
    // 철봉 3단 (오른쪽)
    [[5.6, -0.6, 2.3], [5.6, 0.9, 2.15], [5.6, 2.4, 2.0]].forEach(([x, z, h]) => {
      Cy(0.06, h, yellow, x, h / 2, z - 0.55); Cy(0.06, h, yellow, x, h / 2, z + 0.55);
      Cy(0.03, 1.15, rust, x, h, z, Math.PI / 2);
      stations.db.push({ x: x + 0.02, z, face: Math.PI / 2, bar: h, busy: null });
    });
    // 허리돌리기 (가운데 앞)
    [[-1.6, 2.4], [0, 2.4], [1.6, 2.4], [-0.8, 3.8], [0.8, 3.8]].forEach(([x, z]) => {
      Cy(0.42, 0.1, blue, x, 0.08, z);
      Cy(0.05, 1.1, blue, x, 0.65, z - 0.5); Cy(0.04, 0.6, blue, x, 1.2, z - 0.4, Math.PI / 2 * 0, Math.PI / 2);
      stations.mat.push({ x, z, face: 0, y: 0.13, busy: null });
    });
    // 팔각정 + 약수터 (왼쪽 앞)
    const pz = 4.2, px = -5.4;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.25, 8), M(0x7a5232, 0.8)); deck.position.set(px, 0.12, pz); deck.receiveShadow = true; deck.castShadow = true; gymScene.add(deck);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; Cy(0.09, 2.2, M(0xa0442a, 0.7), px + Math.cos(a) * 1.8, 1.35, pz + Math.sin(a) * 1.8); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.2, 8), M(0x3d4a3a, 0.8)); roof.position.set(px, 3.05, pz); roof.rotation.y = Math.PI / 8; roof.castShadow = true; gymScene.add(roof);
    const eave = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 0.12, 8), M(0xa0442a, 0.7)); eave.position.set(px, 2.48, pz); eave.rotation.y = Math.PI / 8; gymScene.add(eave);
    B(1.0, 0.9, 0.7, conc, -8.0, 0.45, 1.6); Cy(0.03, 0.5, rust, -7.6, 0.85, 1.6, 0, Math.PI / 2);
    const water = Cy(0.025, 0.55, new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7, emissive: 0x1b4a6b }), -7.35, 0.55, 1.6);
    B(0.7, 0.18, 0.5, conc, -7.35, 0.09, 1.6);
    [[-0.9, 0], [0, -0.3], [0.9, 0]].forEach(([dx, dz]) => stations.seat.push({ x: px + dx, z: pz + dz, face: 0, sit: 0.75, busy: null }));
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
    if (k === 'run') {   // 하늘걷기: 크게 앞뒤로
      const w = Math.sin(t * 3.2) * 0.75;
      rig.legs[0].rotation.x = w; rig.legs[1].rotation.x = -w;
      rig.arms.forEach((r) => (r.rotation.x = -1.25));
      f.position.y = a.slot.y;
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
      ? { '가슴': 'bench', '하체': 'squat', '유산소': 'run', '팔': 'curl', '등': 'curl', '어깨': 'bench', '축구': 'run' }[a.focus] || ['bench', 'squat', 'run', 'curl'][Math.floor(Math.random() * 4)]
      : (a.today ? ['stretch', 'rest', 'curl', 'run'] : ['rest', 'rest', 'stretch', 'run'])[Math.floor(Math.random() * 4)];
    return pool;
  }
  function goTo(a, k) {
    if (a.slot) { a.slot.busy = null; const br = a.slot.bar; if (br && br.position) br.position.y = a.slot.barX !== undefined ? 1.3 : 1.55; }
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
      gymCam.position.set(Math.sin(gymYaw) * 17, 11.5, Math.cos(gymYaw) * 17 + 1.5);
      gymCam.lookAt(0, 0.4, 0);
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
  return { show, assign, onPick: (fn) => { onPick = fn; }, tasks: TASKS, supported: () => !failed };
})();
