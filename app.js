'use strict';

/* =========================================================
 * 데이터 구조 (localStorage "gymlog.v1")
 * {
 *   "2026-11-01": [
 *     { id, name: "벤치프레스", sets: [ { w: 60, r: 10 }, ... ] }
 *   ]
 * }
 * 볼륨 = Σ (무게 × 횟수)
 * 주는 월요일 시작
 * ========================================================= */

const STORAGE_KEY = 'gymlog.v1';
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

let db = load();
let friendCustoms = [];
const PLAN_KEY = 'gymlog.plan', CLOSED_KEY = 'gymlog.closed';
const loadJson = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
let planMap = loadJson(PLAN_KEY);      // 날짜 → ['가슴', '삼두']
let closedMap = loadJson(CLOSED_KEY);  // 날짜 → 마감 시각(ms)
function savePlanClosed() {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(planMap)); localStorage.setItem(CLOSED_KEY, JSON.stringify(closedMap)); } catch { /* 없음 */ }
  cloud.markDirty();
}
const isClosed = (date) => !!closedMap[date];        // 친구들이 직접 추가한 운동 [{ name, bw, by }]
const BW_KEY = 'gymlog.bodyweight';
let bwMap = (() => {           // 날짜 → 몸무게(kg)
  try { return JSON.parse(localStorage.getItem(BW_KEY)) || {}; } catch { return {}; }
})();
const state = {
  day: todayStr(),
  weekAnchor: todayStr(),
  monthAnchor: todayStr(),
};

/* ---------- 저장 ---------- */
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* 저장소 없음 */ }
}
function saveBw() {
  try { localStorage.setItem(BW_KEY, JSON.stringify(bwMap)); } catch { /* 저장소 없음 */ }
  cloud.markDirty();
}
/** 해당 날짜에 적용할 몸무게: 그날 또는 그 이전 가장 최근 기록, 없으면 가장 오래된 기록 */
function bodyweightOn(date) {
  const keys = Object.keys(bwMap).filter((k) => num(bwMap[k]) > 0).sort();
  if (!keys.length) return 0;
  let pick = keys[0];
  for (const k of keys) { if (k <= date) pick = k; else break; }
  return num(bwMap[pick]);
}
function save() {
  // 빈 날짜는 정리
  for (const k of Object.keys(db)) if (!db[k] || db[k].length === 0) delete db[k];
  saveLocal();
  cloud.markDirty();
}

/* ---------- 팝업 확인창 / 토스트 (alert·confirm 대체) ---------- */
function askConfirm(message, { okText = '확인', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    document.getElementById('confirm-msg').textContent = message;
    ok.textContent = okText;
    ok.classList.toggle('danger', danger);
    modal.hidden = false;
    const done = (v) => {
      modal.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      modal.querySelector('.rest-backdrop').removeEventListener('click', onCancel);
      resolve(v);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    modal.querySelector('.rest-backdrop').addEventListener('click', onCancel);
  });
}
let toastTimer = null;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- 클라우드 동기화 (Claude 아티팩트에서 열었을 때만) ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cloud = (() => {
  let col = null;
  let synced = {};          // 날짜 → 마지막으로 클라우드에 저장된 JSON
  let syncedSettings = null;
  let timer = null, busy = false, again = false;
  const status = (t) => { const el = document.getElementById('sync-status'); if (el) el.textContent = t; };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);

  async function init() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    try {
      const [store, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!store || !user) return;
      const id = await user.id();
      if (!id) return;
      status('클라우드에서 기록을 불러오는 중…');
      const c = store.collection('data/users/' + id);
      const snap = await withTimeout(c.get(), 10000);
      const remote = {};
      for (const d of snap.docs) {
        if (!d.exists) continue;
        const body = d.data();
        if (DATE_RE.test(d.id) && Array.isArray(body.list)) remote[d.id] = JSON.parse(JSON.stringify(body.list));
        if (d.id === 'settings') {
          if (body.restSeconds) setRestSeconds(body.restSeconds, false);
          if (body.goal !== undefined) setCustomGoal(body.goal, false);
          if (body.plan && typeof body.plan === 'object') planMap = { ...planMap, ...body.plan };
          if (body.closed && typeof body.closed === 'object') closedMap = { ...closedMap, ...body.closed };
          if (Array.isArray(body.photoDates)) photos.mergeDates(body.photoDates);
          if (body.bodyweight && typeof body.bodyweight === 'object') bwMap = { ...bwMap, ...body.bodyweight };
          syncedSettings = JSON.stringify({ restSeconds: body.restSeconds || 60, bodyweight: body.bodyweight || {}, goal: body.goal || 0, plan: body.plan || {}, closed: body.closed || {}, photoDates: body.photoDates || [] });
        }
      }
      for (const [k, v] of Object.entries(remote)) synced[k] = JSON.stringify(v);
      // 클라우드 기록 우선, 이 브라우저에만 있던 날짜는 클라우드로 올림
      Object.assign(db, remote);
      col = c;
      photos.attach(store.doc('data/users/' + id + '/photos').collection('items'));
      social.init(store, id);
      saveLocal();
      try { localStorage.setItem(BW_KEY, JSON.stringify(bwMap)); } catch { /* 없음 */ }
      render();
      status('Claude 클라우드에 자동 저장돼요. 다른 기기에서도 같은 링크로 열면 기록이 보여요.');
      markDirty();
    } catch (e) {
      col = null;
      status('클라우드에 연결하지 못했어요. 지금은 이 브라우저에만 저장돼요.');
    }
  }

  function markDirty() {
    if (!col) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }

  async function flush() {
    if (!col) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const keys = new Set([...Object.keys(db), ...Object.keys(synced)]);
      for (const k of keys) {
        const cur = db[k] && db[k].length ? JSON.stringify(db[k]) : null;
        if (cur === (synced[k] ?? null)) continue;
        if (cur === null) { await col.doc(k).delete(); delete synced[k]; }
        else { await col.doc(k).set({ list: JSON.parse(cur), updatedAt: Date.now() }); synced[k] = cur; }
      }
      const st = JSON.stringify({ restSeconds: restSeconds(), bodyweight: bwMap, goal: customGoal, plan: planMap, closed: closedMap, photoDates: photos.dates() });
      if (st !== syncedSettings) { await col.doc('settings').set(JSON.parse(st)); syncedSettings = st; }
      try { await social.publish(); } catch { /* 순위 참가 권한 없음 → 개인 기록만 저장 */ }
      status('Claude 클라우드에 자동 저장돼요. 다른 기기에서도 같은 링크로 열면 기록이 보여요.');
    } catch (e) {
      status('클라우드 저장에 실패했어요. 이 브라우저에는 저장돼 있어요. 잠시 후 다시 시도해요.');
      if (e && (e.code === 'unavailable' || e.code === 'resource_exhausted')) setTimeout(markDirty, 3000 + Math.random() * 2000);
      if (e && e.code === 'quota_exceeded') toast('클라우드 저장 공간이 가득 찼어요');
    } finally {
      busy = false;
      if (again) { again = false; flush(); }
    }
  }

  return { init, markDirty };
})();
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 날짜 유틸 (로컬 시간 기준) ---------- */
function toStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function todayStr() { return toStr(new Date()); }
function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
}
function weekStart(s) {
  const d = parse(s);
  const dow = (d.getDay() + 6) % 7; // 월=0 ... 일=6
  d.setDate(d.getDate() - dow);
  return toStr(d);
}
function addMonths(s, n) {
  const d = parse(s);
  return toStr(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
function monthDays(s) {
  const d = parse(s);
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) => toStr(new Date(y, m, i + 1)));
}
function fmtDate(s) {
  const d = parse(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[(d.getDay() + 6) % 7]})`;
}

/* ---------- 볼륨 계산 ---------- */
const num = (v) => (Number.isFinite(+v) ? +v : 0);
/** 맨몸 운동 종류: 'bw'(몸무게+추가중량), 'assist'(몸무게−보조중량), null(일반) */
function bwType(ex) {
  if (ex && ex.bw !== undefined) return ex.bw;
  return (typeof BODYWEIGHT_TYPE !== 'undefined' && BODYWEIGHT_TYPE[ex?.name]) || null;
}
/** 유산소/스포츠 정보 (없으면 null). 직접 추가한 운동은 ex.cardio 로 지정 */
function cardioInfo(ex) {
  if (ex && ex.cardio !== undefined) return ex.cardio;
  return (typeof CARDIO !== 'undefined' && CARDIO[ex?.name]) || null;
}
const DEFAULT_BW = 70;
/** 유산소 소모 kcal (순수 운동분) */
/** 유산소 기록 방식: 'calc' = 거리·시간으로 계산, 'watch' = 워치 칼로리 입력 */
const CARDIO_MODE_KEY = 'gymlog.cardioMode';
function cardioMode(ex) { return (ex && ex.mode === 'watch') || cardioInfo(ex)?.kcalOnly ? 'watch' : 'calc'; }
function preferredCardioMode() { try { return localStorage.getItem(CARDIO_MODE_KEY) === 'watch' ? 'watch' : 'calc'; } catch { return 'calc'; } }
/** 유산소 소모 kcal: 칼로리 방식은 워치 값 그대로, 계산 방식은 거리 > 시간 */
function cardioKcal(set, info, bw, mode = 'calc') {
  const km = num(set.km), min = num(set.min);
  if (mode === 'watch') return num(set.wkcal);
  if (info.perKm && km > 0) return info.perKm * bw * km;
  return Math.max(0, info.met - 1) * bw * (min / 60) * (info.timeScale ?? 1);
}
/** kcal → kg 볼륨 (종목 보정 포함) */
const cardioToVolume = (kcal, info) => kcal * CARDIO_KCAL_TO_VOLUME * (info.scale ?? 1);
/** 유산소 기록에 칼로리와 kg 볼륨을 함께 남김 (바뀐 경우 true) */
function stampCardio(set, ex, date) {
  const cinfo = cardioInfo(ex);
  if (!cinfo) return false;
  const raw = cardioKcal(set, cinfo, bodyweightOn(date) || DEFAULT_BW, cardioMode(ex));
  const kcal = Math.round(raw);
  const vol = Math.round(cardioToVolume(raw, cinfo));
  if (set.kcal === kcal && set.vol === vol) return false;
  set.kcal = kcal; set.vol = vol;
  return true;
}
function setVolume(set, ex, date) {
  const cinfo = cardioInfo(ex);
  if (cinfo) return cardioToVolume(cardioKcal(set, cinfo, bodyweightOn(date) || DEFAULT_BW, cardioMode(ex)), cinfo);
  const w = num(set.w), r = num(set.r);
  const type = bwType(ex);
  if (!type) return w * r;
  const bw = bodyweightOn(date);
  if (type === 'assist') return Math.max(0, bw - w) * r;
  return (bw + w) * r;
}
function exerciseVolume(ex, date) { return ex.sets.reduce((a, s) => a + setVolume(s, ex, date), 0); }
/** 근력 볼륨 — 유산소·스포츠 제외 */
function dayStrengthVolume(date) { return (db[date] || []).reduce((a, ex) => a + (cardioInfo(ex) ? 0 : exerciseVolume(ex, date)), 0); }
/** 총 볼륨 (기준) = 근력 + 유산소 */
function dayVolume(date) { return dayStrengthVolume(date) + dayCardioVolume(date); }
/** 유산소·스포츠 환산 볼륨 (별도 집계) */
function dayCardioVolume(date) { return (db[date] || []).reduce((a, ex) => a + (cardioInfo(ex) ? exerciseVolume(ex, date) : 0), 0); }
function rangeVolume(dates) { return dates.reduce((a, d) => a + dayVolume(d), 0); }

function rangeStats(dates) {
  const byEx = {}, cardioByEx = {};
  let sets = 0, reps = 0, days = 0, cardio = 0, km = 0, min = 0;
  for (const d of dates) {
    const list = db[d] || [];
    if (list.some((ex) => ex.sets.length)) days++;
    for (const ex of list) {
      if (cardioInfo(ex)) {
        const c = (cardioByEx[ex.name] ||= { volume: 0, sets: 0, reps: 0, km: 0, min: 0, cardio: true });
        for (const s of ex.sets) {
          const v = setVolume(s, ex, d);
          c.volume += v; c.sets++; c.km += num(s.km); c.min += num(s.min);
          cardio += v; km += num(s.km); min += num(s.min);
        }
        continue;
      }
      const e = (byEx[ex.name] ||= { volume: 0, sets: 0, reps: 0, km: 0, min: 0 });
      for (const s of ex.sets) {
        e.volume += setVolume(s, ex, d);
        e.sets++;
        e.reps += num(s.r);
        e.km += num(s.km);
        e.min += num(s.min);
        sets++;
        reps += num(s.r);
      }
    }
  }
  return { total: rangeVolume(dates), byEx, cardioByEx, cardio, km, min, sets, reps, days };
}

function fmtKg(v) {
  return `${Math.round(v).toLocaleString('ko-KR')} kg`;
}
function fmtShort(v) {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v ? String(Math.round(v)) : '';
}
function diffText(cur, prev, label) {
  if (!prev) return cur ? `${label} 기록 없음` : '';
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct >= 0 ? 'up' : 'down';
  const sign = pct >= 0 ? '▲' : '▼';
  return `${label} 대비 <span class="${cls}">${sign} ${Math.abs(pct).toFixed(1)}%</span> (${fmtKg(prev)})`;
}

/* ---------- 숫자 입력칸: 누르면 커서를 맨 오른쪽으로 ---------- */
function caretToEnd(el) {
  try { const n = el.value.length; el.setSelectionRange(n, n); } catch { /* 지원 안 함 */ }
}
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !el.hasAttribute('inputmode')) return;
  el.dataset.fresh = '1';
  setTimeout(() => caretToEnd(el), 0);
  setTimeout(() => caretToEnd(el), 60);   // iOS는 탭한 위치로 커서를 늦게 옮김
});
['pointerup', 'mouseup', 'click'].forEach((type) => document.addEventListener(type, (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.dataset.fresh) { caretToEnd(el); if (type === 'click') delete el.dataset.fresh; }
}, true));
document.addEventListener('focusout', (e) => { if (e.target instanceof HTMLInputElement) delete e.target.dataset.fresh; });

/* ---------- 탭 ---------- */
const $ = (sel) => document.querySelector(sel);

document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => showView(btn.dataset.view))
);
function showView(view) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('#page-title').textContent = PAGE_TITLES[view];
  window.scrollTo({ top: 0 });
  render();
}
const PAGE_TITLES = { day: 'Today', week: 'Weekly', month: 'Monthly', rank: 'Ranking', settings: 'Settings' };
function updateHeader() {
  const d = new Date();
  $('#header-sub').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`;
  $('#day-dot').classList.toggle('on', dayVolume(todayStr()) > 0 || (db[todayStr()] || []).length > 0);
}
function currentView() {
  return document.querySelector('.tab.active').dataset.view;
}

/* ---------- 일간 ---------- */
const dayInput = $('#day-date');
dayInput.addEventListener('change', () => {
  if (dayInput.value) { state.day = dayInput.value; renderDay(); }
});
$('#view-day').querySelectorAll('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => { state.day = addDays(state.day, +b.dataset.shift); renderDay(); })
);
$('#day-today').addEventListener('click', () => { state.day = todayStr(); renderDay(); });

function addExercise(name) {
  name = name.trim();
  if (!name) return;
  if (isClosed(state.day)) { toast('마감된 날이에요. 다시 열기를 눌러주세요'); return; }
  // 마지막으로 했던 같은 운동의 세트를 기본값으로 불러오기
  const last = findLastExercise(name, state.day);
  const isCardio = !!(typeof CARDIO !== 'undefined' && CARDIO[name]);
  const sets = last ? last.sets.map((s) => ({ ...s })) : [isCardio ? { km: '', min: '' } : { w: '', r: '' }];
  const entry = { id: uid(), name, sets };
  if (last && last.bw !== undefined) entry.bw = last.bw;
  else if (!isCardio && !EXERCISES.some((e) => e.name === name)) {
    const fc = friendCustoms.find((f) => f.name === name);
    if (fc && fc.bw) entry.bw = 'bw';
  }
  if (isCardio && CARDIO[name].goals) entry.detail = true;
  if (isCardio) entry.mode = CARDIO[name].kcalOnly ? 'watch' : last && last.mode ? last.mode : preferredCardioMode();
  (db[state.day] ||= []).push(entry);
  save();
  renderDay();
  // 방금 추가한 운동 카드로 스크롤 + 무게칸 포커스
  const cards = document.querySelectorAll('#exercise-container .exercise-card');
  const card = cards[cards.length - 1];
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card?.classList.add('just-added');
}

/* ---------- 운동 검색 / 목록 ---------- */
const picker = { part: '전체', open: false };
const searchInput = $('#exercise-search');
const resultsEl = $('#search-results');

function partOf(name) {
  return EXERCISES.find((e) => e.name === name)?.part || '내 운동';
}

function renderPartChips() {
  const parts = ['전체', '최근', ...EXERCISE_PARTS, '내 운동', '친구 운동'];
  $('#part-chips').innerHTML = parts
    .map((p) => `<button type="button" class="chip ${p === picker.part ? 'active' : ''}" data-part="${p}">${p}</button>`)
    .join('');
  $('#part-chips').querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      picker.part = c.dataset.part;
      picker.open = true;
      renderPartChips();
      renderResults();
    })
  );
}

/** 최근 사용 순서 (최신 먼저) + 사용 횟수 */
function usageInfo() {
  const info = {};
  for (const d of Object.keys(db).sort()) {
    for (const ex of db[d]) {
      const u = (info[ex.name] ||= { count: 0, last: '' });
      u.count++;
      u.last = d;
    }
  }
  return info;
}

function renderResults() {
  const q = searchInput.value.trim();
  if (!picker.open && !q) { resultsEl.hidden = true; return; }

  const usage = usageInfo();
  // 카탈로그 + 직접 추가했던 운동
  const custom = Object.keys(usage)
    .filter((n) => !EXERCISES.some((e) => e.name === n))
    .map((n) => ({ part: '내 운동', name: n, en: '', alias: [], custom: true }));
  const friends = friendCustoms
    .filter((f) => !usage[f.name] && !EXERCISES.some((e) => e.name === f.name))
    .map((f) => ({ part: '친구 운동', name: f.name, en: `${f.by} 님이 추가${f.bw ? ' · 맨몸' : ''}`, alias: [], custom: true, friend: true }));
  let pool = [...EXERCISES, ...custom, ...friends];

  if (picker.part === '최근') pool = pool.filter((e) => usage[e.name]);
  else if (picker.part === '내 운동') pool = pool.filter((e) => e.custom && !e.friend);
  else if (picker.part === '친구 운동') pool = pool.filter((e) => e.friend);
  else if (picker.part !== '전체') pool = pool.filter((e) => e.part === picker.part);

  let items = pool
    .map((e) => ({ e, score: matchScore(e, q) }))
    .filter((x) => x.score > 0);

  items.sort((a, b) => {
    if (picker.part === '최근' && !q) return usage[b.e.name].last.localeCompare(usage[a.e.name].last);
    if (b.score !== a.score) return b.score - a.score;
    const ua = usage[a.e.name]?.count || 0, ub = usage[b.e.name]?.count || 0;
    return ub - ua;
  });

  const limit = q || picker.part !== '전체' ? 60 : 40;
  const total = items.length;
  items = items.slice(0, limit);

  const today = new Set((db[state.day] || []).map((e) => e.name));
  let html = items.map(({ e }) => {
    const u = usage[e.name];
    return `
      <button type="button" class="result-item" data-name="${escapeHtml(e.name)}">
        <span class="result-icon"><svg class="i"><use href="#i-folder"/></svg></span>
        <span class="result-main">
          <span class="result-name">${highlight(e.name, q)}</span>
          <span class="result-sub">${e.part} · ${escapeHtml(e.en || '직접 추가한 운동')}${u ? ` · ${u.count}회` : ''}</span>
        </span>
        ${today.has(e.name) ? '<span class="done-mark"><svg class="i"><use href="#i-check"/></svg></span>' : '<span class="add-mark"><svg class="i"><use href="#i-plus"/></svg></span>'}
      </button>`;
  }).join('');

  if (total > limit) html += `<p class="hint center">외 ${total - limit}개 · 검색어를 더 입력해보세요</p>`;
  if (!items.length && picker.part !== '전체' && !q) html += '<p class="hint center">아직 없어요.</p>';
  if (q && !items.some((x) => x.score >= 90)) {
    html += `<button type="button" class="result-item custom-add" data-name="${escapeHtml(q)}">
      <span class="result-icon"><svg class="i"><use href="#i-plus"/></svg></span>
      <span class="result-main"><span class="result-name">"${escapeHtml(q)}" 직접 추가</span>
      <span class="result-sub">목록에 없는 운동을 새로 기록해요</span></span></button>`;
  }

  resultsEl.innerHTML = html;
  resultsEl.hidden = false;
  resultsEl.querySelectorAll('.result-item').forEach((b) =>
    b.addEventListener('click', () => pickExercise(b.dataset.name))
  );
}

function highlight(name, q) {
  const n = normalize(q);
  if (!n) return escapeHtml(name);
  // 띄어쓰기 무시하고 원문에서 일치 구간 찾기
  const chars = [...name];
  const idxMap = [];
  let flat = '';
  chars.forEach((c, i) => { if (!/[\s\-_'·]/.test(c)) { flat += c.toLowerCase(); idxMap.push(i); } });
  const pos = flat.indexOf(n);
  if (pos < 0) return escapeHtml(name);
  const s = idxMap[pos], e = idxMap[pos + n.length - 1] + 1;
  return escapeHtml(chars.slice(0, s).join('')) + '<mark>' + escapeHtml(chars.slice(s, e).join('')) + '</mark>' + escapeHtml(chars.slice(e).join(''));
}

function pickExercise(name) {
  searchInput.value = '';
  picker.open = false;
  updateToggle();
  resultsEl.hidden = true;
  searchInput.blur();
  addExercise(name);
}

function updateToggle() {
  const t = $('#picker-toggle');
  t.textContent = picker.open ? '닫기' : '목록';
  t.classList.toggle('open', picker.open);
}

searchInput.addEventListener('input', renderResults);
searchInput.addEventListener('focus', () => { picker.open = true; updateToggle(); renderResults(); });
$('#picker-toggle').addEventListener('click', () => {
  picker.open = !picker.open;
  if (!picker.open) searchInput.value = '';
  updateToggle();
  renderResults();
});
$('#add-exercise-form').addEventListener('submit', (e) => {
  e.preventDefault();
  // 엔터: 첫 번째 결과 선택
  const first = resultsEl.querySelector('.result-item');
  if (first) pickExercise(first.dataset.name);
});

function findLastExercise(name, beforeDate) {
  const dates = Object.keys(db).filter((d) => d < beforeDate).sort().reverse();
  for (const d of dates) {
    const ex = db[d].find((e) => e.name === name);
    if (ex) return ex;
  }
  return null;
}

/* =========================================================
 * 눈바디 사진 — 하루 1장, 본인만 (data/users/<id>/photos/items/<날짜>)
 * 업로드 시 긴 변 900px JPEG로 줄여 저장
 * ========================================================= */
const photos = (() => {
  const DATES_KEY = 'gymlog.photoDates';
  let col = null;
  let dateSet = new Set(Array.isArray(loadJson(DATES_KEY)) ? loadJson(DATES_KEY) : []);
  const cache = {};            // 날짜 → dataURL | null
  let shown = null;            // 현재 그려진 날짜+상태
  const saveDates = () => { try { localStorage.setItem(DATES_KEY, JSON.stringify([...dateSet].sort())); } catch {} cloud.markDirty(); };
  const localKey = (d) => 'gymlog.photo.' + d;
  const cloudExpected = () => !!(window.claude && typeof window.claude.use === 'function') && !cloudGaveUp;
  let cloudGaveUp = false;
  setTimeout(() => { if (!col) { cloudGaveUp = true; shown = null; render(); } }, 12000);

  function attach(c) { col = c; shown = null; render(); }
  function mergeDates(list) { list.forEach((d) => DATE_RE.test(d) && dateSet.add(d)); shown = null; }
  const dates = () => [...dateSet].sort();

  async function get(date) {
    if (date in cache) return cache[date];
    let img = null;
    if (col) {
      try { const snap = await col.doc(date).get(); if (snap.exists) img = snap.data().img || null; } catch { /* 네트워크 */ }
    }
    if (!img) { try { img = localStorage.getItem(localKey(date)); } catch {} }
    if (img || col || !cloudExpected()) cache[date] = img;   // 클라우드 연결 전이면 '없음'으로 확정하지 않음
    return img;
  }
  async function put(date, dataUrl) {
    if (col) await col.doc(date).set({ img: dataUrl, at: Date.now() });
    else {
      try { localStorage.setItem(localKey(date), dataUrl); }
      catch { throw new Error('이 브라우저에 사진을 저장할 공간이 부족해요'); }
    }
    cache[date] = dataUrl; dateSet.add(date); saveDates();
  }
  async function remove(date) {
    if (col) await col.doc(date).delete();
    try { localStorage.removeItem(localKey(date)); } catch {}
    cache[date] = null; dateSet.delete(date); saveDates();
  }

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 900, r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        let q = 0.78, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 220000 && q > 0.4) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 읽을 수 없어요')); };
      img.src = url;
    });
  }

  async function render(force) {
    const date = state.day;
    const key = date + '|' + dateSet.has(date) + '|' + (cache[date] ? 1 : 0);
    if (!force && shown === key) return;
    shown = key;
    const body = $('#photo-body');
    const prevDate = dates().filter((d) => d < date).pop();
    if (!dateSet.has(date) && !(cache[date])) {
      body.innerHTML = `<button type="button" class="photo-add" id="photo-add"><svg class="i"><use href="#i-body"/></svg><span>사진 올리기<small>${prevDate ? `지난 사진 ${escapeHtml(fmtDate(prevDate))}` : '거울 앞에서 같은 자세로 찍으면 비교하기 좋아요'}</small></span></button>`;
      $('#photo-add').addEventListener('click', () => $('#photo-file').click());
      return;
    }
    body.innerHTML = '<p class="empty-text">사진 불러오는 중…</p>';
    const [img, prev] = await Promise.all([get(date), prevDate ? get(prevDate) : null]);
    if (state.day !== date) return;
    if (!img) {
      if (!col && cloudExpected()) { body.innerHTML = '<p class="empty-text">사진 불러오는 중…</p>'; shown = null; return; }
      dateSet.delete(date); saveDates(); shown = null; render(); return;
    }
    body.innerHTML = `
      <div class="photo-grid ${prev ? 'two' : ''}">
        ${prev ? `<figure><img src="${prev}" alt="" data-full="1" /><figcaption>${escapeHtml(fmtDate(prevDate))}</figcaption></figure>` : ''}
        <figure><img src="${img}" alt="" data-full="1" /><figcaption>${escapeHtml(fmtDate(date))}${prev ? ' · 오늘' : ''}</figcaption></figure>
      </div>
      <div class="photo-actions">
        <button type="button" id="photo-change">사진 바꾸기</button>
        <button type="button" id="photo-del" class="danger-text">삭제</button>
      </div>`;
    body.querySelectorAll('img[data-full]').forEach((el) => el.addEventListener('click', () => {
      $('#photo-viewer-img').src = el.src; $('#photo-viewer').hidden = false;
    }));
    $('#photo-change').addEventListener('click', () => $('#photo-file').click());
    $('#photo-del').addEventListener('click', async () => {
      if (!(await askConfirm('이 날짜 눈바디 사진을 삭제할까요?', { okText: '삭제', danger: true }))) return;
      try { await remove(date); shown = null; render(); toast('사진을 삭제했어요'); } catch { toast('삭제하지 못했어요'); }
    });
  }

  $('#photo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const date = state.day;
    try {
      $('#photo-body').innerHTML = '<p class="empty-text">사진 올리는 중…</p>';
      const dataUrl = await shrink(file);
      await put(date, dataUrl);
      shown = null; render();
      toast('눈바디 사진 저장 완료 📸');
    } catch (err) {
      shown = null; render();
      toast(err && err.message ? err.message : '사진을 저장하지 못했어요');
    }
  });
  const closeViewer = () => { $('#photo-viewer').hidden = true; $('#photo-viewer-img').src = ''; };
  $('#photo-viewer-close').addEventListener('click', closeViewer);
  $('#photo-viewer').addEventListener('click', (e) => { if (e.target.id === 'photo-viewer') closeViewer(); });

  return { attach, mergeDates, dates, render, get, has: (d) => dateSet.has(d) };
})();

function renderDay() {
  photos.render();
  if ((db[state.day] || []).reduce((ch, ex) => ex.sets.reduce((c, st) => stampCardio(st, ex, state.day) || c, ch), false)) save();
  dayInput.value = state.day;
  const list = db[state.day] || [];
  const container = $('#exercise-container');
  container.innerHTML = '';
  const tpl = $('#exercise-template');

  list.forEach((ex) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.exercise-name').textContent = ex.name;
    node.querySelector('.part-badge').textContent = partOf(ex.name);
    const volEl = node.querySelector('.exercise-volume');
    const type = bwType(ex);
    const cinfo = cardioInfo(ex);
    const isCatalog = EXERCISES.some((e) => e.name === ex.name);
    const chip = node.querySelector('.bw-chip');
    if (cinfo) {
      const bw = bodyweightOn(state.day);
      chip.hidden = false;
      chip.classList.add('on');
      chip.disabled = true;
      chip.textContent = bw ? `유산소 볼륨 · ${bw}kg 기준` : `유산소 볼륨 · ${DEFAULT_BW}kg 기준`;
      const th = node.querySelectorAll('thead th');
      const watch = cardioMode(ex) === 'watch';
      th[0].textContent = '회차';
      th[1].textContent = watch ? '분' : 'km';
      th[2].textContent = watch ? '⌚kcal' : '분';
      const toggle = document.createElement('div');
      toggle.className = 'mode-toggle';
      toggle.innerHTML = `<button type="button" data-mode="calc" class="${watch ? '' : 'active'}">거리·시간</button><button type="button" data-mode="watch" class="${watch ? 'active' : ''}">⌚ 칼로리 입력</button>`;
      toggle.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.mode === cardioMode(ex)) return;
        ex.mode = b.dataset.mode;
        try { localStorage.setItem(CARDIO_MODE_KEY, ex.mode); } catch { /* 없음 */ }
        save();
        renderDay();
      }));
      if (!cinfo.kcalOnly) node.querySelector('.exercise-head').after(toggle);
      node.querySelector('.rest-btn').hidden = true;
      node.querySelector('.add-set').lastChild.textContent = '기록 추가';
      const db2 = document.createElement('button');
      db2.type = 'button';
      db2.className = 'detail-btn' + (ex.detail ? ' on' : '');
      db2.textContent = ex.detail ? '상세 닫기' : cinfo.goals ? '골·심박·메모' : '페이스·심박·메모';
      db2.addEventListener('click', () => { ex.detail = !ex.detail; save(); renderDay(); });
      node.querySelector('.card-actions').appendChild(db2);
      node.classList.add('cardio');
    } else if (type || !isCatalog) {
      chip.hidden = false;
      const bw = bodyweightOn(state.day);
      chip.classList.toggle('on', !!type);
      chip.textContent = !type ? '맨몸 운동?' : bw ? `맨몸 +${bw}kg` : '맨몸 · 몸무게 미입력';
      chip.title = isCatalog ? '' : '눌러서 맨몸 운동으로 설정/해제';
      if (!isCatalog) {
        chip.addEventListener('click', () => {
          ex.bw = type ? null : 'bw';
          save();
          renderDay();
        });
      } else {
        chip.disabled = true;
      }
    }
    if (type) node.querySelector('thead th:nth-child(2)').textContent = type === 'assist' ? '보조kg' : '+kg';
    if (!cinfo && isDumbbellExercise(ex.name)) {
      const note = document.createElement('div');
      note.className = 'db-note';
      note.innerHTML = '<b>⚠️ 덤벨 주의</b> 무게는 자동으로 ×2 되지 않아요. 양손에 하나씩 들면 <b>두 개 합친 무게</b>를 입력하세요. <span>예: 20kg 2개 → 40</span>';
      node.querySelector('.exercise-head').after(note);
      node.querySelectorAll('thead th')[1].textContent = '합계kg';
    }
    const tbody = node.querySelector('tbody');

    let cardioMeta = null;
    if (cinfo) {
      cardioMeta = document.createElement('div');
      cardioMeta.className = 'cardio-meta';
      (node.querySelector('.mode-toggle') || node.querySelector('.exercise-head')).after(cardioMeta);
    }
    const refreshTotals = () => {
      volEl.textContent = fmtKg(exerciseVolume(ex, state.day));
      if (cardioMeta) {
        const km = ex.sets.reduce((a, x) => a + num(x.km), 0);
        const min = ex.sets.reduce((a, x) => a + num(x.min), 0);
        const kcal = ex.sets.reduce((a, x) => a + cardioKcal(x, cinfo, bodyweightOn(state.day) || DEFAULT_BW, cardioMode(ex)), 0);
        const parts = [];
        if (km) parts.push(`${+km.toFixed(2)}km`);
        if (min) parts.push(min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60 ? `${min % 60}분` : ''}`.trim() : `${min}분`);
        const pt = paceText(ex.name, km, min);
        if (pt) parts.push(pt.includes('km/h') ? `평균 ${pt}` : `페이스 ${pt}`);
        const hr = avgHr(ex.sets);
        if (hr) parts.push(`♥ ${hr}bpm`);
        const goals = ex.sets.reduce((a, x) => a + num(x.goals), 0);
        if (cinfo.goals && goals) parts.unshift(`⚽ ${goals}골`);
        const head = parts.length ? parts.join(' · ') : cardioMode(ex) === 'watch' ? '워치에 찍힌 활동 칼로리를 입력하세요' : (cinfo.perKm ? '거리(km)와 시간(분)을 입력하세요' : '운동한 시간(분)을 입력하세요');
        cardioMeta.innerHTML = `<div>${escapeHtml(head)}</div>` + (kcal
          ? `<div class="conv"><span class="conv-pill">${cardioMode(ex) === 'watch' ? '⌚ ' : ''}${Math.round(kcal).toLocaleString('ko-KR')} kcal</span><span class="conv-op">× ${CARDIO_KCAL_TO_VOLUME}${(cinfo.scale ?? 1) !== 1 ? ` × ${Math.round(cinfo.scale * 100)}%` : ''}</span><span class="conv-arrow">→</span><span class="conv-pill dark">${fmtKg(cardioToVolume(kcal, cinfo))}</span></div>`
          : '');
      }
      updateDaySummary();
    };

    ex.sets.forEach((set, i) => {
      const tr = document.createElement('tr');
      const inputs = cinfo
        ? (cardioMode(ex) === 'watch'
          ? `<td><input type="text" autocomplete="off" inputmode="numeric" min="0" step="1" value="${set.min ?? ''}" data-k="min" placeholder="0" /></td>
        <td><input type="text" autocomplete="off" inputmode="numeric" min="0" step="1" value="${set.wkcal ?? ''}" data-k="wkcal" placeholder="워치" class="kcal-in" /></td>`
          : `<td><input type="text" autocomplete="off" inputmode="decimal" min="0" step="0.1" value="${set.km ?? ''}" data-k="km" placeholder="${cinfo.perKm ? '0.0' : '-'}" /></td>
        <td><input type="text" autocomplete="off" inputmode="numeric" min="0" step="1" value="${set.min ?? ''}" data-k="min" placeholder="0" /></td>`)
        : `<td><input type="text" autocomplete="off" inputmode="decimal" min="0" step="0.5" value="${set.w ?? ''}" data-k="w" /></td>
        <td><input type="text" autocomplete="off" inputmode="numeric" min="0" step="1" value="${set.r ?? ''}" data-k="r" /></td>`;
      tr.innerHTML = `
        <td><span class="set-no">${i + 1}</span></td>
        ${inputs}
        <td class="vol">${fmtShort(setVolume(set, ex, state.day)) || '-'}</td>
        <td><button class="del-set" title="세트 삭제" aria-label="세트 삭제"><svg class="i"><use href="#i-x"/></svg></button></td>`;
      const volTd = tr.querySelector('.vol');
      tr.querySelectorAll('input').forEach((inp) =>
        inp.addEventListener('input', () => {
          const raw = inp.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
          if (raw !== inp.value) inp.value = raw;
          set[inp.dataset.k] = raw === '' || raw === '.' ? '' : num(parseFloat(raw));
          stampCardio(set, ex, state.day);
          volTd.textContent = fmtShort(setVolume(set, ex, state.day)) || '-';
          save();
          refreshTotals();
        })
      );
      tr.querySelector('.del-set').addEventListener('click', () => {
        ex.sets.splice(i, 1);
        save();
        renderDay();
      });
      tbody.appendChild(tr);
      if (cinfo && ex.detail) {
        const dr = document.createElement('tr');
        dr.className = 'detail-row';
        const watch = cardioMode(ex) === 'watch';
        dr.innerHTML = `<td></td><td colspan="4"><div class="detail-fields">
          ${watch ? `<label><span>거리</span><input type="text" autocomplete="off" inputmode="decimal" data-k="km" value="${set.km ?? ''}" placeholder="km" /></label>` : ''}
          ${cinfo.goals ? `<label><span>⚽ 골</span><input type="text" autocomplete="off" inputmode="numeric" data-k="goals" value="${set.goals ?? ''}" placeholder="0" /></label>` : ''}
          <label><span>♥ 평균 심박</span><input type="text" autocomplete="off" inputmode="numeric" data-k="hr" value="${set.hr ?? ''}" placeholder="bpm" /></label>
          <input type="text" class="detail-note" data-k="note" maxlength="40" value="${escapeHtml(set.note ?? '')}" placeholder="${cinfo.goals ? '메모 · 어시스트, 컨디션' : '메모 · 코스, 컨디션'}" />
        </div></td>`;
        dr.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
          if (inp.dataset.k === 'note') set.note = inp.value.slice(0, 40);
          else {
            const raw = inp.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
            if (raw !== inp.value) inp.value = raw;
            set[inp.dataset.k] = raw === '' || raw === '.' ? '' : num(parseFloat(raw));
          }
          save();
          refreshTotals();
        }));
        tbody.appendChild(dr);
      }
    });

    node.querySelector('.add-set').addEventListener('click', () => {
      const prev = ex.sets[ex.sets.length - 1];
      ex.sets.push(prev ? { ...prev } : cardioInfo(ex) ? { km: '', min: '' } : { w: '', r: '' });
      save();
      renderDay();
      // 새로 추가된 세트의 무게 입력칸에 포커스
      const cards = container.querySelectorAll('.exercise-card');
      const card = cards[list.indexOf(ex)];
      card?.querySelector('tbody tr:last-child input')?.focus();
    });

    node.querySelector('.rest-btn').addEventListener('click', () => {
      // 입력 중인 값까지 확실히 저장 후 휴식 타이머 시작
      if (document.activeElement && node.contains(document.activeElement)) document.activeElement.blur();
      save();
      const done = ex.sets.filter((s) => num(s.r) > 0).length;
      restTimer.start(`${ex.name} ${done}세트 기록 완료 · 휴식 중`);
    });

    node.querySelector('.delete-exercise').addEventListener('click', async () => {
      if (!(await askConfirm(`"${ex.name}" 운동을 삭제할까요?`, { okText: '삭제', danger: true }))) return;
      db[state.day] = list.filter((e) => e !== ex);
      save();
      renderDay();
    });

    refreshTotals();
    container.appendChild(node);
  });

  $('#day-empty').style.display = list.length ? 'none' : 'block';
  const closed = isClosed(state.day);
  $('#view-day').classList.toggle('is-closed', closed);
  $('#closed-banner').hidden = !closed;
  $('#finish-btn').hidden = closed || !list.length;
  if (closed) {
    const t = new Date(closedMap[state.day]);
    $('#closed-time').textContent = ` ${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    let shared = false;
    try { shared = social.wasShared(state.day); } catch { /* 초기화 전 */ }
    $('#shared-note').textContent = shared ? ' · 공유함' : '';
    $('#share-btn').textContent = shared ? '다시 공유' : '친구에게 공유';
    container.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
  }
  bwInput.disabled = closed;
  if (!resultsEl.hidden) renderResults();
  updateDaySummary();
}

/* ---------- 운동 마감 ---------- */
$('#finish-btn').addEventListener('click', async () => {
  const date = state.day;
  const vol = dayVolume(date), goal = dailyGoal(date), g = gradeOf(vol, goal);
  const ok = await askConfirm(`오늘 운동을 마감할까요?\n${fmtKg(vol)} · 목표의 ${goal ? Math.round((vol / goal) * 100) : 0}%${g ? ` · ${g.label}` : ''}\n\n마감하면 기록을 고칠 수 없어요.`, { okText: '마감하기' });
  if (!ok) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  closedMap[date] = Date.now();
  savePlanClosed();
  restTimer.stop();
  renderDay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(g ? `${g.label} · ${fmtKg(vol)} 마감` : '운동을 마감했어요');
});
$('#reopen-btn').addEventListener('click', () => {
  delete closedMap[state.day];
  savePlanClosed();
  renderDay();
  toast('수정할 수 있어요. 다 고치면 다시 마감하세요');
});
$('#share-btn').addEventListener('click', () => social.openShare(state.day));

const bwInput = $('#bw-input');
bwInput.addEventListener('change', () => {
  const v = parseFloat(bwInput.value);
  if (Number.isFinite(v) && v > 0) bwMap[state.day] = Math.round(v * 10) / 10;
  else delete bwMap[state.day];
  saveBw();
  renderDay();
  toast(bwMap[state.day] ? `몸무게 ${bwMap[state.day]}kg 저장됨` : '이 날짜 몸무게를 지웠어요');
});
function updateBwRow() {
  const own = bwMap[state.day];
  const eff = bodyweightOn(state.day);
  if (document.activeElement !== bwInput) bwInput.value = own ?? '';
  bwInput.placeholder = eff ? String(eff) : '00.0';
  $('#bw-note').textContent = own ? '이 날짜 몸무게' : eff ? '최근 기록 적용 중' : '맨몸 운동 볼륨에 포함';
}
/** 페이스(분/km) 또는 속도(km/h) 문자열 */
function paceText(name, km, min) {
  if (!(km > 0 && min > 0)) return '';
  if (/자전거|사이클|바이크/.test(name)) return `${(km / (min / 60)).toFixed(1)}km/h`;
  const pace = min / km;
  let m = Math.floor(pace), sec = Math.round((pace - m) * 60);
  if (sec === 60) { m += 1; sec = 0; }
  return `${m}'${String(sec).padStart(2, '0')}"/km`;
}
function avgHr(sets) {
  const hrs = sets.map((x) => num(x.hr)).filter((v) => v > 0);
  return hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : 0;
}
function fmtMin(min) {
  return min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`;
}
/** 총 볼륨 옆에 작게: 근력 · 유산소 */
function cardioLine(stats) {
  const strength = stats.total - stats.cardio;
  if (!stats.cardio) return strength ? `<span class="mix-line"><i class="tag-s">근력</i> ${fmtKg(strength)}</span>` : '';
  const bits = [stats.km ? `${+stats.km.toFixed(1)}km` : '', stats.min ? fmtMin(stats.min) : ''].filter(Boolean).join(' · ');
  return `<span class="mix-line"><i class="tag-s">근력</i> ${fmtKg(strength)} · <i class="tag-c">유산소</i> ${fmtKg(stats.cardio)}${bits ? ` (${bits})` : ''}</span>`;
}
/* ---------- 하루 목표 볼륨 (30대 남성 기준) ---------- */
const GOAL_KEY = 'gymlog.dailyGoal';
let customGoal = (() => { try { return num(localStorage.getItem(GOAL_KEY)); } catch { return 0; } })();
/** 목표: 직접 설정 > 몸무게 × 110 (500kg 단위 올림) — 90kg → 10,000kg */
function dailyGoal(date) {
  if (customGoal > 0) return customGoal;
  const plan = planMap[date] || [];
  if (plan.length) return plan.reduce((a, p) => a + partTarget(p, date), 0);
  return Math.ceil(((bodyweightOn(date) || 75) * 110) / 500) * 500;
}
/* ---------- 부위별 목표 (30대 남성 중급자 기준, 몸무게 배수) ---------- */
const PART_FACTOR = { '유산소': 60, '하체': 110, '등': 75, '가슴': 60, '전신': 75, '어깨': 40, '복근': 30, '삼두': 22, '이두': 18, '전완': 8 };
const PLAN_PARTS = ['가슴', '등', '어깨', '하체', '이두', '삼두', '전완', '복근', '전신', '유산소'];
function partTarget(part, date) {
  return Math.ceil(((bodyweightOn(date) || 75) * (PART_FACTOR[part] || 30)) / 100) * 100;
}
function partVolumes(date) {
  const out = {};
  for (const ex of db[date] || []) {
    const p = cardioInfo(ex) ? '유산소' : partOf(ex.name);
    out[p] = (out[p] || 0) + exerciseVolume(ex, date);
  }
  return out;
}
function renderPlan() {
  const date = state.day, closed = isClosed(date);
  const plan = planMap[date] || [];
  const vols = partVolumes(date);
  $('#plan-chips').innerHTML = PLAN_PARTS.map((p) => `<button type="button" class="chip ${plan.includes(p) ? 'active' : ''}" data-p="${p}" ${closed ? 'disabled' : ''}>${p}</button>`).join('');
  $('#plan-chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const cur = new Set(planMap[date] || []);
    cur.has(b.dataset.p) ? cur.delete(b.dataset.p) : cur.add(b.dataset.p);
    if (cur.size) planMap[date] = PLAN_PARTS.filter((p) => cur.has(p)); else delete planMap[date];
    savePlanClosed();
    renderPlan();
    updateDaySummary();
  }));
  $('#plan-hint').textContent = plan.length ? `목표 합계 ${fmtKg(plan.reduce((a, p) => a + partTarget(p, date), 0))}` : '고르면 부위별 목표가 나와요';
  const extra = Object.keys(vols).filter((p) => !plan.includes(p) && vols[p] > 0);
  $('#plan-rows').innerHTML = plan.map((p) => {
    const v = vols[p] || 0, t = partTarget(p, date), g = gradeOf(v, t);
    return `<div class="plan-row">
      <div class="plan-top"><b>${p}</b><span>${g ? g.label.split(' ')[0] : ''} ${fmtKg(v)} <small>/ ${fmtKg(t)}</small></span></div>
      <div class="plan-bar ${v >= t ? 'done' : ''}"><div style="width:${Math.min(100, (v / t) * 100)}%"></div></div>
    </div>`;
  }).join('') + (extra.length ? `<p class="plan-extra">계획 외: ${extra.map((p) => `${escapeHtml(p)} ${fmtKg(vols[p])}`).join(' · ')}</p>` : '');
}
const GRADES = [
  { min: 1.4, label: '🔥 불태움' },
  { min: 1.0, label: '💪 잘했어요' },
  { min: 0.7, label: '👍 보통' },
  { min: 0.4, label: '🙂 가볍게' },
  { min: 0.0001, label: '🌱 몸풀기' },
];
function gradeOf(vol, goal) {
  const r = goal ? vol / goal : 0;
  return GRADES.find((g) => r >= g.min) || null;
}
function setCustomGoal(v, sync = true) {
  customGoal = Math.max(0, Math.round(num(v)));
  try { if (customGoal) localStorage.setItem(GOAL_KEY, customGoal); else localStorage.removeItem(GOAL_KEY); } catch { /* 없음 */ }
  const inp = document.getElementById('goal-input');
  if (inp) inp.value = customGoal || '';
  updateGoalNote();
  if (sync) cloud.markDirty();
}
function updateGoalNote() {
  const el = document.getElementById('goal-auto-note');
  if (el) el.textContent = customGoal ? '직접 설정' : `자동 · ${fmtKg(dailyGoal(todayStr()))}`;
}
function updateDaySummary() {
  updateBwRow();
  renderPlan();
  const list = db[state.day] || [];
  const total = dayVolume(state.day);
  $('#day-total').textContent = fmtKg(total);
  const goal = dailyGoal(state.day);
  const grade = gradeOf(total, goal);
  const pct = goal ? Math.round((total / goal) * 100) : 0;
  $('#goal-grade').textContent = grade ? grade.label : '아직 시작 전';
  $('#goal-text').textContent = `목표 ${fmtKg(goal)} · ${pct}%`;
  $('#goal-fill').style.width = `${Math.min(100, (total / (goal * 1.4)) * 100)}%`;
  $('#day-goal').classList.toggle('reached', total >= goal);
  const sets = list.reduce((a, ex) => a + ex.sets.length, 0);
  const label = state.day === todayStr() ? '오늘' : fmtDate(state.day);
  document.querySelector('#view-day .summary-label').textContent = `${label} 총 볼륨`;
  const dayStats = rangeStats([state.day]);
  $('#day-sub').innerHTML = list.length ? [`운동 ${list.length}개 · ${sets}세트`, cardioLine(dayStats)].filter(Boolean).join('<br />') : '';
  $('#day-label').textContent = `${parse(state.day).getMonth() + 1}월 ${parse(state.day).getDate()}일 (${'일월화수목금토'[parse(state.day).getDay()]})`;
  $('#day-count').textContent = list.length ? list.length : '';
  document.querySelector('#view-day .section-head span').firstChild.textContent = state.day === todayStr() ? '오늘의 운동 ' : '이날의 운동 ';
  updateHeader();
}

/* ---------- 주간 ---------- */
$('#view-week').querySelectorAll('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => { state.weekAnchor = addDays(state.weekAnchor, 7 * b.dataset.shift); renderWeek(); })
);
$('#week-today').addEventListener('click', () => { state.weekAnchor = todayStr(); renderWeek(); });

function weekDates(anchor) {
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function renderWeek() {
  const dates = weekDates(state.weekAnchor);
  const prevDates = dates.map((d) => addDays(d, -7));
  const stats = rangeStats(dates);
  const prevTotal = rangeVolume(prevDates);

  $('#week-label').textContent = `${fmtDate(dates[0])} ~ ${fmtDate(dates[6])}`;
  $('#week-total').textContent = fmtKg(stats.total);
  $('#week-sub').innerHTML = [
    `운동한 날 ${stats.days}일 · ${stats.sets}세트 · ${stats.reps.toLocaleString('ko-KR')}회`,
    diffText(stats.total, prevTotal, '지난주'),
    cardioLine(stats),
  ].filter(Boolean).join('<br />');

  const vols = dates.map(dayVolume);
  const cvols = dates.map(dayCardioVolume);
  const max = Math.max(...vols, 1);
  const today = todayStr();
  $('#week-chart').innerHTML = dates.map((d, i) => `
    <div class="bar-col ${d === today ? 'today' : ''}" data-date="${d}">
      <div class="bar-val">${fmtShort(vols[i])}</div>
      <div class="bar-track"><div class="bar ${vols[i] ? '' : 'zero'}" style="height:${(vols[i] / max) * 100}%">${cvols[i] ? `<i class="bar-c" style="height:${(cvols[i] / vols[i]) * 100}%"></i>` : ''}</div></div>
      <div class="bar-label">${WEEKDAYS[i]}</div>
    </div>`).join('');
  $('#week-chart').querySelectorAll('.bar-col').forEach((c) =>
    c.addEventListener('click', () => goToDay(c.dataset.date))
  );

  $('#week-parts').innerHTML = partsHtml(stats);
  $('#week-breakdown').innerHTML = breakdownHtml({ byEx: { ...stats.byEx, ...stats.cardioByEx } });
}

/* ---------- 월간 ---------- */
$('#view-month').querySelectorAll('.nav-btn').forEach((b) =>
  b.addEventListener('click', () => { state.monthAnchor = addMonths(state.monthAnchor, +b.dataset.shift); renderMonth(); })
);
$('#month-today').addEventListener('click', () => { state.monthAnchor = todayStr(); renderMonth(); });

function renderMonth() {
  const dates = monthDays(state.monthAnchor);
  const prevDates = monthDays(addMonths(state.monthAnchor, -1));
  const stats = rangeStats(dates);
  const prevTotal = rangeVolume(prevDates);
  const first = parse(dates[0]);

  $('#month-label').textContent = `${first.getFullYear()}년 ${first.getMonth() + 1}월`;
  $('#month-total').textContent = fmtKg(stats.total);
  const avg = stats.days ? stats.total / stats.days : 0;
  $('#month-sub').innerHTML = [
    `운동한 날 ${stats.days}일 · ${stats.sets}세트 · 하루 평균 ${fmtKg(avg)}`,
    `목표 달성 ${dates.filter((d) => { const v = dayVolume(d); return v > 0 && v >= dailyGoal(d); }).length}일`,
    diffText(stats.total, prevTotal, '지난달'),
    cardioLine(stats),
  ].filter(Boolean).join('<br />');

  // 달력 (월요일 시작)
  const vols = dates.map(dayVolume);
  const max = Math.max(...vols, 1);
  const lead = (first.getDay() + 6) % 7;
  const today = todayStr();
  let html = WEEKDAYS.map((w, i) => `<div class="cal-head ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${w}</div>`).join('');
  html += '<div class="cal-cell blank"></div>'.repeat(lead);
  dates.forEach((d, i) => {
    const v = vols[i];
    const alpha = v ? 0.35 + 0.65 * (v / max) : 0;
    const bg = v ? `background: rgba(17,17,19,${alpha.toFixed(2)});` : '';
    const col = (lead + i) % 7;
    html += `
      <div class="cal-cell ${d === today ? 'today' : ''} ${v ? 'has' : ''}" data-date="${d}" style="${bg}">
        <span class="cal-day ${col === 5 ? 'sat' : col === 6 ? 'sun' : ''}">${i + 1}</span>
        <span class="cal-vol">${fmtShort(v)}</span>
      </div>`;
  });
  const cal = $('#month-calendar');
  cal.innerHTML = html;
  cal.querySelectorAll('.cal-cell[data-date]').forEach((c) =>
    c.addEventListener('click', () => goToDay(c.dataset.date))
  );

  // 주차별 (이 달에 속한 날짜만 합산)
  const weeks = [];
  for (const d of dates) {
    const ws = weekStart(d);
    let w = weeks.find((x) => x.start === ws);
    if (!w) weeks.push((w = { start: ws, dates: [] }));
    w.dates.push(d);
  }
  $('#month-weeks').innerHTML = weeks.map((w, i) => `
    <div class="week-row">
      <span>${i + 1}주차 <small>${fmtDate(w.dates[0])} ~ ${fmtDate(w.dates[w.dates.length - 1])}</small></span>
      <span>${fmtKg(rangeVolume(w.dates))}</span>
    </div>`).join('');

  $('#month-parts').innerHTML = partsHtml(stats);
  $('#month-breakdown').innerHTML = breakdownHtml({ byEx: { ...stats.byEx, ...stats.cardioByEx } });
}

/* ---------- 공통 ---------- */
function breakdownHtml(stats) {
  const entries = Object.entries(stats.byEx).sort((a, b) => b[1].volume - a[1].volume);
  if (!entries.length) return '<p class="empty-text">기록이 없어요</p>';
  const max = Math.max(...entries.map(([, e]) => e.volume), 1);
  return entries.map(([name, e]) => `
    <div class="breakdown-row">
      <div class="breakdown-top">
        <span>${e.cardio && name !== '유산소' ? '<i class="tag-c">유산소</i> ' : ''}${escapeHtml(name)} <span class="meta">${e.km || e.min ? [e.km ? `${+e.km.toFixed(1)}km` : '', e.min ? `${e.min}분` : ''].filter(Boolean).join(' · ') : `${e.sets}세트 · ${e.reps}회`}</span></span>
        <strong>${fmtKg(e.volume)}</strong>
      </div>
      <div class="breakdown-bar"><div style="width:${(e.volume / max) * 100}%"></div></div>
    </div>`).join('');
}

function partsHtml(stats) {
  const parts = {};
  for (const [name, e] of Object.entries(stats.byEx)) {
    const p = (parts[partOf(name)] ||= { volume: 0, sets: 0, reps: 0 });
    p.volume += e.volume;
    p.sets += e.sets;
    p.reps += e.reps;
  }
  if (stats.cardio) parts['유산소'] = { volume: stats.cardio, sets: 0, reps: 0, km: stats.km, min: stats.min, cardio: true };
  return breakdownHtml({ byEx: parts });
}

function goToDay(date) {
  state.day = date;
  showView('day');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const v = currentView();
  if (v === 'day') renderDay();
  else if (v === 'week') renderWeek();
  else if (v === 'month') renderMonth();
  else if (v === 'rank') social.render();
  else if (v === 'settings') updateGoalNote();
}

/* ---------- 설정: 백업 ---------- */
async function download(filename, content, type) {
  // Claude 아티팩트 안에서는 downloads 기능으로 저장
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) {
        await dl.save({ filename, data: content });
        toast('파일을 저장했어요');
        return;
      }
    } catch (e) {
      if (e && e.code === 'declined') return;
      toast('이 화면에서는 파일 저장을 할 수 없어요');
      return;
    }
  }
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#export-btn').addEventListener('click', () => {
  download(`gymlog-${todayStr()}.json`, JSON.stringify({ ...db, _bodyweight: bwMap }, null, 2), 'application/json');
});

$('#export-csv-btn').addEventListener('click', () => {
  const rows = [['날짜', '운동', '세트', '무게(kg)', '횟수', '거리(km)', '시간(분)', '칼로리(kcal)', '볼륨(kg)']];
  for (const d of Object.keys(db).sort()) {
    for (const ex of db[d]) {
      ex.sets.forEach((s, i) => rows.push([d, ex.name, i + 1, num(s.w), num(s.r), num(s.km), num(s.min), cardioInfo(ex) ? Math.round(cardioKcal(s, cardioInfo(ex), bodyweightOn(d) || DEFAULT_BW, cardioMode(ex))) : '', Math.round(setVolume(s, ex, d))]));
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(`gymlog-${todayStr()}.csv`, '﻿' + csv, 'text/csv');
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('형식 오류');
    const importedBw = data._bodyweight && typeof data._bodyweight === 'object' ? data._bodyweight : null;
    delete data._bodyweight;
    for (const [k, v] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v)) throw new Error('형식 오류');
    }
    if (!(await askConfirm('가져온 데이터로 기존 기록을 덮어쓸까요?', { okText: '덮어쓰기', danger: true }))) return;
    db = data;
    if (importedBw) { bwMap = importedBw; saveBw(); }
    save();
    toast('가져오기 완료!');
    render();
  } catch (err) {
    toast('파일을 읽을 수 없어요: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

$('#reset-btn').addEventListener('click', async () => {
  if (!(await askConfirm('정말 모든 기록을 삭제할까요?\n되돌릴 수 없어요.', { okText: '전부 삭제', danger: true }))) return;
  db = {};
  bwMap = {};
  saveBw();
  save();
  render();
});

/* ---------- 휴식 타이머 ---------- */
const REST_KEY = 'gymlog.restSeconds';
const restInput = $('#rest-seconds');
let restSec = (() => {
  try {
    const v = parseInt(localStorage.getItem(REST_KEY), 10);
    return Number.isFinite(v) && v > 0 ? v : 60;
  } catch { return 60; }
})();
function restSeconds() { return restSec; }
function setRestSeconds(v, sync = true) {
  restSec = Math.min(600, Math.max(5, parseInt(v, 10) || 60));
  restInput.value = restSec;
  try { localStorage.setItem(REST_KEY, restSec); } catch { /* 저장소 없음 */ }
  if (sync) cloud.markDirty();
}
restInput.value = restSeconds();
restInput.addEventListener('change', () => setRestSeconds(restInput.value));
const goalInput = $('#goal-input');
goalInput.value = customGoal || '';
goalInput.addEventListener('change', () => { setCustomGoal(goalInput.value); render(); toast(customGoal ? `하루 목표 ${fmtKg(customGoal)}` : '목표를 자동(몸무게 × 110)으로 바꿨어요'); });
updateGoalNote();

const restTimer = (() => {
  const box = $('#rest-timer');
  const timeEl = $('#rest-time');
  const titleEl = $('#rest-title');
  const barEl = $('#rest-progress-bar');
  const ringEl = $('#rest-ring');
  let endAt = 0, total = 0, tickId = null, finished = false, audioCtx = null, wakeLock = null;

  function unlockAudio() {
    // 사용자 클릭 시점에 오디오를 열어둬야 모바일에서 나중에 소리가 남
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { /* 미지원 */ }
  }
  function beep() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((dt) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0 + dt);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.2);
    });
  }
  function vibrate() {
    if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 600]);
  }
  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 미지원 */ }
  }
  function releaseWake() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }
  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function tick() {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    timeEl.textContent = fmt(left);
    const ratio = total ? Math.min(1, (endAt - Date.now()) / (total * 1000)) : 0;
    barEl.style.width = `${Math.max(0, ratio) * 100}%`;
    ringEl.style.strokeDashoffset = String(578.05 * (1 - Math.max(0, ratio)));
    if (left === 0 && !finished) finish();
  }
  function finish() {
    finished = true;
    clearInterval(tickId);
    tickId = null;
    box.classList.add('done');
    titleEl.textContent = '다음 세트 시작하세요 💪';
    $('#rest-state').textContent = '휴식 끝!';
    ringEl.style.strokeDashoffset = '0';
    $('#rest-stop').textContent = '다음 세트 시작';
    timeEl.textContent = '0:00';
    vibrate();
    beep();
    releaseWake();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('휴식 끝!', { body: '다음 세트 시작하세요 💪' }); } catch { /* 무시 */ }
    }
  }

  function start(title) {
    unlockAudio();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    total = restSeconds();
    endAt = Date.now() + total * 1000;
    finished = false;
    titleEl.textContent = title;
    box.classList.remove('done');
    $('#rest-state').textContent = '남은 휴식 시간';
    $('#rest-stop').textContent = '휴식 건너뛰기';
    box.hidden = false;
    document.body.classList.add('modal-open');
    clearInterval(tickId);
    tickId = setInterval(tick, 250);
    keepAwake();
    tick();
  }
  function adjust(delta) {
    if (finished) return;
    endAt += delta * 1000;
    total = Math.max(total + delta, 1);
    tick();
  }
  function stop() {
    clearInterval(tickId);
    tickId = null;
    box.hidden = true;
    box.classList.remove('done');
    document.body.classList.remove('modal-open');
    if ('vibrate' in navigator) navigator.vibrate(0);
    releaseWake();
  }

  // 백그라운드에서 돌아왔을 때 즉시 갱신
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !box.hidden && !finished) { tick(); keepAwake(); }
  });

  $('#rest-minus').addEventListener('click', () => adjust(-10));
  $('#rest-plus').addEventListener('click', () => adjust(10));
  $('#rest-stop').addEventListener('click', stop);
  $('#rest-close').addEventListener('click', stop);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) stop(); });
  $('#rest-test').addEventListener('click', () => {
    unlockAudio();
    vibrate();
    beep();
    if (!('vibrate' in navigator)) toast('이 브라우저는 진동을 지원하지 않아요 · 소리로 알려드려요');
  });

  return { start, stop };
})();

renderPartChips();
render();
/* =========================================================
 * 그룹 순위 + 응원 댓글 (공유 링크에서만)
 * board/<id>               : 각자 자기 요약 (닉네임, 날짜별 볼륨, 최고 중량)
 * comments/<id>/items/<n>  : 각자 쓴 댓글 { to, text, at }
 * 모두 읽을 수 있고, 각자 자기 것만 쓸 수 있음
 * ========================================================= */
const social = (() => {
  let store = null, myId = null, ready = false, failed = false;
  let members = {};            // id → board 문서
  const comments = {};          // 작성자 id → [{id, to, text, at}]
  const commentSubs = {};
  let lastPublished = null;
  let period = 'week', metric = 'total', bestEx = '';
  let openPerson = null;
  function rebuildFriendCustoms() {
    const map = new Map();
    for (const [uid, doc] of Object.entries(members)) {
      if (uid === myId) continue;
      const items = Array.isArray(doc.custom) ? doc.custom : [];
      for (const it of items) {
        const name = String(it && it.n || '').trim().slice(0, 40);
        if (!name || map.has(name)) continue;
        map.set(name, { name, bw: !!it.bw, by: (members[uid] && members[uid].nick) || '친구' });
      }
    }
    friendCustoms = [...map.values()];
    if (!resultsEl.hidden) renderResults();
  }
  /** 내가 직접 추가한 운동 목록 (순위 데이터에 함께 실어 친구들과 공유) */
  function myCustoms() {
    const seen = new Map();
    for (const d of Object.keys(db)) for (const ex of db[d]) {
      if (EXERCISES.some((e) => e.name === ex.name)) continue;
      seen.set(ex.name, bwType(ex) === 'bw' ? 1 : 0);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([n, bw]) => (bw ? { n, bw } : { n }));
  }
  const SEEN_KEY = 'gymlog.feedSeen';

  function init(s, id) {
    store = s; myId = id;
    let loaded = false;
    const t = setTimeout(() => { if (!loaded) { failed = true; render(); } }, 10000);
    store.collection('board').onSnapshot((snap) => {
      loaded = true; clearTimeout(t); failed = false; ready = true;
      const next = {};
      snap.docs.forEach((d) => { if (d.exists) next[d.id] = d.data(); });
      members = next;
      Object.keys(members).forEach(subscribeComments);
      rebuildFriendCustoms();
      if (members[myId] && !lastPublished) {
        const m = members[myId];
        lastPublished = JSON.stringify({ nick: m.nick, days: m.days || {}, best: m.best || {}, cdays: m.cdays || {}, log: m.log || {}, custom: m.custom || [] });
      }
      refresh();
    }, () => { loaded = true; clearTimeout(t); failed = true; refresh(); });
  }

  function subscribeComments(uid) {
    if (commentSubs[uid] || Object.keys(commentSubs).length >= 60) return;
    commentSubs[uid] = store.collection(`comments/${uid}/items`).orderBy('at', 'desc').limit(100)
      .onSnapshot((snap) => {
        comments[uid] = snap.docs.filter((d) => d.exists).map((d) => ({ id: d.id, from: uid, ...d.data() }));
        refresh();
      }, () => {});
  }

  function refresh() {
    updateDot();
    if (currentView() === 'rank') render();
    if (openPerson) renderPerson();
  }

  const myNick = () => (members[myId] && members[myId].nick) || '';
  const nickOf = (id) => (members[id] && members[id].nick) || '알 수 없음';

  /* ---- 내 요약 올리기 ---- */
  function mySummary() {
    const days = {}, best = {}, cdays = {};
    for (const d of Object.keys(db)) {
      const v = Math.round(dayStrengthVolume(d));
      if (v > 0) days[d] = v;
      const c = Math.round(dayCardioVolume(d));
      if (c > 0) cdays[d] = c;
      for (const ex of db[d]) {
        if (bwType(ex) || cardioInfo(ex)) continue;
        for (const st of ex.sets) {
          if (num(st.r) > 0 && num(st.w) > 0) best[ex.name] = Math.max(best[ex.name] || 0, num(st.w));
        }
      }
    }
    return { days, best, cdays, log: shareLog() ? recentLog(30) : {}, custom: myCustoms() };
  }

  /* ---- 운동 내용 공유 (최근 30일) ---- */
  const SHARE_KEY = 'gymlog.shareLog';
  function shareLog() { try { return localStorage.getItem(SHARE_KEY) !== 'off'; } catch { return true; } }
  const kgStr = (w) => `${+num(w).toFixed(2)}kg`;
  function describeSets(ex) {
    const sets = ex.sets.filter((st) => num(st.r) > 0 || num(st.km) > 0 || num(st.min) > 0 || num(st.wkcal) > 0);
    if (!sets.length) return '';
    if (cardioInfo(ex)) {
      return sets.map((st) => [
        num(st.km) ? `${num(st.km)}km` : '',
        num(st.min) ? `${num(st.min)}분` : '',
        paceText(ex.name, num(st.km), num(st.min)),
        cardioMode(ex) === 'watch' && num(st.wkcal) ? `⌚${num(st.wkcal)}kcal` : '',
        num(st.goals) ? `⚽${num(st.goals)}골` : '',
        num(st.hr) ? `♥${num(st.hr)}` : '',
        st.note ? String(st.note).slice(0, 40) : '',
      ].filter(Boolean).join(' · ')).join(' / ');
    }
    const t = bwType(ex);
    const groups = [];
    for (const st of sets) {
      const w = t === 'bw' ? (num(st.w) ? `맨몸+${kgStr(st.w)}` : '맨몸') : t === 'assist' ? `보조 ${kgStr(st.w)}` : kgStr(st.w);
      const label = `${w} × ${num(st.r)}회`;
      const g = groups[groups.length - 1];
      if (g && g.label === label) g.n++; else groups.push({ label, n: 1 });
    }
    return groups.map((g) => g.n > 1 ? `${g.label} × ${g.n}세트` : g.label).join(', ');
  }
  function recentLog(daysBack) {
    const from = addDays(todayStr(), -(daysBack - 1));
    const log = {};
    for (const d of Object.keys(db)) {
      if (d < from) continue;
      const items = db[d].map((ex) => ({ n: ex.name, d: describeSets(ex), v: Math.round(exerciseVolume(ex, d)), c: cardioInfo(ex) ? 1 : 0 }))
        .filter((x) => x.d);
      if (items.length) log[d] = items;
    }
    return log;
  }
  async function publish(nickOverride) {
    if (!store || !myId) return;
    const nick = nickOverride || myNick();
    if (!nick) return;                       // 참가 전에는 올리지 않음
    const { days, best, cdays, log, custom } = mySummary();
    const key = JSON.stringify({ nick, days, best, cdays, log, custom });
    if (key === lastPublished) return;
    await store.doc('board/' + myId).set({ nick, days, best, cdays, log, custom, updatedAt: Date.now() });
    lastPublished = key;
  }

  /* ---- 순위 계산 ---- */
  function periodDates() {
    if (period === 'week') return new Set(weekDates(todayStr()));
    if (period === 'month') return new Set(monthDays(todayStr()));
    return null;
  }
  function statsOf(m) {
    const set = periodDates();
    let volume = 0, cardio = 0;
    const active = new Set();
    for (const [d, v] of Object.entries(m.days || {})) {
      if (set && !set.has(d)) continue;
      volume += num(v); if (num(v) > 0) active.add(d);
    }
    for (const [d, v] of Object.entries(m.cdays || {})) {
      if (set && !set.has(d)) continue;
      cardio += num(v); if (num(v) > 0) active.add(d);
    }
    return { volume, cardio, days: active.size };
  }
  function ranking() {
    const rows = Object.entries(members).map(([id, m]) => {
      const st = statsOf(m);
      const value = metric === 'total' ? st.volume + st.cardio : metric === 'volume' ? st.volume : metric === 'cardio' ? st.cardio : metric === 'days' ? st.days : num((m.best || {})[bestEx]);
      return { id, m, st, value };
    });
    rows.sort((a, b) => b.value - a.value || a.m.nick.localeCompare(b.m.nick, 'ko'));
    return rows;
  }
  const fmtMetric = (v) => metric === 'total' || metric === 'volume' || metric === 'cardio' ? fmtKg(v) : metric === 'days' ? `${v}일` : v ? `${v} kg` : '-';
  const periodLabel = () => ({ week: '이번 주', month: '이번 달', all: '전체 기간' }[period]);

  function allComments() {
    return Object.values(comments).flat().filter((c) => members[c.from]).sort((a, b) => b.at - a.at);
  }
  function relTime(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function updateDot() {
    let seen = 0; try { seen = +localStorage.getItem(SEEN_KEY) || 0; } catch {}
    const latest = allComments().find((c) => c.to === myId && c.from !== myId && c.kind !== 'share');
    $('#rank-dot').classList.toggle('on', !!latest && latest.at > seen);
  }

  /* ---- 화면 ---- */
  function render() {
    const unavailable = !store;
    $('#rank-unavailable').hidden = !(unavailable || failed);
    if (failed) $('#rank-unavailable-msg').textContent = '그룹 순위를 불러오지 못했어요. 잠시 후 다시 열어주세요.';
    $('#rank-join').hidden = unavailable || failed || !ready || !!myNick();
    $('#rank-main').hidden = unavailable || failed || !ready || !myNick();
    if ($('#rank-main').hidden) return;
    try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {}
    updateDot();
    $('#rank-board').hidden = mode !== 'board';
    $('#photo-feed').hidden = mode !== 'photos';
    if (mode === 'photos') { renderPhotoFeed(); return; }

    // 운동 선택 (최고 중량)
    const exNames = [...new Set(Object.values(members).flatMap((m) => Object.keys(m.best || {})))].sort((a, b) => a.localeCompare(b, 'ko'));
    if (!bestEx || !exNames.includes(bestEx)) bestEx = exNames.includes('바벨 벤치프레스') ? '바벨 벤치프레스' : exNames[0] || '';
    const sel = $('#rank-exercise');
    sel.hidden = metric !== 'best';
    sel.innerHTML = exNames.map((n) => `<option ${n === bestEx ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('') || '<option>기록 없음</option>';

    const rows = ranking();
    const max = Math.max(...rows.map((r) => r.value), 1);
    const myIdx = rows.findIndex((r) => r.id === myId);
    const metricName = { total: '총 볼륨', volume: '근력 볼륨', cardio: '유산소 볼륨', days: '운동일수', best: bestEx ? `${bestEx} 최고 중량` : '최고 중량' }[metric];
    $('#rank-my-label').textContent = `${metric === 'best' ? '전체 기간' : periodLabel()} · ${metricName}`;
    $('#rank-my-rank').textContent = myIdx >= 0 ? `${myIdx + 1}위 / ${rows.length}명` : '-';
    const me = rows[myIdx];
    const gap = myIdx > 0 ? rows[myIdx - 1].value - me.value : 0;
    $('#rank-my-sub').textContent = me ? `내 기록 ${fmtMetric(me.value)}${myIdx > 0 ? ` · ${myIdx}위까지 ${fmtMetric(gap)}` : myIdx === 0 && rows.length > 1 ? ' · 1등이에요! 🔥' : ''}` : '';

    const cmtCount = {};
    allComments().forEach((c) => { if (c.kind !== 'share') cmtCount[c.to] = (cmtCount[c.to] || 0) + 1; });
    $('#rank-list').innerHTML = rows.map((r, i) => `
      <button class="rank-row ${r.id === myId ? 'me' : ''}" data-id="${escapeHtml(r.id)}">
        <span class="rank-no">${i + 1}</span>
        <span class="rank-main">
          <span class="rank-name">${escapeHtml(r.m.nick)}${r.id === myId ? '<span class="me-tag">나</span>' : ''}
            ${cmtCount[r.id] ? `<span class="rank-cmt"><svg class="i"><use href="#i-chat"/></svg>${cmtCount[r.id]}</span>` : ''}</span>
          <span class="rank-bar"><div style="width:${(r.value / max) * 100}%"></div></span>
        </span>
        <span class="rank-val">${fmtMetric(r.value)}</span>
      </button>`).join('');
    $('#rank-list').querySelectorAll('.rank-row').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.id)));

    const feed = allComments().slice(0, 30);
    $('#feed-list').innerHTML = feed.length ? feed.map((c) => c.kind === 'share' ? `
      <div class="feed-item share-post" data-from="${escapeHtml(c.from)}">
        <div class="feed-meta"><b>${escapeHtml(nickOf(c.from))}</b> 님이 운동을 공유했어요 · ${relTime(c.at)}
          ${c.from === myId ? `<button class="comment-del" data-del="${escapeHtml(c.id)}">삭제</button>` : ''}</div>
        <div class="share-sum">${escapeHtml(String(c.summary || ''))}</div>
        ${c.text ? `<div class="feed-text">${escapeHtml(c.text)}</div>` : ''}
        ${Array.isArray(c.items) && c.items.length ? `<div class="share-items">${c.items.slice(0, 15).map((x) => `<div><b>${escapeHtml(String(x.n || ''))}</b> <span>${escapeHtml(String(x.d || ''))}</span></div>`).join('')}</div>` : ''}
        ${typeof c.img === 'string' && c.img.startsWith('data:image/') ? `<img class="share-img" src="${c.img}" alt="" />` : ''}
      </div>` : `
      <div class="feed-item">
        <div class="feed-meta"><b>${escapeHtml(nickOf(c.from))}</b> → <b>${escapeHtml(nickOf(c.to))}</b> · ${relTime(c.at)}</div>
        <div class="feed-text">${escapeHtml(c.text)}</div>
      </div>`).join('') : '<p class="empty-text">아직 댓글이 없어요. 친구를 눌러 첫 응원을 남겨보세요!</p>';
    $('#feed-list').querySelectorAll('.share-img').forEach((el) => el.addEventListener('click', () => { $('#photo-viewer-img').src = el.src; $('#photo-viewer').hidden = false; }));
    $('#feed-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askConfirm('공유한 글을 삭제할까요?', { okText: '삭제', danger: true }))) return;
      try { await store.doc(`comments/${myId}/items/${b.dataset.del}`).delete(); } catch { toast('삭제하지 못했어요'); }
    }));
    $('#my-nick').textContent = myNick();
  }

  function openProfile(id) {
    openPerson = id;
    logDay = null;
    $('#person-modal').hidden = false;
    document.body.classList.add('modal-open');
    renderPerson();
  }
  function closeProfile() {
    openPerson = null;
    $('#person-modal').hidden = true;
    document.body.classList.remove('modal-open');
  }
  function renderPerson() {
    const m = members[openPerson];
    if (!m) { closeProfile(); return; }
    const rows = ranking();
    const idx = rows.findIndex((r) => r.id === openPerson);
    $('#person-rank').textContent = `${periodLabel()} ${idx + 1}위`;
    $('#person-name').textContent = m.nick + (openPerson === myId ? ' (나)' : '');
    const days = {};
    for (const [d, v] of Object.entries(m.days || {})) days[d] = num(days[d]) + num(v);
    for (const [d, v] of Object.entries(m.cdays || {})) days[d] = num(days[d]) + num(v);
    const sum = (dates) => dates.reduce((a, d) => a + num(days[d]), 0);
    const wk = weekDates(todayStr());
    const bests = Object.entries(m.best || {}).sort((a, b) => b[1] - a[1]);
    $('#person-stats').innerHTML = `
      <div class="stat"><small>이번 주 볼륨</small><b>${fmtShort(sum(wk)) || 0}</b></div>
      <div class="stat"><small>이번 달 볼륨</small><b>${fmtShort(sum(monthDays(todayStr()))) || 0}</b></div>
      <div class="stat"><small>최고 중량</small><b>${bests[0] ? `${bests[0][1]}kg` : '-'}</b></div>`;
    const vals = wk.map((d) => num(days[d]));
    const max = Math.max(...vals, 1);
    $('#person-week').innerHTML = wk.map((d, i) => `<div class="pw"><i class="${vals[i] ? '' : 'zero'}" style="height:${Math.max(6, (vals[i] / max) * 100)}%"></i>${WEEKDAYS[i]}</div>`).join('');
    renderPersonLog(m);

    const list = allComments().filter((c) => c.to === openPerson && c.kind !== 'share').reverse();
    const box = $('#person-comments');
    box.innerHTML = list.length ? list.map((c) => `
      <div class="comment-item">
        <div class="comment-meta"><b>${escapeHtml(nickOf(c.from))}</b> · ${relTime(c.at)}
          ${c.from === myId ? `<button class="comment-del" data-id="${escapeHtml(c.id)}">삭제</button>` : ''}</div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
      </div>`).join('') : '<p class="empty-text">첫 댓글을 남겨보세요</p>';
    box.querySelectorAll('.comment-del').forEach((b) => b.addEventListener('click', async () => {
      try { await store.doc(`comments/${myId}/items/${b.dataset.id}`).delete(); } catch { toast('삭제하지 못했어요'); }
    }));
    box.scrollTop = box.scrollHeight;
  }

  let logDay = null;
  function renderPersonLog(m) {
    const box = $('#person-log');
    const log = m.log || {};
    const dates = Object.keys(log).sort().reverse().slice(0, 14);
    if (!dates.length) {
      box.innerHTML = `<p class="empty-text">${openPerson === myId && !shareLog() ? '운동 내용 공개가 꺼져 있어요' : '최근 30일 운동 내용이 없어요'}</p>`;
      return;
    }
    if (!logDay || !dates.includes(logDay)) logDay = dates[0];
    const items = Array.isArray(log[logDay]) ? log[logDay] : [];
    box.innerHTML = `
      <div class="log-dates">${dates.map((d) => `<button type="button" class="log-date ${d === logDay ? 'active' : ''}" data-d="${escapeHtml(d)}">${escapeHtml(fmtDate(d))}</button>`).join('')}</div>
      <div class="log-items">${items.map((x) => `
        <div class="log-item">
          <div class="log-top"><b>${escapeHtml(x.n)}</b><span>${x.c ? '유산소 ' : ''}${fmtKg(num(x.v))}</span></div>
          <div class="log-desc">${escapeHtml(x.d)}</div>
        </div>`).join('')}</div>`;
    box.querySelectorAll('.log-date').forEach((b) => b.addEventListener('click', () => { logDay = b.dataset.d; renderPersonLog(m); }));
  }

  async function sendComment(text) {
    text = text.trim().slice(0, 200);
    if (!text || !openPerson || !store) return;
    try {
      await store.collection(`comments/${myId}/items`).add({ to: openPerson, text, at: Date.now() });
      $('#comment-input').value = '';
    } catch (e) {
      toast(e && e.code === 'invalid_argument' ? '댓글을 쓸 권한이 없어요 (편집자로 초대받아야 해요)' : '댓글을 보내지 못했어요');
    }
  }

  async function join(nick) {
    nick = nick.trim().slice(0, 12);
    if (!nick) return;
    if (Object.entries(members).some(([id, m]) => id !== myId && m.nick === nick)) { toast('이미 있는 닉네임이에요'); return; }
    try {
      lastPublished = null;
      await publish(nick);
      toast(`${nick}님, 참가 완료! 🏋️`);
    } catch (e) {
      toast(e && e.code === 'invalid_argument' ? '참가 권한이 없어요. 링크 주인에게 편집자 초대를 받아주세요' : '참가하지 못했어요. 다시 시도해 주세요');
    }
  }

  // 이벤트
  $('#join-form').addEventListener('submit', (e) => { e.preventDefault(); join($('#join-nick').value); });
  $('#rank-period').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    period = b.dataset.period;
    $('#rank-period').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));
  $('#rank-metric').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    metric = b.dataset.metric;
    $('#rank-metric').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));
  $('#rank-exercise').addEventListener('change', (e) => { bestEx = e.target.value; render(); });
  $('#person-close').addEventListener('click', closeProfile);
  $('#person-modal .rest-backdrop').addEventListener('click', closeProfile);
  $('#comment-form').addEventListener('submit', (e) => { e.preventDefault(); sendComment($('#comment-input').value); });
  document.querySelectorAll('#person-modal .cheer').forEach((b) => b.addEventListener('click', () => sendComment(b.dataset.cheer)));
  const shareToggle = $('#share-log');
  shareToggle.checked = shareLog();
  shareToggle.addEventListener('change', async () => {
    try { localStorage.setItem(SHARE_KEY, shareToggle.checked ? 'on' : 'off'); } catch { /* 없음 */ }
    try { await publish(); toast(shareToggle.checked ? '운동 내용을 친구들에게 공개해요' : '운동 내용을 비공개로 바꿨어요'); } catch { toast('저장하지 못했어요'); }
  });
  $('#nick-change').addEventListener('click', () => {
    $('#rank-join').hidden = false;
    $('#join-nick').value = myNick();
    $('#join-nick').focus();
  });
  setInterval(() => { if (currentView() === 'rank') render(); }, 60000);

  /* ---- 사진 피드 (셋로그처럼 사진만 모아보기) ---- */
  let mode = 'board', feedSrc = 'friends', feedList = [], feedIdx = 0;
  $('#rank-mode').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $('#rank-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  }));
  $('#feed-chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    feedSrc = b.dataset.src;
    $('#feed-chips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    renderPhotoFeed();
  }));

  async function renderPhotoFeed() {
    const grid = $('#photo-feed-grid'), hint = $('#photo-feed-hint');
    if (feedSrc === 'friends') {
      feedList = allComments().filter((c) => c.kind === 'share' && typeof c.img === 'string' && c.img.startsWith('data:image/'))
        .map((c) => ({ img: c.img, who: nickOf(c.from), from: c.from, date: c.date, summary: c.summary, text: c.text, items: c.items, at: c.at, mine: c.from === myId }));
      hint.textContent = feedList.length ? '공유할 때 눈바디 사진을 켜면 여기에 모여요' : '아직 공유된 사진이 없어요. 운동 마감 → 친구에게 공유 → 눈바디 사진 켜기';
    } else {
      const ds = photos.dates().slice().reverse();
      hint.textContent = ds.length ? '내 눈바디는 나만 볼 수 있어요' : '아직 올린 눈바디 사진이 없어요. 일간 화면에서 올려보세요';
      grid.innerHTML = ds.map(() => '<div class="pf-cell loading"></div>').join('');
      const imgs = await Promise.all(ds.map((d) => photos.get(d)));
      if (feedSrc !== 'mine') return;
      feedList = ds.map((d, i) => ({ img: imgs[i], who: '나', date: d, summary: `${fmtDate(d)} · ${fmtKg(dayVolume(d))}`, mine: true, own: true })).filter((x) => x.img);
    }
    grid.innerHTML = feedList.map((x, i) => `
      <button type="button" class="pf-cell" data-i="${i}">
        <img src="${x.img}" alt="" loading="lazy" />
        <span class="pf-tag">${x.own ? escapeHtml(fmtDate(x.date)) : escapeHtml(x.who)}</span>
      </button>`).join('');
    grid.querySelectorAll('.pf-cell[data-i]').forEach((el) => el.addEventListener('click', () => openPost(+el.dataset.i)));
  }

  function openPost(i) {
    feedIdx = (i + feedList.length) % feedList.length;
    const x = feedList[feedIdx];
    if (!x) return;
    $('#post-who').textContent = x.own ? `내 눈바디 · ${fmtDate(x.date)}` : `${x.who} · ${x.at ? relTime(x.at) : ''}`;
    $('#post-img').src = x.img;
    $('#post-sum').textContent = String(x.summary || '');
    $('#post-text').textContent = String(x.text || '');
    $('#post-items').innerHTML = Array.isArray(x.items) ? x.items.slice(0, 15).map((it) => `<div><b>${escapeHtml(String(it.n || ''))}</b> <span>${escapeHtml(String(it.d || ''))}</span></div>`).join('') : '';
    $('#post-cheers').hidden = !!x.mine;
    $('#post-modal').hidden = false;
    document.body.classList.add('modal-open');
  }
  function closePost() { $('#post-modal').hidden = true; document.body.classList.remove('modal-open'); }
  $('#post-close').addEventListener('click', closePost);
  $('#post-modal .rest-backdrop').addEventListener('click', closePost);
  $('#post-prev').addEventListener('click', () => openPost(feedIdx - 1));
  $('#post-next').addEventListener('click', () => openPost(feedIdx + 1));
  $('#post-img').addEventListener('click', () => { $('#photo-viewer-img').src = $('#post-img').src; $('#photo-viewer').hidden = false; });
  // 좌우 스와이프로 넘기기
  let sx = null;
  $('#post-img').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('#post-img').addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) openPost(feedIdx + (dx < 0 ? 1 : -1));
  });
  $('#post-cheers').querySelectorAll('.cheer').forEach((b) => b.addEventListener('click', async () => {
    const x = feedList[feedIdx];
    if (!x || x.mine || !store) return;
    try {
      await store.collection(`comments/${myId}/items`).add({ to: x.from, text: `${b.dataset.cheer} (${fmtDate(x.date)} 사진)`, at: Date.now() });
      toast(`${x.who}님에게 ${b.dataset.cheer} 보냈어요`);
    } catch { toast('보내지 못했어요'); }
  }));

  /* ---- 운동 공유 ---- */
  let shareDate = null;
  function shareSummary(date) {
    const vol = dayVolume(date), goal = dailyGoal(date), g = gradeOf(vol, goal);
    const plan = planMap[date] || [];
    const cardio = dayCardioVolume(date);
    return [fmtDate(date), plan.length ? plan.join('·') : '', fmtKg(vol), g ? g.label : '', cardio ? `(근력 ${fmtShort(vol - cardio) || 0} · 유산소 ${fmtShort(cardio)})` : ''].filter(Boolean).join(' · ');
  }
  async function openShare(date) {
    if (!store) { toast('공유는 공유 링크(claude.ai)에서 열었을 때 돼요'); return; }
    if (!myNick()) { toast('먼저 순위 탭에서 닉네임으로 참가해 주세요'); showView('rank'); return; }
    shareDate = date;
    $('#share-preview').textContent = shareSummary(date);
    $('#share-opt-log').checked = true;
    const hasPhoto = photos.has(date);
    $('#share-opt-photo-row').hidden = !hasPhoto;
    $('#share-opt-photo').checked = false;
    $('#share-text').value = '';
    $('#share-modal').hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeShare() { $('#share-modal').hidden = true; document.body.classList.remove('modal-open'); }
  $('#share-close').addEventListener('click', closeShare);
  $('#share-modal .rest-backdrop').addEventListener('click', closeShare);
  $('#share-send').addEventListener('click', async () => {
    const date = shareDate;
    const btn = $('#share-send');
    btn.disabled = true;
    try {
      const post = { to: '__feed', kind: 'share', date, summary: shareSummary(date), text: $('#share-text').value.trim().slice(0, 100), at: Date.now() };
      if ($('#share-opt-log').checked) {
        post.items = (db[date] || []).map((ex) => ({ n: ex.name, d: describeSets(ex) })).filter((x) => x.d).slice(0, 15);
      }
      if ($('#share-opt-photo').checked) {
        const img = await photos.get(date);
        if (img) post.img = img;
      }
      await store.collection(`comments/${myId}/items`).add(post);
      closeShare();
      toast('친구들에게 공유했어요 🎉');
      sharedMap[date] = true;
      renderDay();
    } catch (e) {
      toast(e && e.code === 'invalid_argument' ? '공유할 권한이 없거나 사진이 너무 커요' : '공유하지 못했어요');
    } finally { btn.disabled = false; }
  });
  const sharedMap = {};
  const wasShared = (date) => !!sharedMap[date] || (comments[myId] || []).some((c) => c.kind === 'share' && c.date === date);

  /** 오늘 운동한 친구 (나 제외), 볼륨 큰 순 */
  function activeToday() {
    const t = todayStr();
    return Object.entries(members)
      .filter(([id]) => id !== myId)
      .map(([id, m]) => ({ nick: m.nick, v: num((m.days || {})[t]) + num((m.cdays || {})[t]) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
  }

  return { init, publish, render, openShare, wasShared, activeToday, ready: () => ready };
})();

/* =========================================================
 * 밤 알림: 정한 시간(기본 23:00)에 오늘 운동 안 했으면 팝업
 * 앱이 열려 있으면 그 시각에, 아니면 그 시각 이후 처음 열 때
 * ========================================================= */
const nightly = (() => {
  const KEY = 'gymlog.nightly', SEEN = 'gymlog.nightlySeen';
  let cfg = { on: true, time: '23:00' };
  try { cfg = { ...cfg, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch {}
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };
  const seenToday = () => { try { return localStorage.getItem(SEEN) === todayStr(); } catch { return false; } };
  const markSeen = () => { try { localStorage.setItem(SEEN, todayStr()); } catch {} };

  /** 앱이 열려 있는 상태에서 알림 시각(~5분 이내)일 때만 */
  function due() {
    if (!cfg.on || seenToday() || document.hidden) return false;
    const [h, m] = cfg.time.split(':').map(Number);
    const now = new Date();
    const diff = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
    return diff >= 0 && diff < 5;
  }
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.3].forEach((dt) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 660; g.gain.setValueAtTime(0.0001, ctx.currentTime + dt);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dt + 0.25);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + dt); o.stop(ctx.currentTime + dt + 0.3);
      });
    } catch { /* 소리 불가 */ }
    try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
  }

  function show(preview = false) {
    const t = todayStr();
    const vol = dayVolume(t), done = vol > 0;
    let friends = [];
    try { friends = social.activeToday(); } catch {}
    $('#nightly-clock').textContent = cfg.time;
    $('#nightly-title').textContent = done ? `오늘 ${fmtKg(vol)} 완료` : '오늘 아직 운동 안 했어요';
    $('#nightly-status').classList.toggle('done', done);
    $('#nightly-sub').textContent = done ? '잘했어요. 내일도 이어가요.' : friends.length ? '친구들은 벌써 끝냈어요.' : '자기 전에 가볍게라도 기록해 볼까요?';
    $('#nightly-section').hidden = !friends.length;
    $('#nightly-count').textContent = `오늘 운동한 친구 (${friends.length})`;
    $('#nightly-friends').innerHTML = friends.slice(0, 5).map((f, i) => `
      <div class="nl-row ${i === 0 ? 'top' : ''}">
        <svg class="i"><use href="#i-body"/></svg>
        <span class="nl-name">${escapeHtml(f.nick)}</span>
        <span class="nl-val">${fmtKg(f.v)}</span>
      </div>`).join('') + (friends.length > 5 ? `<div class="nl-row more"><svg class="i"><use href="#i-list"/></svg><span class="nl-name">외 ${friends.length - 5}인</span></div>` : '');
    $('#nightly-go').querySelector('span').textContent = done ? '기록 보기' : '지금 기록하기';
    $('#nightly-modal').hidden = false;
    document.body.classList.add('modal-open');
    if (!preview) { markSeen(); chime(); }
  }
  function close() { $('#nightly-modal').hidden = true; document.body.classList.remove('modal-open'); }

  function check() {
    if (!due()) return;
    if (dayVolume(todayStr()) > 0) { markSeen(); return; }   // 이미 운동함 → 알림 생략
    if (!$('#nightly-modal').hidden || !$('#rest-timer').hidden) return;
    show();
  }

  // 설정 UI
  const onEl = $('#nightly-on'), timeEl = $('#nightly-time');
  onEl.checked = cfg.on; timeEl.value = cfg.time;
  onEl.addEventListener('change', () => { cfg.on = onEl.checked; saveCfg(); toast(cfg.on ? `매일 ${cfg.time}에 운동 체크할게요` : '밤 알림을 껐어요'); });
  timeEl.addEventListener('change', () => { if (/^\d{2}:\d{2}$/.test(timeEl.value)) { cfg.time = timeEl.value; saveCfg(); try { localStorage.removeItem(SEEN); } catch {} toast(`알림 시간 ${cfg.time}`); } });
  $('#nightly-test').addEventListener('click', () => show(true));
  $('#nightly-close').addEventListener('click', close);
  $('#nightly-modal .rest-backdrop').addEventListener('click', close);
  $('#nightly-go').addEventListener('click', () => { close(); state.day = todayStr(); showView('day'); });

  // 앱이 열려 있는 동안 20초마다 확인
  setInterval(check, 20000);
  return { show, check };
})();

cloud.init();
