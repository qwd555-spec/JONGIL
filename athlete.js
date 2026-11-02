/* =========================================================
 * 🏟️ 선수 키우기 — 진짜 운동량으로 가상 선수 육성
 *  · 볼륨 포인트(VP) = 총 볼륨 100kg당 1점
 *  · 능력치: 상체 / 하체 / 지구력 / 꾸준함 (평생 누적 기록에서 계산)
 *  · 커리어: 동네 헬린이 → 중학교 체육부 → 체육고(종목 선택) → 체대 → … → 레전드
 *  · 몸은 능력치만큼 커지고, 많이 키우면 헐크가 됨
 * ========================================================= */
window.athlete = (() => {
  const TRACK_KEY = 'gymlog.athleteTrack';
  const VP_PER_KG = 1 / 100;

  const TRACKS = {
    soccer: { name: '축구', icon: '⚽', color: '#2f7cf6', keys: ['end', 'low'],
      stages: ['K3리그 입단', 'K리그 데뷔', '국가대표 발탁', '발롱도르 레전드'] },
    body: { name: '보디빌딩', icon: '💪', color: '#e0457b', keys: ['up', 'low'],
      stages: ['지역 대회 입상', '프로 카드 획득', '미스터 코리아', '미스터 올림피아'] },
    marathon: { name: '마라톤', icon: '🏃', color: '#16a34a', keys: ['end', 'con'],
      stages: ['실업팀 입단', '전국체전 금메달', '국가대표 발탁', '올림픽 금메달'] },
    lifting: { name: '역도', icon: '🏋️', color: '#f59e0b', keys: ['low', 'up'],
      stages: ['실업팀 입단', '전국체전 우승', '국가대표 발탁', '올림픽 금메달'] },
  };
  const BASE_STAGES = ['동네 헬린이', '중학교 체육부', '체육고 진학', '체대 진학'];
  const VP_NEED = [0, 100, 500, 1500, 3500, 7000, 12000, 20000];
  const STAT_NEED = [0, 0, 0, 4, 7, 10, 14, 18];
  const STAT_NAMES = { up: '상체', low: '하체', end: '지구력', con: '꾸준함' };

  const lvVol = (v) => Math.floor(Math.sqrt(Math.max(0, v) / 2000));
  const lvDays = (d) => Math.floor(Math.sqrt(Math.max(0, d) * 5));

  function getTrack() {
    try { const t = localStorage.getItem(TRACK_KEY); if (TRACKS[t]) return t; } catch {}
    try { const m = social.me(); if (m && m.char && TRACKS[m.char.t]) return m.char.t; } catch {}
    return '';
  }
  function setTrack(t) {
    try { localStorage.setItem(TRACK_KEY, t); } catch {}
    try { cloud.markDirty(); } catch {}
  }

  /* ---- 내 기록 → 능력치 ---- */
  function myStats(untilDate) {
    const v = { up: 0, low: 0, end: 0 };
    let total = 0, days = 0;
    for (const d of Object.keys(db)) {
      if (untilDate && d > untilDate) continue;
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
    return { vp: Math.floor(total * VP_PER_KG), up: lvVol(v.up), low: lvVol(v.low), end: lvVol(v.end * 1.6), con: lvDays(days), days };
  }

  function stageOf(st, track) {
    let s = 0;
    for (let i = 1; i < VP_NEED.length; i++) {
      if (st.vp < VP_NEED[i]) break;
      if (i >= 3) {
        if (!track) break;
        if (!TRACKS[track].keys.every((k) => st[k] >= STAT_NEED[i])) break;
      }
      s = i;
    }
    return s;
  }
  function stageName(s, track) {
    if (s < 4) return s === 2 && track ? `체육고 ${TRACKS[track].name}부` : BASE_STAGES[s];
    return track ? TRACKS[track].stages[s - 4] : ['프로 입단', '1군 주전', '국가대표', '레전드'][s - 4] + ' (종목별)';
  }

  // 최근 컨디션: 마지막 운동 후 쉰 날 수
  function restDays() {
    for (let i = 0; i < 30; i++) if (dayVolume(addDays(todayStr(), -i)) > 0) return i;
    return 30;
  }
  function moodOf(rest) { return rest <= 1 ? 'happy' : rest <= 3 ? 'ok' : 'sad'; }

  /* ---- 캐릭터 그리기 (능력치만큼 근비대) ---- */
  function drawAthlete({ up = 0, low = 0, track = '', mood = 'happy', size = 200 }) {
    const U = Math.min(up, 40), L = Math.min(low, 40);
    const hulk = Math.max(0, Math.min(1, ((U + L) / 2 - 16) / 14));      // 0 → 1
    const skin = hulk > 0 ? mix('#f3c9a2', '#6fbf4a', hulk) : '#f3c9a2';
    const skinD = hulk > 0 ? mix('#d9a57c', '#3f8a2b', hulk) : '#d9a57c';
    const shirt = track ? TRACKS[track].color : '#3a3a42';
    const cx = 100;
    const sh = 26 + U * 1.55;            // 어깨 반폭
    const waist = 17 + U * 0.45 + L * 0.15;
    const arm = 7 + U * 0.62;            // 팔 굵기
    const bic = arm * (1.25 + U / 60);   // 이두 볼록
    const leg = 9 + L * 0.72;            // 허벅지 굵기
    const neck = 7 + U * 0.35;
    const headR = 17;
    const topY = 82, waistY = 150, hipY = 168, footY = 246;
    const lx = cx - waist + leg * 0.55, rx = cx + waist - leg * 0.55;
    const armTop = topY + 6;
    const ripped = hulk > 0.35;
    const face = mood === 'happy' ? `<path d="M${cx - 6} 62 q6 6 12 0" stroke="#222" stroke-width="2" fill="none" stroke-linecap="round"/>`
      : mood === 'ok' ? `<path d="M${cx - 5} 64 h10" stroke="#222" stroke-width="2" stroke-linecap="round"/>`
      : `<path d="M${cx - 6} 66 q6 -5 12 0" stroke="#222" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M${cx + 12} 50 q2 5 0 7" stroke="#7cc4ff" stroke-width="2" fill="none"/>`;
    const brow = hulk > 0.5 ? `<path d="M${cx - 11} 47 l8 3M${cx + 11} 47 l-8 3" stroke="#222" stroke-width="2.4" stroke-linecap="round"/>` : '';
    const acc = {
      soccer: `<circle cx="${rx + leg + 14}" cy="${footY - 6}" r="11" fill="#fff" stroke="#222" stroke-width="1.5"/><path d="M${rx + leg + 14} ${footY - 12} l5 4 -2 6 h-6 l-2 -6 z" fill="#222"/>`,
      body: `<rect x="${cx - waist - 2}" y="${hipY - 18}" width="${(waist + 2) * 2}" height="18" rx="5" fill="${shirt}"/>`,
      marathon: `<rect x="${cx - headR}" y="40" width="${headR * 2}" height="6" rx="3" fill="${shirt}"/><rect x="${cx - 12}" y="${topY + 30}" width="24" height="16" rx="2" fill="#fff" stroke="#222" stroke-width="1"/><text x="${cx}" y="${topY + 42}" font-size="9" text-anchor="middle" font-weight="800" fill="#222">42</text>`,
      lifting: `<rect x="${cx - waist - 3}" y="${waistY - 8}" width="${(waist + 3) * 2}" height="14" rx="4" fill="#5b3a1e"/><rect x="${cx - 6}" y="${waistY - 6}" width="12" height="10" rx="2" fill="#d4a017"/>`,
    }[track] || '';
    const tank = track === 'body' ? '' : `<path d="M${cx - sh * 0.62} ${topY + 2} L${cx - waist} ${waistY} L${cx + waist} ${waistY} L${cx + sh * 0.62} ${topY + 2} L${cx + 10} ${topY + 2} Q${cx} ${topY + 18} ${cx - 10} ${topY + 2} Z" fill="${shirt}"/>`
      + (ripped && track !== 'body' ? `<path d="M${cx - waist} ${waistY - 2} l6 -10 5 8 6 -12 5 10 6 -9 5 11 6 -10 5 9 6 -8" stroke="${skin}" stroke-width="5" fill="none"/>` : '');
    return `<svg viewBox="-45 0 290 262" width="${size * 1.45}" height="${size * 1.31}" class="athlete-svg" aria-hidden="true">
      <ellipse cx="${cx}" cy="${footY + 6}" rx="${Math.max(48, sh + 10)}" ry="7" fill="rgba(0,0,0,.12)"/>
      <!-- 다리 -->
      <rect x="${lx - leg}" y="${hipY - 6}" width="${leg * 2}" height="${footY - hipY + 2}" rx="${leg}" fill="${skin}"/>
      <rect x="${rx - leg}" y="${hipY - 6}" width="${leg * 2}" height="${footY - hipY + 2}" rx="${leg}" fill="${skin}"/>
      <ellipse cx="${lx}" cy="${hipY + 22}" rx="${leg * 1.12}" ry="${22 + L * 0.3}" fill="${skin}"/>
      <ellipse cx="${rx}" cy="${hipY + 22}" rx="${leg * 1.12}" ry="${22 + L * 0.3}" fill="${skin}"/>
      ${L >= 8 ? `<path d="M${lx} ${hipY + 8} v24M${rx} ${hipY + 8} v24" stroke="${skinD}" stroke-width="1.5"/>` : ''}
      <ellipse cx="${lx - 2}" cy="${footY}" rx="${leg * 0.9 + 4}" ry="6" fill="#222"/>
      <ellipse cx="${rx + 2}" cy="${footY}" rx="${leg * 0.9 + 4}" ry="6" fill="#222"/>
      <!-- 반바지 -->
      <path d="M${cx - waist - 2} ${waistY - 2} H${cx + waist + 2} L${rx + leg + 3} ${hipY + 20} H${cx + 3} L${cx} ${hipY + 4} L${cx - 3} ${hipY + 20} H${lx - leg - 3} Z" fill="#26262b"/>
      <!-- 팔 -->
      <g fill="${skin}">
        <rect x="${cx - sh - arm}" y="${armTop}" width="${arm * 2}" height="78" rx="${arm}" transform="rotate(10 ${cx - sh} ${armTop})"/>
        <rect x="${cx + sh - arm}" y="${armTop}" width="${arm * 2}" height="78" rx="${arm}" transform="rotate(-10 ${cx + sh} ${armTop})"/>
        <ellipse cx="${cx - sh - 4}" cy="${armTop + 26}" rx="${bic}" ry="${bic * 1.15}"/>
        <ellipse cx="${cx + sh + 4}" cy="${armTop + 26}" rx="${bic}" ry="${bic * 1.15}"/>
        <circle cx="${cx - sh - 12}" cy="${armTop + 80}" r="${arm * 0.9 + 2}"/>
        <circle cx="${cx + sh + 12}" cy="${armTop + 80}" r="${arm * 0.9 + 2}"/>
      </g>
      <!-- 몸통 -->
      <path d="M${cx - sh} ${topY + 4} Q${cx} ${topY - 10} ${cx + sh} ${topY + 4} L${cx + waist} ${waistY + 4} L${cx - waist} ${waistY + 4} Z" fill="${skin}"/>
      <circle cx="${cx - sh}" cy="${topY + 8}" r="${arm * 1.15 + 3}" fill="${skin}"/>
      <circle cx="${cx + sh}" cy="${topY + 8}" r="${arm * 1.15 + 3}" fill="${skin}"/>
      ${U >= 6 ? `<path d="M${cx} ${topY + 10} v${22 + U * 0.3}M${cx - sh * 0.55} ${topY + 30 + U * 0.3} q${sh * 0.55} 10 ${sh * 1.1} 0" stroke="${skinD}" stroke-width="1.6" fill="none"/>` : ''}
      ${U >= 10 && track === 'body' ? `<path d="M${cx - 8} ${topY + 52} h16M${cx - 8} ${topY + 62} h16M${cx - 7} ${topY + 72} h14" stroke="${skinD}" stroke-width="1.4"/>` : ''}
      ${tank}
      ${acc}
      <!-- 목 · 머리 -->
      <rect x="${cx - neck}" y="${66}" width="${neck * 2}" height="22" rx="${Math.min(neck, 8)}" fill="${skin}"/>
      <circle cx="${cx}" cy="56" r="${headR}" fill="${skin}"/>
      <path d="M${cx - headR} 52 q${headR} -26 ${headR * 2} 0 q-6 -8 -${headR} -9 q-${headR - 6} 1 -${headR} 9z" fill="#2b2118"/>
      <circle cx="${cx - 6}" cy="56" r="2" fill="#222"/><circle cx="${cx + 6}" cy="56" r="2" fill="#222"/>
      ${brow}${face}
    </svg>`;
  }
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  /* ---- 오늘의 이벤트 문구 ---- */
  function eventLine(st, track, rest, todayVp) {
    const T = track ? TRACKS[track] : null;
    const seed = hashStr(todayStr() + (track || '')), pick = (arr) => arr[seed % arr.length];
    if (todayVp > 150) return pick(['🔥 감독님: "오늘 훈련량 미쳤다. 주전 확정이다."', '📸 오늘 훈련 영상이 SNS에서 화제예요', '💥 트레이너가 기록지를 두 번 확인했어요']);
    if (todayVp > 0) return pick(['👍 성실하게 훈련했어요. 코치님이 고개를 끄덕여요', '📈 오늘도 한 걸음 성장했어요', '🥤 훈련 끝나고 단백질 쉐이크 한 잔']);
    if (rest >= 4) return pick(['😰 감독님: "요즘 안 보이던데… 벤치 가고 싶나?"', '🛋️ 소파에 너무 오래 있었어요. 근손실 경보!', '📉 스카우터가 다른 선수를 보러 갔어요']);
    if (rest >= 2) return pick(['😴 이틀째 휴식 중… 몸이 근질근질해요', '🍗 휴식도 훈련이지만 너무 길면 곤란해요']);
    if (!track && st.vp >= VP_NEED[2]) return '🎓 체육고 입학 원서가 도착했어요! 종목을 골라주세요';
    return T ? pick([`${T.icon} 오늘은 ${T.name} 훈련하기 딱 좋은 날!`, '☀️ 컨디션 최상. 오늘 기록 하나 깨볼까요?']) : '☀️ 컨디션 최상. 오늘 훈련 시작해볼까요?';
  }

  /* ---- 화면 ---- */
  function render() {
    const track = getTrack();
    const st = myStats();
    const s = stageOf(st, track);
    const rest = restDays();
    const todayVp = Math.floor(dayVolume(todayStr()) * VP_PER_KG);
    const yest = myStats(addDays(todayStr(), -1));
    const nick = (() => { try { return social.nick() || '나'; } catch { return '나'; } })();
    const T = track ? TRACKS[track] : null;

    $('#ath-figure').innerHTML = drawAthlete({ up: st.up, low: st.low, track, mood: moodOf(rest), size: 210 });
    $('#ath-name').textContent = nick;
    $('#ath-stage').textContent = stageName(s, track);
    $('#ath-track').innerHTML = T ? `${T.icon} ${T.name}` : '종목 미정';
    $('#ath-track').classList.toggle('none', !T);
    const hulk = (Math.min(st.up, 40) + Math.min(st.low, 40)) / 2 >= 16;
    $('#ath-hulk').hidden = !hulk;

    // 다음 단계
    const next = s + 1 < VP_NEED.length ? s + 1 : null;
    if (next) {
      const need = VP_NEED[next];
      const pct = Math.min(100, (st.vp / need) * 100);
      let reqHtml = '';
      if (next >= 3) {
        reqHtml = T ? T.keys.map((k) => {
          const ok = st[k] >= STAT_NEED[next];
          return `<span class="ath-req ${ok ? 'ok' : ''}">${ok ? '✓' : '✗'} ${STAT_NAMES[k]} Lv ${st[k]} / ${STAT_NEED[next]}</span>`;
        }).join('') : '<span class="ath-req">✗ 체육고에서 종목을 먼저 골라야 해요</span>';
      }
      const blocked = st.vp >= need;
      $('#ath-next').innerHTML = `
        <div class="ath-next-top"><span>다음 목표 <b>${stageName(next, track)}</b></span><em>${st.vp.toLocaleString()} / ${need.toLocaleString()} VP</em></div>
        <div class="ath-bar"><div style="width:${pct}%"></div></div>
        ${reqHtml ? `<div class="ath-reqs">${reqHtml}</div>` : ''}
        ${blocked && reqHtml ? `<p class="ath-warn">포인트는 충분해요! ${T ? '부족한 능력치를 채우면 합격이에요' : '종목을 골라주세요'}</p>` : ''}`;
    } else {
      $('#ath-next').innerHTML = `<div class="ath-next-top"><span><b>👑 커리어 정점 달성!</b></span><em>${st.vp.toLocaleString()} VP</em></div><p class="ath-warn">당신은 이제 전설이에요.</p>`;
    }

    // 능력치
    $('#ath-stats').innerHTML = Object.entries(STAT_NAMES).map(([k, name]) => {
      const gain = st[k] - yest[k];
      const key = T && T.keys.includes(k);
      return `<div class="ath-stat ${key ? 'key' : ''}">
        <span class="ath-stat-name">${name}${key ? ' <i>핵심</i>' : ''}</span>
        <span class="ath-stat-bar"><span style="width:${Math.min(100, st[k] / 0.4)}%"></span></span>
        <span class="ath-stat-lv">Lv ${st[k]}${gain > 0 ? ` <b>+${gain}</b>` : ''}</span>
      </div>`;
    }).join('');

    // 오늘
    $('#ath-today').innerHTML = `<b>${todayVp > 0 ? `오늘 +${todayVp.toLocaleString()} VP` : '오늘 아직 훈련 전'}</b><span>${escapeHtml(eventLine(st, track, rest, todayVp))}</span>`;

    // 커리어 타임라인
    const all = VP_NEED.map((_, i) => i);
    $('#ath-career').innerHTML = all.map((i) => `<div class="ath-step ${i < s ? 'done' : i === s ? 'now' : ''}">
      <span class="ath-dot">${i < s ? '✓' : i === s ? '●' : i + 1}</span>
      <span class="ath-step-name">${stageName(i, track)}</span>
      <span class="ath-step-vp">${VP_NEED[i] ? `${VP_NEED[i].toLocaleString()} VP` : '시작'}</span>
    </div>`).join('');

    // 종목 선택
    const canPick = st.vp >= VP_NEED[2];
    $('#ath-pick').hidden = !(canPick && !track);
    $('#ath-change').hidden = !track;
    $('#ath-locked').hidden = canPick || !!track;
    $('#ath-locked').textContent = `${VP_NEED[2].toLocaleString()} VP를 모으면 체육고에 진학해서 종목을 고를 수 있어요 (지금 ${st.vp.toLocaleString()} VP)`;

    renderTeam();
  }

  function renderTeam() {
    let members = {}, myId = null;
    try { members = social.members(); myId = social.id(); } catch {}
    const ids = Object.keys(members);
    $('#ath-team-panel').hidden = !ids.length;
    if (!ids.length) return;
    const rows = ids.map((id) => {
      const m = members[id];
      if (id === myId) { const st = myStats(); const t = getTrack(); return { id, nick: m.nick, t, st, s: stageOf(st, t) }; }
      const c = m.char || {};
      const st = c.s ? { vp: num(c.vp), up: num(c.s.u), low: num(c.s.l), end: num(c.s.e), con: num(c.s.c) }
        : { vp: Math.floor((Object.values(m.days || {}).reduce((a, v) => a + num(v), 0) + Object.values(m.cdays || {}).reduce((a, v) => a + num(v), 0)) * VP_PER_KG), up: 0, low: 0, end: 0, con: 0 };
      const t = TRACKS[c.t] ? c.t : '';
      return { id, nick: m.nick, t, st, s: c.s ? num(c.st) : Math.min(2, stageOf(st, '')) };
    }).sort((a, b) => b.s - a.s || b.st.vp - a.st.vp);
    $('#ath-team').innerHTML = rows.map((r) => `<button type="button" class="ath-mate ${r.id === myId ? 'me' : ''}" data-id="${escapeHtml(r.id)}">
      <span class="ath-mate-fig">${drawAthlete({ up: r.st.up, low: r.st.low, track: r.t, size: 84 })}</span>
      <b>${escapeHtml(r.nick)}</b>
      <small>${r.t ? TRACKS[r.t].icon + ' ' : ''}${escapeHtml(stageName(r.s, r.t))}</small>
      <em>${r.st.vp.toLocaleString()} VP</em>
    </button>`).join('');
    $('#ath-team').querySelectorAll('.ath-mate').forEach((b) => b.addEventListener('click', () => {
      try { social.openProfile(b.dataset.id); } catch {}
    }));
  }

  /* 종목 선택 팝업 */
  function openPick() {
    $('#track-list').innerHTML = Object.entries(TRACKS).map(([k, t]) => `<button type="button" class="track-opt" data-t="${k}" style="--tc:${t.color}">
      <span class="track-icon">${t.icon}</span>
      <span class="track-main"><b>${t.name}</b><small>핵심 능력치: ${t.keys.map((x) => STAT_NAMES[x]).join(' · ')}</small><small>최종 목표: ${t.stages[3]}</small></span>
    </button>`).join('');
    $('#track-list').querySelectorAll('.track-opt').forEach((b) => b.addEventListener('click', () => {
      setTrack(b.dataset.t);
      $('#track-modal').hidden = true; document.body.classList.remove('modal-open');
      toast(`${TRACKS[b.dataset.t].icon} ${TRACKS[b.dataset.t].name}부 입학! 열심히 훈련해요`);
      render();
    }));
    $('#track-modal').hidden = false; document.body.classList.add('modal-open');
  }
  $('#ath-pick').addEventListener('click', openPick);
  $('#ath-change').addEventListener('click', async () => {
    if (!(await askConfirm('종목을 바꿀까요?\n쌓은 포인트와 능력치는 그대로예요.', { okText: '바꾸기' }))) return;
    openPick();
  });
  $('#track-close').addEventListener('click', () => { $('#track-modal').hidden = true; document.body.classList.remove('modal-open'); });
  $('#track-modal .rest-backdrop').addEventListener('click', () => { $('#track-modal').hidden = true; document.body.classList.remove('modal-open'); });

  /** 친구들에게 보일 내 선수 정보 */
  function summary() {
    const st = myStats(), t = getTrack();
    return { t, vp: st.vp, st: stageOf(st, t), s: { u: st.up, l: st.low, e: st.end, c: st.con } };
  }

  return { render, summary, draw: drawAthlete };
})();
