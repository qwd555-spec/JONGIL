/* =========================================================
 * 🏟️ 선수 키우기 — 진짜 운동량(VP)으로 하는 육성 시뮬레이션
 *  · VP = 총 볼륨 10kg당 1점 (하루 1만kg ≈ 1,000VP ≈ 선택 1번)
 *  · 매 턴 선택지 3개, 하나 고를 때마다 1,000VP 사용
 *  · 종목: 축구 / 야구 / 올림피아(보디빌딩) / 러너
 *  · 몸은 진짜 운동 기록(상체·하체)만큼 커짐 → 많이 키우면 헐크
 * ========================================================= */
window.athlete = (() => {
  const KEY = 'gymlog.game';
  const COST = 1000;
  const VP_PER_KG = 1 / 10;

  /* ---- 종목별 커리어 (한국 선수 육성 경로 기준) ---- */
  const TRACKS = {
    soccer: {
      name: '축구선수', icon: '⚽', color: '#2f7cf6',
      stats: { sta: '체력', spd: '스피드', tec: '기술', fin: '결정력' },
      real: { sta: 'end', spd: 'low', tec: 'con', fin: 'low' },
      stages: [
        { name: '동네 축구 키드', gate: '유소년 클럽 입단 테스트', need: 8 },
        { name: '유소년 클럽 (U-12)', gate: '중등부 U-15 선발전', need: 18 },
        { name: '중등부 U-15', gate: 'K리그 유스(U-18) 입단 테스트', need: 30 },
        { name: 'K리그 유스 U-18', gate: '프로 콜업 · 준프로 계약', need: 42 },
        { name: 'K리그2 프로 데뷔', gate: 'K리그1 이적', need: 55 },
        { name: 'K리그1 주전', gate: '국가대표 소집', need: 68 },
        { name: '국가대표', gate: '유럽 빅리그 이적', need: 82 },
        { name: '유럽 빅리그', gate: '발롱도르 시상식', need: 95 },
        { name: '🏆 발롱도르 레전드' },
      ],
      train: [
        { t: '셔틀런 지옥훈련', d: '감독님 호루라기 소리가 꿈에 나와요', fx: { sta: 4, spd: 1 } },
        { t: '1:1 드리블 특훈', d: '콘 사이를 백 번 왕복', fx: { tec: 4, spd: 1 } },
        { t: '슈팅 500개', d: '골대 맞히면 벌칙 팔굽혀펴기', fx: { fin: 4, tec: 1 } },
        { t: '스프린트 인터벌', d: '30m 전력질주 × 20', fx: { spd: 4, sta: 1 } },
        { t: '전술 비디오 분석', d: '손흥민 침투 영상 무한반복', fx: { tec: 2, fin: 2 } },
        { t: '연습경기 풀타임 출전', d: '실전만 한 훈련은 없다', fx: { sta: 2, tec: 1, fin: 1 } },
        { t: '프리킥 개인훈련', d: '해 질 때까지 혼자 남아서', fx: { fin: 3, tec: 2 }, risk: 0 },
      ],
    },
    baseball: {
      name: '야구선수', icon: '⚾', color: '#d14b3c',
      stats: { pow: '파워', con: '컨택', def: '수비', men: '멘탈' },
      real: { pow: 'up', con: 'con', def: 'low', men: 'con' },
      stages: [
        { name: '리틀야구 꿈나무', gate: '중학교 야구부 입단', need: 8 },
        { name: '중학교 야구부', gate: '야구 명문고 스카우트', need: 18 },
        { name: '고교 야구부', gate: '황금사자기 · 청룡기 본선', need: 30 },
        { name: '고교 에이스', gate: 'KBO 신인 드래프트', need: 42 },
        { name: '퓨처스리그 (2군)', gate: '1군 콜업', need: 55 },
        { name: 'KBO 1군 주전', gate: '골든글러브 시상식', need: 68 },
        { name: '골든글러브 수상자', gate: 'WBC 국가대표 · MLB 포스팅', need: 82 },
        { name: 'MLB 진출', gate: 'MLB 올스타 · MVP', need: 95 },
        { name: '🏆 메이저리그 MVP' },
      ],
      train: [
        { t: '티배팅 1,000개', d: '손바닥 굳은살이 훈장', fx: { pow: 3, con: 2 } },
        { t: '펑고 지옥 수비훈련', d: '코치님이 끝없이 쳐줘요', fx: { def: 4, men: 1 } },
        { t: '웨이트 · 벌크업', d: '타구 속도는 근육에서', fx: { pow: 4, def: 1 } },
        { t: '선구안 훈련', d: '볼 하나 하나 끝까지 보기', fx: { con: 4, men: 1 } },
        { t: '야간 개인 스윙', d: '모두 잠든 실내연습장', fx: { con: 2, pow: 2 } },
        { t: '멘탈 코칭', d: '만루 상황 이미지 트레이닝', fx: { men: 4, con: 1 } },
        { t: '연습경기 선발 출전', d: '실전 감각 끌어올리기', fx: { pow: 1, con: 1, def: 1, men: 2 } },
      ],
    },
    olympia: {
      name: '올림피아 보디빌더', icon: '💪', color: '#e0457b',
      stats: { mas: '근매스', def: '선명도', sym: '대칭', pos: '포징' },
      real: { mas: 'up', def: 'end', sym: 'low', pos: 'con' },
      stages: [
        { name: '헬린이', gate: '첫 바디프로필 촬영', need: 8 },
        { name: '헬스장 고인물', gate: '지역 보디빌딩 대회 출전', need: 18 },
        { name: '지역 대회 입상자', gate: '전국체전 · 미스터 코리아', need: 30 },
        { name: '미스터 코리아', gate: 'IFBB 프로카드 퀄리파이어', need: 42 },
        { name: 'IFBB 프로', gate: '아놀드 클래식 초청', need: 55 },
        { name: '아놀드 클래식 입상', gate: '미스터 올림피아 퀄리파이', need: 68 },
        { name: '올림피아 출전 선수', gate: '올림피아 TOP 5', need: 82 },
        { name: '올림피아 TOP 5', gate: '샌도우 트로피 결승', need: 95 },
        { name: '🏆 미스터 올림피아' },
      ],
      train: [
        { t: '벌크업 시즌', d: '하루 6끼, 닭가슴살 1kg', fx: { mas: 5 } },
        { t: '컷팅 다이어트', d: '물 빼기 · 탄수화물 0g', fx: { def: 4, mas: -1 } },
        { t: '약점 부위 집중', d: '종아리 매일 하기', fx: { sym: 4, mas: 1 } },
        { t: '포징 연습 2시간', d: '거울 앞에서 미소 유지', fx: { pos: 4, sym: 1 } },
        { t: '고반복 펌핑 데이', d: '근육이 터질 것 같아요', fx: { mas: 2, def: 2 } },
        { t: '태닝 · 무대 리허설', d: '조명 아래 서보기', fx: { pos: 2, def: 2 } },
        { t: '하체 데이 2배', d: '다리가 상체를 따라잡게', fx: { sym: 3, mas: 2 } },
      ],
    },
    runner: {
      name: '러너', icon: '🏃', color: '#16a34a',
      stats: { end: '지구력', spd: '스피드', pac: '페이스', men: '멘탈' },
      real: { end: 'end', spd: 'low', pac: 'con', men: 'con' },
      stages: [
        { name: '동네 조깅러', gate: '첫 10K 대회 완주', need: 8 },
        { name: '10K 완주자', gate: '하프마라톤 완주', need: 18 },
        { name: '하프 마라토너', gate: '풀코스 서브4 도전', need: 30 },
        { name: '서브4 러너', gate: '서브3 · 마스터즈의 꿈', need: 42 },
        { name: '서브3 러너', gate: '실업팀 입단 테스트', need: 55 },
        { name: '실업팀 선수', gate: '동아·춘천마라톤 국내 1위', need: 68 },
        { name: '국가대표 마라토너', gate: '세계선수권 · 올림픽 출전', need: 82 },
        { name: '올림픽 마라토너', gate: '월드 메이저 마라톤 우승', need: 95 },
        { name: '🏆 보스턴 마라톤 챔피언' },
      ],
      train: [
        { t: 'LSD 30km', d: '느리게, 길게, 끝까지', fx: { end: 5 } },
        { t: '인터벌 400m × 12', d: '숨이 턱 끝까지', fx: { spd: 4, men: 1 } },
        { t: '템포런 10km', d: '목표 페이스 유지 훈련', fx: { pac: 4, end: 1 } },
        { t: '언덕 반복 달리기', d: '남산 순환로 5회', fx: { spd: 2, end: 2, men: 1 } },
        { t: '새벽 5시 러닝', d: '알람 3개 맞춰놓기', fx: { men: 4, end: 1 } },
        { t: '러닝 크루 합류', d: '같이 뛰면 덜 힘들어', fx: { pac: 2, men: 2, end: 1 } },
        { t: '하체 근력 보강', d: '부상 방지 스쿼트', fx: { spd: 2, pac: 1, end: 1 } },
      ],
    },
  };

  /* 공통 이벤트 (랜덤으로 끼어듦) */
  const EVENTS = [
    { t: '📸 SNS 훈련 영상 업로드', d: '조회수 터지면 팬이 늘어요', fx: { fans: 300 }, statAll: 0, chance: 0.6, win: '🔥 영상이 떡상했어요! 팬 +{fans}', lose: '😅 조회수 37회… 그래도 기록은 남았어요', winFx: { fans: 900 } },
    { t: '💪 무리한 오버트레이닝', d: '대박 성장 or 부상 (50%)', fx: {}, chance: 0.5, win: '🚀 한계를 넘었어요! 전 능력치 +3', lose: '🤕 부상… 재활하느라 전 능력치 -1', winFx: { all: 3 }, loseFx: { all: -1 } },
    { t: '🧘 휴식 · 컨디션 관리', d: '쉬는 것도 훈련이에요', fx: { all: 1 } },
    { t: '🎙️ 방송 인터뷰 출연', d: '"롤모델은 저 자신입니다"', fx: { fans: 500, mental: 1 } },
    { t: '🍗 치팅데이', d: '오늘만… 진짜 오늘만', fx: {}, chance: 0.5, win: '😋 행복 충전! 멘탈 회복으로 전 능력치 +1', lose: '🐷 3일 치팅으로 이어졌어요… 변화 없음', winFx: { all: 1 } },
    { t: '🏕️ 해외 전지훈련', d: '비싸지만 확실한 성장', fx: { all: 2, fans: 100 } },
  ];

  /* ---- 상태 ---- */
  const blank = () => ({ track: '', stage: 0, stats: {}, fans: 0, turn: 0, spent: 0, log: [], at: 0 });
  let G = (() => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return blank(); } })();
  if (G.track && !TRACKS[G.track]) G = blank();
  function persist() {
    G.at = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(G)); } catch {}
    try { cloud.markDirty(); } catch {}
  }
  /** 클라우드에서 불러온 상태 (더 진행된 쪽 사용) */
  function restore(remote) {
    if (!remote || typeof remote !== 'object') return;
    if ((remote.turn || 0) > (G.turn || 0) || (!G.track && remote.track)) {
      G = { ...blank(), ...remote };
      if (G.track && !TRACKS[G.track]) G = blank();
      try { localStorage.setItem(KEY, JSON.stringify(G)); } catch {}
    }
  }

  /* ---- 진짜 운동 기록 ---- */
  const lvVol = (v) => Math.floor(Math.sqrt(Math.max(0, v) / 2000));
  function real() {
    const v = { up: 0, low: 0, end: 0 };
    let total = 0, days = 0;
    for (const d of Object.keys(db)) {
      let any = false;
      for (const ex of db[d]) {
        const vol = exerciseVolume(ex, d);
        if (!(vol > 0)) continue;
        any = true; total += vol;
        if (cardioInfo(ex)) { v.end += vol; continue; }
        const p = partOf(ex.name);
        if (p === '하체') v.low += vol;
        else if (p === '복근' || p === '전신' || p === '내 운동') { v.up += vol / 2; v.low += vol / 2; }
        else v.up += vol;
      }
      if (any) days++;
    }
    const earned = Math.floor(total * VP_PER_KG);
    return { earned, up: lvVol(v.up), low: lvVol(v.low), end: lvVol(v.end * 1.6), con: Math.floor(Math.sqrt(days * 5)) };
  }
  const balance = (R) => Math.max(0, R.earned - (G.spent || 0));

  /* ---- 선택지 만들기 (턴마다 고정) ---- */
  function rng(seed) { let x = hashStr(String(seed)) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
  function ready() {
    const T = TRACKS[G.track], st = T.stages[G.stage];
    return st.need !== undefined && Object.keys(T.stats).every((k) => (G.stats[k] || 0) >= st.need);
  }
  function options() {
    const T = TRACKS[G.track];
    const r = rng(`${G.track}|${G.turn}|${G.stage}`);
    const pool = [...T.train];
    const out = [];
    while (out.length < 2) out.push({ kind: 'train', ...pool.splice(Math.floor(r() * pool.length), 1)[0] });
    if (ready()) {
      const st = T.stages[G.stage];
      out.push({ kind: 'gate', t: `🎯 도전: ${st.gate}`, d: `합격 확률 ${gateChance()}% · 실패해도 경험치는 남아요` });
    } else if (r() < 0.5) {
      out.push({ kind: 'event', ...EVENTS[Math.floor(r() * EVENTS.length)] });
    } else {
      out.push({ kind: 'train', ...pool[Math.floor(r() * pool.length)] });
    }
    return out;
  }
  function gateChance() {
    const T = TRACKS[G.track], st = T.stages[G.stage];
    const over = Object.keys(T.stats).reduce((a, k) => a + Math.max(0, (G.stats[k] || 0) - st.need), 0);
    return Math.min(95, 55 + over * 4 + Math.min(10, Math.floor((G.fans || 0) / 2000)));
  }
  // 진짜 운동 기록 보너스: 해당 능력치와 연결된 실제 레벨 10당 +1
  function bonus(k, R) { const map = TRACKS[G.track].real; return Math.floor((R[map[k]] || 0) / 10); }
  function applyFx(fx, R) {
    const T = TRACKS[G.track], gains = [];
    for (const k of Object.keys(T.stats)) {
      let d = (fx[k] || 0) + (fx.all || 0) + (k === 'men' && fx.mental ? fx.mental : 0);
      if (d > 0) d += bonus(k, R);
      if (!d) continue;
      G.stats[k] = Math.max(0, Math.min(120, (G.stats[k] || 0) + d));
      gains.push(`${T.stats[k]} ${d > 0 ? '+' : ''}${d}`);
    }
    if (fx.fans) { G.fans = (G.fans || 0) + fx.fans; gains.push(`팬 +${fx.fans.toLocaleString()}`); }
    return gains;
  }

  async function choose(i) {
    const R = real();
    if (balance(R) < COST) { toast(`VP가 부족해요 · 운동으로 ${((COST - balance(R)) / VP_PER_KG).toLocaleString()}kg 더 채우면 돼요`); return; }
    const opt = options()[i];
    if (!opt) return;
    const T = TRACKS[G.track];
    const r = rng(`${G.track}|${G.turn}|pick${i}|${Date.now()}`);
    let msg = '', gains = [];
    if (opt.kind === 'gate') {
      const ok = r() * 100 < gateChance();
      if (ok) {
        G.stage++;
        gains = applyFx({ fans: 500 * G.stage }, R);
        msg = `🎉 합격! "${T.stages[G.stage].name}" 이 되었어요`;
      } else {
        gains = applyFx({ all: 1 }, R);
        msg = `😢 ${T.stages[G.stage].gate} 아쉽게 불합격… 다음엔 꼭!`;
      }
    } else if (opt.kind === 'event' && opt.chance) {
      const ok = r() < opt.chance;
      gains = applyFx({ ...(opt.fx || {}), ...((ok ? opt.winFx : opt.loseFx) || {}) }, R);
      msg = (ok ? opt.win : opt.lose).replace('{fans}', String(((opt.winFx || {}).fans || 0).toLocaleString()));
    } else {
      gains = applyFx(opt.fx || {}, R);
      msg = `${opt.t} 완료!`;
    }
    G.spent = (G.spent || 0) + COST;
    G.turn++;
    G.log = [{ m: msg, g: gains.join(' · '), at: Date.now() }, ...(G.log || [])].slice(0, 6);
    persist();
    render();
    const box = $('#ath-result');
    box.hidden = false;
    box.innerHTML = `<b>${escapeHtml(msg)}</b>${gains.length ? `<span>${escapeHtml(gains.join(' · '))}</span>` : ''}`;
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
  }

  /* ---- 캐릭터 그리기 (진짜 상체·하체 레벨만큼 근비대) ---- */
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function drawAthlete({ up = 0, low = 0, track = '', mood = 'happy', size = 200 }) {
    const U = Math.min(up, 40), L = Math.min(low, 40);
    const hulk = Math.max(0, Math.min(1, ((U + L) / 2 - 16) / 14));
    const skin = hulk > 0 ? mix('#f3c9a2', '#6fbf4a', hulk) : '#f3c9a2';
    const skinD = hulk > 0 ? mix('#d9a57c', '#3f8a2b', hulk) : '#d9a57c';
    const shirt = TRACKS[track] ? TRACKS[track].color : '#3a3a42';
    const cx = 100, sh = 26 + U * 1.55, waist = 17 + U * 0.45 + L * 0.15, arm = 7 + U * 0.62;
    const bic = arm * (1.25 + U / 60), leg = 9 + L * 0.72, neck = 7 + U * 0.35, headR = 17;
    const topY = 82, waistY = 150, hipY = 168, footY = 246;
    const lx = cx - waist + leg * 0.55, rx = cx + waist - leg * 0.55, armTop = topY + 6;
    const ripped = hulk > 0.35;
    const face = mood === 'happy' ? `<path d="M${cx - 6} 62 q6 6 12 0" stroke="#222" stroke-width="2" fill="none" stroke-linecap="round"/>`
      : mood === 'ok' ? `<path d="M${cx - 5} 64 h10" stroke="#222" stroke-width="2" stroke-linecap="round"/>`
      : `<path d="M${cx - 6} 66 q6 -5 12 0" stroke="#222" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M${cx + 12} 50 q2 5 0 7" stroke="#7cc4ff" stroke-width="2" fill="none"/>`;
    const brow = hulk > 0.5 ? `<path d="M${cx - 11} 47 l8 3M${cx + 11} 47 l-8 3" stroke="#222" stroke-width="2.4" stroke-linecap="round"/>` : '';
    const acc = {
      soccer: `<circle cx="${rx + leg + 14}" cy="${footY - 6}" r="11" fill="#fff" stroke="#222" stroke-width="1.5"/><path d="M${rx + leg + 14} ${footY - 12} l5 4 -2 6 h-6 l-2 -6 z" fill="#222"/>`,
      baseball: `<path d="M${cx - headR - 2} 50 q${headR + 2} -24 ${headR * 2 + 4} 0 z" fill="${shirt}"/><rect x="${cx - 4}" y="46" width="${headR + 10}" height="5" rx="2" fill="${shirt}"/><rect x="${cx + sh + 8}" y="${armTop + 30}" width="6" height="70" rx="3" fill="#b07a3b" transform="rotate(-25 ${cx + sh + 11} ${armTop + 80})"/>`,
      olympia: `<rect x="${cx - waist - 2}" y="${hipY - 18}" width="${(waist + 2) * 2}" height="18" rx="5" fill="${shirt}"/>`,
      runner: `<rect x="${cx - headR}" y="40" width="${headR * 2}" height="6" rx="3" fill="${shirt}"/><rect x="${cx - 12}" y="${topY + 30}" width="24" height="16" rx="2" fill="#fff" stroke="#222" stroke-width="1"/><text x="${cx}" y="${topY + 42}" font-size="9" text-anchor="middle" font-weight="800" fill="#222">42</text>`,
    }[track] || '';
    const tank = track === 'olympia' ? '' : `<path d="M${cx - sh * 0.62} ${topY + 2} L${cx - waist} ${waistY} L${cx + waist} ${waistY} L${cx + sh * 0.62} ${topY + 2} L${cx + 10} ${topY + 2} Q${cx} ${topY + 18} ${cx - 10} ${topY + 2} Z" fill="${shirt}"/>`
      + (ripped ? `<path d="M${cx - waist} ${waistY - 2} l6 -10 5 8 6 -12 5 10 6 -9 5 11 6 -10 5 9 6 -8" stroke="${skin}" stroke-width="5" fill="none"/>` : '');
    return `<svg viewBox="-45 0 290 262" width="${size * 1.45}" height="${size * 1.31}" class="athlete-svg" aria-hidden="true">
      <ellipse cx="${cx}" cy="${footY + 6}" rx="${Math.max(48, sh + 10)}" ry="7" fill="rgba(0,0,0,.12)"/>
      <rect x="${lx - leg}" y="${hipY - 6}" width="${leg * 2}" height="${footY - hipY + 2}" rx="${leg}" fill="${skin}"/>
      <rect x="${rx - leg}" y="${hipY - 6}" width="${leg * 2}" height="${footY - hipY + 2}" rx="${leg}" fill="${skin}"/>
      <ellipse cx="${lx}" cy="${hipY + 22}" rx="${leg * 1.12}" ry="${22 + L * 0.3}" fill="${skin}"/>
      <ellipse cx="${rx}" cy="${hipY + 22}" rx="${leg * 1.12}" ry="${22 + L * 0.3}" fill="${skin}"/>
      ${L >= 8 ? `<path d="M${lx} ${hipY + 8} v24M${rx} ${hipY + 8} v24" stroke="${skinD}" stroke-width="1.5"/>` : ''}
      <ellipse cx="${lx - 2}" cy="${footY}" rx="${leg * 0.9 + 4}" ry="6" fill="#222"/>
      <ellipse cx="${rx + 2}" cy="${footY}" rx="${leg * 0.9 + 4}" ry="6" fill="#222"/>
      <path d="M${cx - waist - 2} ${waistY - 2} H${cx + waist + 2} L${rx + leg + 3} ${hipY + 20} H${cx + 3} L${cx} ${hipY + 4} L${cx - 3} ${hipY + 20} H${lx - leg - 3} Z" fill="#26262b"/>
      <g fill="${skin}">
        <rect x="${cx - sh - arm}" y="${armTop}" width="${arm * 2}" height="78" rx="${arm}" transform="rotate(10 ${cx - sh} ${armTop})"/>
        <rect x="${cx + sh - arm}" y="${armTop}" width="${arm * 2}" height="78" rx="${arm}" transform="rotate(-10 ${cx + sh} ${armTop})"/>
        <ellipse cx="${cx - sh - 4}" cy="${armTop + 26}" rx="${bic}" ry="${bic * 1.15}"/>
        <ellipse cx="${cx + sh + 4}" cy="${armTop + 26}" rx="${bic}" ry="${bic * 1.15}"/>
        <circle cx="${cx - sh - 12}" cy="${armTop + 80}" r="${arm * 0.9 + 2}"/>
        <circle cx="${cx + sh + 12}" cy="${armTop + 80}" r="${arm * 0.9 + 2}"/>
      </g>
      <path d="M${cx - sh} ${topY + 4} Q${cx} ${topY - 10} ${cx + sh} ${topY + 4} L${cx + waist} ${waistY + 4} L${cx - waist} ${waistY + 4} Z" fill="${skin}"/>
      <circle cx="${cx - sh}" cy="${topY + 8}" r="${arm * 1.15 + 3}" fill="${skin}"/>
      <circle cx="${cx + sh}" cy="${topY + 8}" r="${arm * 1.15 + 3}" fill="${skin}"/>
      ${U >= 6 ? `<path d="M${cx} ${topY + 10} v${22 + U * 0.3}M${cx - sh * 0.55} ${topY + 30 + U * 0.3} q${sh * 0.55} 10 ${sh * 1.1} 0" stroke="${skinD}" stroke-width="1.6" fill="none"/>` : ''}
      ${U >= 10 && track === 'olympia' ? `<path d="M${cx - 8} ${topY + 52} h16M${cx - 8} ${topY + 62} h16M${cx - 7} ${topY + 72} h14" stroke="${skinD}" stroke-width="1.4"/>` : ''}
      ${tank}
      <rect x="${cx - neck}" y="66" width="${neck * 2}" height="22" rx="${Math.min(neck, 8)}" fill="${skin}"/>
      <circle cx="${cx}" cy="56" r="${headR}" fill="${skin}"/>
      <path d="M${cx - headR} 52 q${headR} -26 ${headR * 2} 0 q-6 -8 -${headR} -9 q-${headR - 6} 1 -${headR} 9z" fill="#2b2118"/>
      ${acc}
      <circle cx="${cx - 6}" cy="56" r="2" fill="#222"/><circle cx="${cx + 6}" cy="56" r="2" fill="#222"/>
      ${brow}${face}
    </svg>`;
  }
  function restDays() { for (let i = 0; i < 30; i++) if (dayVolume(addDays(todayStr(), -i)) > 0) return i; return 30; }

  /* ---- 화면 ---- */
  function render() {
    const R = real();
    const bal = balance(R);
    const T = TRACKS[G.track];
    const rest = restDays();
    $('#ath-figure').innerHTML = drawAthlete({ up: R.up, low: R.low, track: G.track, mood: rest <= 1 ? 'happy' : rest <= 3 ? 'ok' : 'sad', size: 190 });
    let nick = '나'; try { nick = social.nick() || '나'; } catch {}
    $('#ath-name').textContent = nick;
    $('#ath-track').textContent = T ? `${T.icon} ${T.name}` : '종목 미정';
    $('#ath-track').classList.toggle('none', !T);
    $('#ath-stage').textContent = T ? T.stages[G.stage].name : '어떤 선수가 될지 골라주세요';
    $('#ath-hulk').hidden = (Math.min(R.up, 40) + Math.min(R.low, 40)) / 2 < 16;
    $('#ath-vp').innerHTML = `<b>${bal.toLocaleString()}</b> VP <small>선택 1번 = ${COST.toLocaleString()} VP · 볼륨 10kg = 1 VP</small>`;

    $('#ath-setup').hidden = !!T;
    $('#ath-game').hidden = !T;
    if (!T) { renderTrackPick(); renderTeam(); return; }

    // 능력치
    $('#ath-stats').innerHTML = Object.entries(T.stats).map(([k, name]) => {
      const v = G.stats[k] || 0, need = T.stages[G.stage].need;
      const b = bonus(k, R);
      return `<div class="ath-stat ${need !== undefined && v >= need ? 'ok' : ''}">
        <span class="ath-stat-name">${name}</span>
        <span class="ath-stat-bar"><span style="width:${Math.min(100, v)}%"></span>${need !== undefined ? `<i style="left:${Math.min(100, need)}%"></i>` : ''}</span>
        <span class="ath-stat-lv">${v}${b ? `<small>+${b}</small>` : ''}</span>
      </div>`;
    }).join('') + `<p class="ath-fans">팬 ${(G.fans || 0).toLocaleString()}명${T.stages[G.stage].need !== undefined ? ` · 세로선까지 채우면 <b>${escapeHtml(T.stages[G.stage].gate)}</b> 도전 가능` : ''}</p>`;

    // 선택지
    const done = T.stages[G.stage].need === undefined;
    const opts = done ? [] : options();
    const can = bal >= COST;
    $('#ath-choices').innerHTML = done ? '<p class="ath-legend">👑 커리어의 정점에 올랐어요. 당신은 전설입니다.</p>'
      : opts.map((o, i) => `<button type="button" class="ath-opt ${o.kind}" data-i="${i}" ${can ? '' : 'disabled'}>
        <span class="ath-opt-t">${escapeHtml(o.t)}</span>
        <span class="ath-opt-d">${escapeHtml(o.d || '')}</span>
        <span class="ath-opt-fx">${o.kind === 'gate' ? '단계 승급 도전' : fxText(o, T)}</span>
        <span class="ath-opt-cost">−${COST.toLocaleString()} VP</span>
      </button>`).join('');
    $('#ath-choices').querySelectorAll('.ath-opt').forEach((b) => b.addEventListener('click', () => choose(+b.dataset.i)));
    $('#ath-need').hidden = can || done;
    $('#ath-need').textContent = `VP가 부족해요 · 운동으로 볼륨 ${((COST - bal) / VP_PER_KG).toLocaleString()}kg 더 채우면 선택할 수 있어요`;

    // 최근 기록
    $('#ath-log').innerHTML = (G.log || []).slice(0, 4).map((l) => `<div><b>${escapeHtml(l.m)}</b>${l.g ? `<span>${escapeHtml(l.g)}</span>` : ''}</div>`).join('');
    $('#ath-log').hidden = !(G.log || []).length;
    renderTeam();
  }
  function fxText(o, T) {
    if (o.chance) return '운에 맡기기 🎲';
    const fx = o.fx || {}, parts = [];
    for (const [k, n] of Object.entries(T.stats)) { const d = (fx[k] || 0) + (fx.all || 0); if (d) parts.push(`${n} ${d > 0 ? '+' : ''}${d}`); }
    if (fx.fans) parts.push(`팬 +${fx.fans}`);
    return parts.join(' · ');
  }
  function renderTrackPick() {
    $('#ath-tracks').innerHTML = Object.entries(TRACKS).map(([k, t]) => `<button type="button" class="track-opt" data-t="${k}" style="--tc:${t.color}">
      <span class="track-icon">${t.icon}</span>
      <span class="track-main"><b>${t.name}</b><small>${Object.values(t.stats).join(' · ')}</small><small>${t.stages[0].name} → ${t.stages[t.stages.length - 1].name.replace('🏆 ', '')}</small></span>
    </button>`).join('');
    $('#ath-tracks').querySelectorAll('.track-opt').forEach((b) => b.addEventListener('click', () => {
      const keepSpent = G.spent || 0;
      G = { ...blank(), track: b.dataset.t, spent: keepSpent };
      for (const k of Object.keys(TRACKS[G.track].stats)) G.stats[k] = 0;
      persist();
      toast(`${TRACKS[G.track].icon} ${TRACKS[G.track].name}의 길을 시작해요!`);
      render();
    }));
  }
  $('#ath-reset').addEventListener('click', async () => {
    if (!(await askConfirm('종목을 바꾸면 선수 육성이 처음부터 다시 시작돼요.\n(쓴 VP는 돌아오지 않아요)', { okText: '다시 시작', danger: true }))) return;
    G = { ...blank(), spent: G.spent || 0 };
    persist(); render();
  });

  function renderTeam() {
    let members = {}, myId = null;
    try { members = social.members(); myId = social.id(); } catch {}
    const ids = Object.keys(members);
    $('#ath-team-panel').hidden = ids.length < 2;
    if (ids.length < 2) return;
    const rows = ids.map((id) => {
      const m = members[id];
      if (id === myId) { const R = real(); return { id, nick: m.nick, t: G.track, stage: G.stage, up: R.up, low: R.low }; }
      const c = m.char || {};
      return { id, nick: m.nick, t: TRACKS[c.t] ? c.t : '', stage: num(c.st), up: num((c.s || {}).u), low: num((c.s || {}).l) };
    }).sort((a, b) => b.stage - a.stage);
    $('#ath-team').innerHTML = rows.map((r) => `<button type="button" class="ath-mate ${r.id === myId ? 'me' : ''}" data-id="${escapeHtml(r.id)}">
      <span class="ath-mate-fig">${drawAthlete({ up: r.up, low: r.low, track: r.t, size: 62 })}</span>
      <b>${escapeHtml(r.nick)}</b>
      <small>${r.t ? `${TRACKS[r.t].icon} ${escapeHtml(TRACKS[r.t].stages[Math.min(r.stage, TRACKS[r.t].stages.length - 1)].name)}` : '종목 미정'}</small>
    </button>`).join('');
    $('#ath-team').querySelectorAll('.ath-mate').forEach((b) => b.addEventListener('click', () => { try { social.openProfile(b.dataset.id); } catch {} }));
  }

  /** 친구들에게 보일 내 선수 요약 */
  function summary() { const R = real(); return { t: G.track, st: G.stage, s: { u: R.up, l: R.low } }; }
  const state = () => G;

  return { render, summary, state, restore, draw: drawAthlete };
})();
