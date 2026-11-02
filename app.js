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
const VIEW_DAY_KEY = 'gymlog.viewDay';
const state = {
  day: (() => {
    // 앱이 새로 고쳐져도(다른 앱 갔다 오기 등) 보던 날짜 유지 — 3시간 안이면
    try { const v = JSON.parse(localStorage.getItem(VIEW_DAY_KEY)); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.d) && Date.now() - v.at < 3 * 3600 * 1000) return v.d; } catch {}
    return todayStr();
  })(),
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
/* 운동 부위 직접 지정 { 운동 이름: 부위 } — 새로 등록한 운동 + 바꾼 부위 */
const PARTS_KEY = 'gymlog.parts';
let partMap = (() => { try { return JSON.parse(localStorage.getItem(PARTS_KEY) || '{}') || {}; } catch { return {}; } })();
function setPart(name, part) {
  partMap[name] = part;
  try { localStorage.setItem(PARTS_KEY, JSON.stringify(partMap)); } catch { /* 없음 */ }
}
let liveAt = (() => { try { return +localStorage.getItem('gymlog.liveAt') || 0; } catch { return 0; } })();
function save() {
  // 지금 운동 중 표시용: 오늘 기록을 고친 시각
  if (state.day === todayStr()) { liveAt = Date.now(); try { localStorage.setItem('gymlog.liveAt', String(liveAt)); } catch {} }
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
          if (body.game && window.athlete) window.athlete.restore(body.game);
          if (Array.isArray(body.routines)) routines.restore(body.routines);
          if (body.diet && window.diet) window.diet.restore(body.diet);
          if (body.parts && typeof body.parts === 'object') { partMap = { ...partMap, ...body.parts }; try { localStorage.setItem(PARTS_KEY, JSON.stringify(partMap)); } catch { /* 없음 */ } }
          syncedSettings = JSON.stringify({ restSeconds: body.restSeconds || 60, bodyweight: body.bodyweight || {}, goal: body.goal || 0, plan: body.plan || {}, closed: body.closed || {}, photoDates: body.photoDates || [], game: body.game || null, routines: body.routines || [], diet: body.diet || null, parts: body.parts || {} });
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
      const st = JSON.stringify({ restSeconds: restSeconds(), bodyweight: bwMap, goal: customGoal, plan: planMap, closed: closedMap, photoDates: photos.dates(), game: window.athlete ? window.athlete.state() : null, routines: routines.list(), diet: window.diet ? window.diet.state() : null, parts: partMap });
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
  if (info.perKm && km > 0) return info.perKm * bw * km * paceFactor(info, km, min);
  return Math.max(0, info.met - 1) * bw * (min / 60) * (info.timeScale ?? 1);
}
/** kcal → kg 볼륨 (종목 보정 포함) */
const cardioToVolume = (kcal, info) => kcal * CARDIO_KCAL_TO_VOLUME * (info.scale ?? 1) * CARDIO_NERF;
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
  if (isPenalty(ex)) return num(set.r) > 0 ? PENALTY_KG[ex.name] : 0;
  if (isGolf(ex)) {
    let v = num(set.r) * GOLF_KG_PER_STROKE;
    // 필드골프: 걷기 6km(18홀) 볼륨 추가 — 타수를 적은 판만
    if (isFieldGolf(ex) && num(set.r) > 0) v += cardioToVolume(cardioKcal({ km: FIELD_GOLF_KM * ((num(set.h) || 18) / 18) }, CARDIO['걷기'], bodyweightOn(date) || DEFAULT_BW), CARDIO['걷기']);
    return v;
  }
  const cinfo = cardioInfo(ex);
  if (cinfo) return cardioToVolume(cardioKcal(set, cinfo, bodyweightOn(date) || DEFAULT_BW, cardioMode(ex)), cinfo);
  const w = num(set.w), r = num(set.r);
  const type = bwType(ex);
  if (!type) return w * r;
  const bw = bodyweightOn(date);
  if (type === 'assist') return Math.max(0, bw - w) * r;
  const k = (typeof BW_SCALE !== 'undefined' && BW_SCALE[ex.name]) || 1;
  return (bw + w) * r * k;
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
  if (el.classList.contains('iv-in')) { setTimeout(() => el.select(), 0); setTimeout(() => el.select(), 60); return; }   // 인터벌 칸: 눌러서 바로 덮어쓰기
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

const PERIODS = ['day', 'week', 'month'];
let curView = 'day', lastPeriod = 'day';
document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => showView(btn.dataset.view === 'workout' ? lastPeriod : btn.dataset.view))
);
// Today ‹ › Weekly ‹ › Monthly 순환
const RANK_PAGES = ['board', 'kings'];
const RANK_TITLES = { board: 'Ranking', kings: 'Kings', photos: 'Body Feed' };
function shiftPeriod(step) {
  if (curView === 'rank') {
    const j = RANK_PAGES.indexOf(social.mode());
    social.setMode(RANK_PAGES[(j + step + RANK_PAGES.length) % RANK_PAGES.length]);
    return;
  }
  const i = PERIODS.indexOf(curView);
  showView(PERIODS[(i + step + PERIODS.length) % PERIODS.length]);
}
$('#period-prev').addEventListener('click', () => shiftPeriod(-1));
$('#period-next').addEventListener('click', () => shiftPeriod(1));
$('#settings-btn').addEventListener('click', () => showView(curView === 'settings' ? lastPeriod : 'settings'));
function showView(view) {
  curView = view;
  const periodic = PERIODS.includes(view);
  if (periodic) lastPeriod = view;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === (periodic ? 'workout' : view)));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('#page-title').textContent = view === 'rank' ? RANK_TITLES[social.mode()] : PAGE_TITLES[view];
  document.querySelector('.app-header').classList.toggle('periodic', periodic || view === 'rank');
  $('#settings-btn').classList.toggle('active', view === 'settings');
  window.scrollTo({ top: 0 });
  render();
}
const PAGE_TITLES = { chat: 'Talk', day: 'Today', week: 'Weekly', month: 'Monthly', rank: 'Ranking', settings: 'Settings', career: 'Athlete', feed: 'Feed' };
function updateHeader() {
  const d = new Date();
  $('#header-sub').textContent = `${d.getMonth() + 1}.${d.getDate()} ${'일월화수목금토'[d.getDay()]}`;
  $('#day-dot').classList.toggle('on', dayVolume(todayStr()) > 0 || (db[todayStr()] || []).length > 0);
}
function currentView() {
  return curView;
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
$('#past-today').addEventListener('click', () => { state.day = todayStr(); renderDay(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
/* 이 날 기록 통째로 다른 날짜로 옮기기 (날짜 잘못 기록했을 때) */
$('#move-day-btn').addEventListener('click', () => {
  const inp = $('#move-day-date');
  inp.value = addDays(state.day, -1);
  if (typeof inp.showPicker === 'function') { try { inp.showPicker(); return; } catch {} }
  inp.focus(); inp.click();
});
$('#move-day-date').addEventListener('change', async (e) => {
  const to = e.target.value, from = state.day;
  if (!to || to === from) return;
  const list = db[from] || [];
  if (!list.length) return;
  const label = (d) => `${parse(d).getMonth() + 1}월 ${parse(d).getDate()}일`;
  const has = (db[to] || []).length;
  if (!(await askConfirm(`${label(from)} 운동 ${list.length}개를\n${label(to)}로 옮길까요?${has ? `\n(${label(to)}에 있던 기록 뒤에 붙어요)` : ''}`, { okText: '옮기기' }))) return;
  db[to] = [...(db[to] || []), ...list];
  delete db[from];
  if (planMap[from]) { planMap[to] = [...new Set([...(planMap[to] || []), ...planMap[from]])]; delete planMap[from]; savePlanClosed(); }
  save();
  state.day = to;
  renderDay();
  toast(`${label(to)}로 옮겼어요`);
});

/** 운동 하나를 기본 세트(지난번 기록 → 없으면 fallback)로 만들기 */
/** 🙏 기도 스쿼트를 오늘 운동에 기록 (맨몸 스쿼트 한 세트) */
function addPrayerSquats(n) {
  const d = todayStr();
  if (isClosed(d) || !(n > 0)) return false;
  db[d] = db[d] || [];
  let ex = db[d].find((e) => e.name === '맨몸 스쿼트' && e.pray);
  if (!ex) { ex = { id: uid(), name: '맨몸 스쿼트', sets: [], pray: true }; db[d].push(ex); }
  ex.sets.push({ w: '', r: n });
  save();
  if (state.day === d) renderDay();
  return true;
}
function makeEntry(name, fallbackSets) {
  const last = findLastExercise(name, state.day);
  const isCardio = !!(typeof CARDIO !== 'undefined' && CARDIO[name]);
  const base = last ? last.sets : fallbackSets && fallbackSets.length ? fallbackSets : [isCardio ? { km: '', min: '' } : (name === '스크린골프' || name === '필드골프') ? { h: 18, r: '' } : { w: '', r: '' }];
  const sets = (name === '스크린골프' || name === '필드골프') ? [{ h: num(base[0] && base[0].h) || 18, r: '' }] : base.map((s) => ({ ...s }));
  const entry = { id: uid(), name, sets };
  if (last && last.bw !== undefined) entry.bw = last.bw;
  else if (!isCardio && !EXERCISES.some((e) => e.name === name)) {
    const fc = friendCustoms.find((f) => f.name === name);
    if (fc && fc.bw) entry.bw = 'bw';
  }
  if (!isCardio && last && last.cardio) { entry.cardio = last.cardio; entry.mode = last.mode || 'calc'; }
  if (isCardio && CARDIO[name].goals) entry.detail = true;
  if (isCardio) entry.mode = CARDIO[name].kcalOnly ? 'watch' : last && last.mode ? last.mode : CARDIO[name].hyrox ? 'calc' : preferredCardioMode();
  // 하이록스: 공식 코스(러닝 8km)를 미리 채움 — 완주 시간만 적으면 끝
  if (isCardio && CARDIO[name].hyrox) entry.sets.forEach((st) => { if (!num(st.km)) st.km = 8; });
  return entry;
}
function addExercise(name) {
  name = name.trim();
  if (!name) return;
  if (isClosed(state.day)) { toast('마감된 날이에요. 다시 열기를 눌러주세요'); return; }
  // 마지막으로 했던 같은 운동의 세트를 기본값으로 불러오기
  (db[state.day] ||= []).push(makeEntry(name));
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
  if (partMap[name]) return partMap[name];
  return EXERCISES.find((e) => e.name === name)?.part || friendCustoms.find((f) => f.name === name)?.p || '내 운동';
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
    .map((n) => ({ part: partMap[n] || '내 운동', name: n, en: '', alias: [], custom: true }));
  const friends = friendCustoms
    .filter((f) => !usage[f.name] && !EXERCISES.some((e) => e.name === f.name))
    .map((f) => ({ part: f.p || '친구 운동', name: f.name, en: `${f.by} 님이 추가${f.bw ? ' · 맨몸' : ''}`, alias: [], custom: true, friend: true }));
  let pool = [...EXERCISES.map((e) => (partMap[e.name] && partMap[e.name] !== e.part ? { ...e, part: partMap[e.name] } : e)), ...custom, ...friends];

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
      <span class="result-main"><span class="result-name">"${escapeHtml(q)}" 새 운동으로 등록</span>
      <span class="result-sub">부위랑 기록 방식을 골라서 등록해요</span></span></button>`;
  }

  resultsEl.innerHTML = html;
  resultsEl.hidden = false;
  resultsEl.querySelectorAll('.result-item').forEach((b) =>
    b.addEventListener('click', () => (b.classList.contains('custom-add') ? registerExercise(b.dataset.name) : pickExercise(b.dataset.name)))
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
  const fc = friendCustoms.find((f) => f.name === name);
  if (fc && fc.p && !partMap[name] && !EXERCISES.some((e) => e.name === name)) setPart(name, fc.p);
  searchInput.value = '';
  picker.open = false;
  updateToggle();
  resultsEl.hidden = true;
  searchInput.blur();
  addExercise(name);
}

/* ---------- 새 운동 등록 · 부위 바꾸기 ---------- */
const partSheet = { name: '', ex: null, part: '', ty: 'w' };
function exType(ex) { return ex && ex.cardio && !CARDIO[ex.name] ? 'c' : bwType(ex) === 'bw' ? 'bw' : 'w'; }
function openPartSheet(name, ex) {
  const isNew = !ex;
  const isCatalog = EXERCISES.some((e) => e.name === name);
  Object.assign(partSheet, { name, ex, part: isNew ? (EXERCISE_PARTS.includes(picker.part) ? picker.part : '') : partOf(name), ty: isNew ? 'w' : exType(ex) });
  $('#part-title').textContent = isNew ? `"${name}" 새 운동 등록` : `${name}`;
  $('#part-ok').textContent = isNew ? '등록하기' : '바꾸기';
  $('#part-types-wrap').hidden = isCatalog;
  const draw = () => {
    $('#part-grid').innerHTML = EXERCISE_PARTS.map((p) => `<button type="button" data-p="${p}" class="${p === partSheet.part ? 'on' : ''}">${p}</button>`).join('');
    $('#part-types').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ty === partSheet.ty));
  };
  partSheet.draw = draw;
  draw();
  $('#part-modal').hidden = false;
  document.body.classList.add('modal-open');
}
function closePartSheet() { $('#part-modal').hidden = true; document.body.classList.remove('modal-open'); }
function registerExercise(name) {
  name = name.trim().slice(0, 40);
  if (!name) return;
  searchInput.value = ''; picker.open = false; updateToggle(); resultsEl.hidden = true; searchInput.blur();
  openPartSheet(name, null);
}
/** 기록 방식 적용 (w 무게 · bw 맨몸 · c 시간·거리) */
function applyType(entry, ty, part) {
  const was = !!entry.cardio;
  if (ty === 'c') {
    entry.cardio = { met: part === '스포츠' ? 7 : 6 }; entry.mode = 'calc'; delete entry.bw;
    if (!was) entry.sets = [{ km: '', min: '' }];
  } else {
    delete entry.cardio; delete entry.mode;
    entry.bw = ty === 'bw' ? 'bw' : null;
    if (was) entry.sets = [{ w: '', r: '' }];
  }
}
$('#part-grid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]'); if (!b) return;
  partSheet.part = b.dataset.p;
  if (!EXERCISES.some((x) => x.name === partSheet.name)) {
    if (partSheet.part === '유산소' || partSheet.part === '스포츠') partSheet.ty = 'c';
    else if (partSheet.ty === 'c') partSheet.ty = 'w';
  }
  partSheet.draw();
});
$('#part-types').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ty]'); if (!b) return;
  partSheet.ty = b.dataset.ty; partSheet.draw();
});
$('#part-cancel').addEventListener('click', closePartSheet);
$('#part-modal .rest-backdrop').addEventListener('click', closePartSheet);
$('#part-ok').addEventListener('click', () => {
  const { name, ex, part, ty } = partSheet;
  if (!part) { toast('어디 운동인지 골라주세요'); return; }
  const isCatalog = EXERCISES.some((e) => e.name === name);
  setPart(name, part);
  closePartSheet();
  if (!ex) {
    if (isClosed(state.day)) { toast('마감된 날이에요. 다시 열기를 눌러주세요'); return; }
    addExercise(name);
    const list = db[state.day] || [];
    const entry = list[list.length - 1];
    if (entry && entry.name === name && !isCatalog) applyType(entry, ty, part);
    toast(`✅ "${name}" ${part} 운동으로 등록했어요`);
  } else {
    if (!isCatalog && exType(ex) !== ty) applyType(ex, ty, part);
    toast(`${name} → ${part} 운동으로 바꿨어요`);
  }
  save();
  renderDay();
});

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

  function shrink(file, max = 900, limit = 220000) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        let q = 0.78, out = cv.toDataURL('image/jpeg', q);
        while (out.length > limit && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 읽을 수 없어요')); };
      img.src = url;
    });
  }

  let photoOpen = false; // 평소엔 접어두기
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
      <details class="share-fold photo-fold" ${photoOpen ? 'open' : ''}><summary><span>사진 보기${prev ? ' · 지난 사진과 비교' : ''}</span><svg class="i"><use href="#i-right"/></svg></summary>
      <div class="photo-grid ${prev ? 'two' : ''}">
        ${prev ? `<figure><img src="${prev}" alt="" data-full="1" /><figcaption>${escapeHtml(fmtDate(prevDate))}</figcaption></figure>` : ''}
        <figure><img src="${img}" alt="" data-full="1" /><figcaption>${escapeHtml(fmtDate(date))}${prev ? ' · 오늘' : ''}</figcaption></figure>
      </div>
      <div class="photo-actions">
        <button type="button" id="photo-change">사진 바꾸기</button>
        <button type="button" id="photo-del" class="danger-text">삭제</button>
      </div></details>`;
    body.querySelector('.photo-fold').addEventListener('toggle', (e) => { photoOpen = e.target.open; });
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

  return { attach, mergeDates, dates, render, get, shrink, has: (d) => dateSet.has(d) };
})();

function renderDay() {
  try { routines.renderNudge(); } catch {}
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
    const pb = node.querySelector('.part-badge');
    pb.textContent = partOf(ex.name);
    if (!isPenalty(ex) && !isGolf(ex)) {
      pb.classList.add('editable');
      pb.title = '눌러서 부위 바꾸기';
      pb.addEventListener('click', () => openPartSheet(ex.name, ex));
    }
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
      if (['러닝', '트레드밀', '인터벌 러닝'].includes(ex.name) && cardioMode(ex) !== 'watch') {
        // ⚡ 인터벌 · 속도로 적기 — 러닝머신 속도(km/h)와 분만 알면 km·시간 자동
        let iv = { rs: 10, rm: 1, ws: 5, wm: 1, n: 8 };
        try { iv = { ...iv, ...JSON.parse(localStorage.getItem('gymlog.interval') || '{}') }; } catch { /* 없음 */ }
        const box = document.createElement('details');
        box.className = 'iv-box';
        if (ex.ivOpen) box.open = true;
        const f = (k, ph, step) => `<input class="iv-in" data-iv="${k}" type="text" inputmode="decimal" value="${iv[k]}" placeholder="${ph}" data-step="${step}">`;
        box.innerHTML = `<summary>⚡ 인터벌 · 속도로 적기 <small>km 몰라도 OK</small></summary>
          <div class="iv-grid">
            <span class="iv-l">🏃 뛰기</span>${f('rs', '속도', 0.5)}<span class="iv-u">km/h</span>${f('rm', '분', 0.5)}<span class="iv-u">분</span>
            <span class="iv-l">🚶 쉬기</span>${f('ws', '속도', 0.5)}<span class="iv-u">km/h</span>${f('wm', '분', 0.5)}<span class="iv-u">분</span>
            <span class="iv-l">🔁 반복</span>${f('n', '회', 1)}<span class="iv-u">회</span><span></span><span></span>
          </div>
          <p class="iv-sum"></p>
          <button type="button" class="iv-apply">기록에 넣기</button>
          <p class="iv-tip">쉬지 않고 쭉 뛰었으면 쉬기 0분, 반복 1회 · 쉬는 동안 멈춰 섰으면 속도 0</p>`;
        const calc = () => {
          const g = (k) => Math.max(0, num(box.querySelector(`[data-iv="${k}"]`).value));
          const v = { rs: g('rs'), rm: g('rm'), ws: g('ws'), wm: g('wm'), n: Math.max(1, Math.round(g('n')) || 1) };
          const min = (v.rm + v.wm) * v.n;
          const km = ((v.rs * v.rm + v.ws * v.wm) * v.n) / 60;
          return { v, min: Math.round(min * 10) / 10, km: Math.round(km * 100) / 100 };
        };
        const show = () => {
          const c = calc();
          box.querySelector('.iv-sum').innerHTML = c.min > 0 ? `총 <b>${c.min}분 · ${c.km}km</b>${c.km > 0 ? ` · ${paceText(ex.name, c.km, c.min) || ''}` : ''}` : '속도와 분을 적어주세요';
        };
        box.addEventListener('toggle', () => { ex.ivOpen = box.open; });
        box.querySelectorAll('.iv-in').forEach((i) => i.addEventListener('input', show));
        box.querySelector('.iv-apply').addEventListener('click', () => {
          const c = calc();
          if (!(c.min > 0 && c.km > 0)) { toast('뛴 속도와 시간을 적어주세요'); return; }
          try { localStorage.setItem('gymlog.interval', JSON.stringify(c.v)); } catch { /* 없음 */ }
          const v = c.v;
          const tag = v.wm > 0 && v.n > 1 ? `인터벌 ${v.rs}km/h ${v.rm}분 + ${v.ws}km/h ${v.wm}분 × ${v.n}` : `${v.rs}km/h × ${v.rm * v.n}분`;
          const last = ex.sets[ex.sets.length - 1];
          const empty = last && !num(last.km) && !num(last.min);
          const set = { km: c.km, min: c.min, iv: tag };
          if (empty) Object.assign(last, set); else ex.sets.push(set);
          ex.ivOpen = false;
          save(); renderDay();
          toast(`⚡ ${c.km}km · ${c.min}분 기록했어요`);
        });
        show();
        toggle.after(box);
      }
      if (cinfo.hyrox) {
        const g = document.createElement('details');
        g.className = 'hyrox-guide';
        g.innerHTML = `<summary>🏁 하이록스 코스 — <b>완주 시간(분)</b>만 적으면 자동 계산</summary><ol>${HYROX_STATIONS.map((st) => `<li><span>🏃 1km</span> → ${st}</li>`).join('')}</ol><p>러닝 8km + 스테이션 8개 · 시간 × 운동 강도로 칼로리·볼륨 계산 · 반만 했으면 km·시간을 그만큼만</p>`;
        toggle.after(g);
      }
      node.querySelector('.rest-btn').hidden = true;
      node.querySelector('.add-set').lastChild.textContent = '기록 추가';
      const db2 = document.createElement('button');
      db2.type = 'button';
      db2.className = 'detail-btn' + (ex.detail ? ' on' : '');
      db2.textContent = ex.detail ? '상세 닫기' : cinfo.goals ? '골·심박·메모' : '페이스·심박·메모';
      db2.addEventListener('click', () => { ex.detail = !ex.detail; save(); renderDay(); });
      node.querySelector('.card-actions').appendChild(db2);
      node.classList.add('cardio');
    } else if (isGolf(ex)) {
      chip.hidden = false; chip.disabled = true; chip.classList.add('on');
      chip.textContent = isFieldGolf(ex) ? `⛳ 1타=${GOLF_KG_PER_STROKE}kg + 걷기 ${FIELD_GOLF_KM}km` : `⛳ 1타=${GOLF_KG_PER_STROKE}kg · 적을수록 왕`;
      const th = node.querySelectorAll('thead th');
      th[0].textContent = '판'; th[1].textContent = '홀'; th[2].textContent = '타수';
      node.classList.add('golf');
    } else if (isPenalty(ex)) {
      chip.hidden = false; chip.disabled = true; chip.classList.add('on');
      chip.textContent = `🫣 세트당 ${PENALTY_KG[ex.name]}kg`;
      const th = node.querySelectorAll('thead th');
      th[1].textContent = '분'; th[2].textContent = '횟수';
    } else if (type || !isCatalog) {
      chip.hidden = false;
      const bw = bodyweightOn(state.day);
      chip.classList.toggle('on', !!type);
      const nerf = type === 'bw' && typeof BW_SCALE !== 'undefined' && BW_SCALE[ex.name] ? ` · 볼륨 ×${Math.round(BW_SCALE[ex.name] * 100)}%` : '';
      chip.textContent = (!type ? '🏋️ 무게 운동' : bw ? `맨몸 +${bw}kg` : '맨몸 · 몸무게 미입력') + nerf;
      chip.title = isCatalog ? '' : '눌러서 무게 ↔ 맨몸 바꾸기';
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
        const pf = cardioMode(ex) === 'watch' ? 1 : paceFactor(cinfo, km, min);
        if (pf !== 1) parts.push(`${pf > 1 ? '🔥 페이스 보너스' : '🐢 페이스'} ×${pf.toFixed(2)}`);
        const hr = avgHr(ex.sets);
        if (hr) parts.push(`♥ ${hr}bpm`);
        const goals = ex.sets.reduce((a, x) => a + num(x.goals), 0);
        if (cinfo.goals && goals) parts.unshift(`⚽ ${goals}골`);
        const head = parts.length ? parts.join(' · ') : cardioMode(ex) === 'watch' ? '워치에 찍힌 활동 칼로리를 입력하세요' : (cinfo.perKm ? '거리(km)와 시간(분)을 입력하세요' : '운동한 시간(분)을 입력하세요');
        cardioMeta.innerHTML = `<div>${escapeHtml(head)}</div>` + (kcal
          ? `<div class="conv"><span class="conv-pill">${cardioMode(ex) === 'watch' ? '⌚ ' : ''}${Math.round(kcal).toLocaleString('ko-KR')} kcal</span><span class="conv-op">× ${CARDIO_KCAL_TO_VOLUME} × ${Math.round((cinfo.scale ?? 1) * CARDIO_NERF * 100)}%</span><span class="conv-arrow">→</span><span class="conv-pill dark">${fmtKg(cardioToVolume(kcal, cinfo))}</span></div>`
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
 : isPenalty(ex)
        ? `<td><input type="text" autocomplete="off" inputmode="numeric" value="${set.min ?? ''}" data-k="min" placeholder="-" /></td>
        <td><input type="text" autocomplete="off" inputmode="numeric" value="${set.r ?? ''}" data-k="r" placeholder="회" /></td>`
        : isGolf(ex)
        ? `<td><input type="text" autocomplete="off" inputmode="numeric" value="${set.h ?? 18}" data-k="h" placeholder="18" /></td>
        <td><input type="text" autocomplete="off" inputmode="numeric" value="${set.r ?? ''}" data-k="r" placeholder="타" /></td>`
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

    const strength = !cinfo && !isGolf(ex) && !isPenalty(ex);
    const group = ex.ss ? list.filter((e) => e.ss === ex.ss) : [ex];
    const copyLast = (e) => { const prev = e.sets[e.sets.length - 1]; e.sets.push(isGolf(e) ? { h: num(prev && prev.h) || 18, r: '' } : isPenalty(e) ? { min: '', r: '' } : prev ? { ...prev } : cardioInfo(e) ? { km: '', min: '' } : { w: '', r: '' }); };
    node.querySelector('.add-set').addEventListener('click', () => {
      group.forEach(copyLast);   // 슈퍼세트면 묶인 운동 모두 한 세트씩
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
      if (group.length > 1) {   // 🔗 슈퍼세트: 묶음의 마지막 운동을 끝냈을 때만 휴식
        const at = group.indexOf(ex);
        if (at < group.length - 1) {
          const nx = group[at + 1];
          const card = container.querySelectorAll('.exercise-card')[list.indexOf(nx)];
          const round = Math.max(1, Math.min(nx.sets.length, ex.sets.filter((x) => num(x.r) > 0).length));
          toast(`🔗 바로 이어서 ${nx.name} ${round}세트`);
          card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const row = card?.querySelectorAll('tbody tr')[round - 1];
          setTimeout(() => row?.querySelector('input[data-k=r]')?.focus({ preventScroll: true }), 350);
          return;
        }
        const round = Math.min(...group.map((e) => e.sets.filter((x) => num(x.r) > 0).length));
        restTimer.start(`🔗 슈퍼세트 ${round}라운드 완료 · 휴식 중`);
        return;
      }
      const done = ex.sets.filter((s) => num(s.r) > 0).length;
      restTimer.start(`${ex.name} ${done}세트 기록 완료 · 휴식 중`);
    });

    if (strength && ex.sets.length) {
      // ⚡ 빠른 입력: 세트 복사 · 무게 일괄 조정
      const tools = document.createElement('div');
      tools.className = 'set-tools';
      tools.innerHTML = `<span>전체 kg</span>
        <button type="button" data-w="-2.5">−2.5</button><button type="button" data-w="2.5">+2.5</button><button type="button" data-w="5">+5</button>
        <button type="button" data-ramp="2.5" title="첫 세트부터 세트마다 +2.5kg">↗ 계단</button>
        <button type="button" data-copy="3" title="마지막 세트를 3개 더 복사">⧉ +3세트</button>`;
      tools.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
        const d = +b.dataset.w;
        ex.sets.forEach((x) => { if (x.w !== '' && x.w !== undefined || d > 0) x.w = Math.max(0, Math.round((num(x.w) + d) * 100) / 100); });
        save(); renderDay();
        toast(`${ex.name} 전체 ${d > 0 ? '+' : ''}${d}kg`);
      }));
      tools.querySelector('[data-ramp]').addEventListener('click', () => {
        const base = num(ex.sets[0].w), st = +tools.querySelector('[data-ramp]').dataset.ramp;
        ex.sets.forEach((x, i) => { x.w = Math.round((base + st * i) * 100) / 100; });
        save(); renderDay();
        toast(`세트마다 +${st}kg (${base} → ${base + st * (ex.sets.length - 1)}kg)`);
      });
      tools.querySelector('[data-copy]').addEventListener('click', () => {
        for (let k = 0; k < 3; k++) group.forEach(copyLast);
        save(); renderDay();
        toast(group.length > 1 ? '슈퍼세트 3라운드 추가' : '마지막 세트를 3개 복사했어요');
      });
      node.querySelector('.card-actions').before(tools);

      // 🔗 슈퍼세트 묶기 / 풀기
      const ssBtn = document.createElement('button');
      ssBtn.type = 'button'; ssBtn.className = 'ss-btn' + (ex.ss ? ' on' : '');
      ssBtn.textContent = ex.ss ? '🔗 풀기' : '🔗 슈퍼세트';
      ssBtn.addEventListener('click', () => {
        if (ex.ss) {
          const rest = list.filter((e) => e.ss === ex.ss && e !== ex);
          delete ex.ss;
          if (rest.length === 1) delete rest[0].ss;
          save(); renderDay(); return;
        }
        const others = list.filter((e) => e !== ex && !cardioInfo(e) && !isGolf(e) && !isPenalty(e));
        if (!others.length) { toast('같이 묶을 운동을 먼저 추가하세요'); return; }
        let pick = node.querySelector('.ss-pick');
        if (pick) { pick.remove(); return; }
        pick = document.createElement('div');
        pick.className = 'ss-pick';
        pick.innerHTML = '<small>누구랑 묶을까요? (번갈아 하는 운동)</small>' + others.map((e) => `<button type="button" data-i="${list.indexOf(e)}">${escapeHtml(e.name)}</button>`).join('');
        pick.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          const other = list[+b.dataset.i];
          const joinOther = !!other.ss && !ex.ss;
          const id = other.ss || ex.ss || uid();
          // 묶음은 붙어 있게: 상대(또는 나)를 묶음 마지막 바로 뒤로 이동
          const mover = joinOther ? ex : other;
          if (!joinOther) ex.ss = id;
          list.splice(list.indexOf(mover), 1);
          const lastIdx = list.reduce((m, e, i) => (e.ss === id ? i : m), -1);
          mover.ss = id;
          list.splice(lastIdx + 1, 0, mover);
          // 세트 수 맞추기 (모자란 쪽은 마지막 세트 복사)
          const mates = list.filter((e) => e.ss === id), n = Math.max(...mates.map((e) => e.sets.length));
          mates.forEach((e) => { while (e.sets.length < n) copyLast(e); });
          save(); renderDay();
          toast(`🔗 ${mates.map((e) => e.name).join(' + ')} 슈퍼세트`);
        }));
        node.querySelector('.card-actions').after(pick);
      });
      tools.appendChild(ssBtn);
    }
    if (ex.ss && group.length > 1) {
      const groups = [...new Set(list.filter((e) => e.ss).map((e) => e.ss))].filter((g) => list.filter((e) => e.ss === g).length > 1);
      const letter = String.fromCharCode(65 + Math.max(0, groups.indexOf(ex.ss)));
      const at = group.indexOf(ex);
      node.classList.add('ss', `ss-${groups.indexOf(ex.ss) % 4}`);
      if (at > 0) node.classList.add('ss-cont');
      if (at < group.length - 1) node.classList.add('ss-more');
      const tag = document.createElement('span');
      tag.className = 'ss-tag'; tag.textContent = `🔗 ${letter}${at + 1}`;
      node.querySelector('.exercise-meta').prepend(tag);
      node.querySelector('.rest-btn').lastChild.textContent = at < group.length - 1 ? `기록 → ${group[at + 1].name}` : '기록하고 라운드 휴식';
    }

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
  const plan = planOf(date);
  if (plan.length) return plan.reduce((a, p) => a + partTarget(p, date), 0);
  return Math.ceil(((bodyweightOn(date) || 75) * 110) / 500) * 500;
}
/* ---------- 부위별 목표 (30대 남성 중급자 기준, 몸무게 배수) ---------- */
const PART_FACTOR = { '유산소': 60, '하체': 110, '등': 75, '가슴': 60, '전신': 75, '어깨': 40, '복근': 30, '삼두': 22, '이두': 18, '전완': 8 };
const PLAN_PARTS = ['가슴', '등', '어깨', '하체', '이두', '삼두', '전완', '복근', '전신', '유산소'];
function partTarget(part, date) {
  return Math.ceil(((bodyweightOn(date) || 75) * (PART_FACTOR[part] || 30)) / 100) * 100;
}
/** 기록한 운동에서 자동으로 잡히는 부위 (운동 종목 → 부위 자동 매칭) */
function autoParts(date) {
  const set = new Set();
  for (const ex of db[date] || []) {
    const p = cardioInfo(ex) ? '유산소' : partOf(ex.name);
    if (PLAN_PARTS.includes(p)) set.add(p);
  }
  return set;
}
/** 오늘 부위 = 직접 고른 부위 + 기록한 운동의 부위 */
function planOf(date) {
  const set = new Set([...(planMap[date] || []), ...autoParts(date)]);
  return PLAN_PARTS.filter((p) => set.has(p));
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
  const plan = planOf(date), auto = autoParts(date);
  const vols = partVolumes(date);
  $('#plan-chips').innerHTML = PLAN_PARTS.map((p) => `<button type="button" class="chip ${plan.includes(p) ? 'active' : ''} ${auto.has(p) ? 'auto' : ''}" data-p="${p}" ${closed ? 'disabled' : ''}>${p}</button>`).join('');
  $('#plan-chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    if (auto.has(b.dataset.p)) { toast(`${b.dataset.p} 운동을 기록해서 자동으로 체크됐어요`); return; }
    const cur = new Set(planMap[date] || []);
    cur.has(b.dataset.p) ? cur.delete(b.dataset.p) : cur.add(b.dataset.p);
    if (cur.size) planMap[date] = PLAN_PARTS.filter((p) => cur.has(p)); else delete planMap[date];
    savePlanClosed();
    renderPlan();
    updateDaySummary();
  }));
  $('#plan-hint').textContent = plan.length ? `목표 합계 ${fmtKg(plan.reduce((a, p) => a + partTarget(p, date), 0))}` : '운동을 기록하면 자동으로 체크돼요';
  const extra = Object.keys(vols).filter((p) => !plan.includes(p) && vols[p] > 0);
  $('#plan-rows').innerHTML = plan.map((p) => {
    const v = vols[p] || 0, t = partTarget(p, date), g = gradeOf(v, t);
    return `<div class="plan-row">
      <div class="plan-top"><b>${p}</b><span>${g ? g.label.split(' ')[0] : ''} ${fmtKg(v)} <small>/ ${fmtKg(t)}</small></span></div>
      <div class="plan-bar ${v >= t ? 'done' : ''}"><div style="width:${Math.min(100, (v / t) * 100)}%"></div></div>
    </div>`;
  }).join('') + (extra.length ? `<p class="plan-extra">계획 외: ${extra.map((p) => `${escapeHtml(p)} ${fmtKg(vols[p])}`).join(' · ')}</p>` : '');
}
/* ---------- 오늘의 칭호 (매일 랜덤, 그날 가장 많이 한 부위 기준) ---------- */
const TITLES = {
  '가슴': ['가슴 학살자', '대흉근 건축가', '벤치 위의 지배자', '강철 갑옷 가슴', '가슴으로 문 여는 자', '푸시의 신', '흉근 폭격기'],
  '등': ['광배 날개 장착', '등짝 조각가', '풀업 머신', '데드리프트 수도승', '날다람쥐 광배', '등으로 말하는 남자', '견갑 마스터'],
  '하체': ['크레인 허벅지', '스쿼트 지옥 생존자', '하체 폭격기', '계단이 무서운 자', '말벅지 제조기', '레그데이 탈주 실패', '대퇴사두 장군'],
  '어깨': ['대포알 어깨', '삼각근 조각가', '어깨 깡패', '옷걸이 어깨', '문 옆으로 지나가는 자', '프레스 장인'],
  '이두': ['알통 장인', '이두 폭발', '컬 중독자', '팔뚝 펌프왕', '반팔 찢는 자'],
  '삼두': ['말굽 삼두', '삼두 저격수', '팔 뒤태 장인', '딥스 중독자', '삼두 망치'],
  '전완': ['악력 괴물', '뽀빠이 팔뚝', '병뚜껑 파괴자', '그립의 신'],
  '복근': ['초콜릿 공장장', '복근 장인', '코어 철벽', '식스팩 예약자', '플랭크 석상'],
  '전신': ['전신 불도저', '인간 엔진', '올라운더', '쇳덩이 수집가', '헬스장 지박령'],
  '유산소': ['심폐 괴물', '폐활량 무한', '땀샘 폭발', '러닝머신 지배자', '지칠 줄 모르는 자', '심박수 사냥꾼'],
  '축구': ['그라운드의 지배자', '동네 메시', '풋살장 폭주기관차', '무릎은 소중해', '골문 앞 해결사', '아저씨 손흥민'],
  '휴식': ['소파 수호자', '오늘은 충전 중', '근손실 걱정러', '휴식도 운동이다', '내일의 전설'],
};
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** items: [{n: 운동명, v: 볼륨, c: 유산소면 1}] → 칭호 문자열 */
function titleFor(seed, date, items) {
  const by = {};
  for (const x of items || []) {
    if (!x || !(num(x.v) > 0)) continue;
    let p = x.c ? '유산소' : partOf(x.n);
    if (x.c && /풋살|축구/.test(String(x.n))) p = '축구';
    if (!TITLES[p] || p === '휴식') p = '전신';
    by[p] = (by[p] || 0) + num(x.v);
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const pool = TITLES[top ? top[0] : '휴식'];
  return pool[hashStr(`${seed}|${date}|${top ? top[0] : ''}`) % pool.length];
}
function myTitle(date) {
  const items = (db[date] || []).map((ex) => ({ n: ex.name, v: exerciseVolume(ex, date), c: cardioInfo(ex) ? 1 : 0 }));
  let seed = 'me';
  try { seed = social.id() || 'me'; } catch {}
  return titleFor(seed, date, items);
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
  const tEl = $('#day-title');
  if (tEl) { const has = total > 0; tEl.hidden = !has; if (has) tEl.innerHTML = `<span>오늘의 칭호</span><b>${escapeHtml(myTitle(state.day))}</b>`; }
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
  try { localStorage.setItem(VIEW_DAY_KEY, JSON.stringify({ d: state.day, at: Date.now() })); } catch {}
  // 오늘이 아닌 날을 보고 있으면 확실히 보이게
  const diff = Math.round((parse(todayStr()) - parse(state.day)) / 86400000);
  const isToday = diff === 0;
  $('#past-banner').hidden = isToday;
  $('#past-banner').classList.toggle('future', diff < 0);
  $('#past-text').textContent = diff === 1 ? '📅 어제 기록을 보고 있어요' : diff > 1 ? `📅 ${diff}일 전 기록을 보고 있어요` : diff === -1 ? '📅 내일 날짜예요' : `📅 ${-diff}일 뒤 날짜예요`;
  $('#day-list-label').textContent = isToday ? '오늘의 운동' : `${parse(state.day).getMonth() + 1}/${parse(state.day).getDate()} 운동`;
  $('#day-sum-label').textContent = isToday ? '오늘 총 볼륨' : `${parse(state.day).getMonth() + 1}/${parse(state.day).getDate()} 총 볼륨`;
  $('#move-day-btn').hidden = !(db[state.day] || []).length || isClosed(state.day);
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
  else if (v === 'career' && window.athlete) window.athlete.render();
  else if (v === 'feed') social.renderFeed();
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
  const openFolds = new Set(); // 피드에서 펼쳐둔 운동 상세
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
        map.set(name, { name, bw: !!it.bw, p: EXERCISE_PARTS.includes(it.p) ? it.p : '', by: (members[uid] && members[uid].nick) || '친구' });
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
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([n, bw]) => ({ n, ...(bw ? { bw } : {}), ...(partMap[n] ? { p: partMap[n] } : {}) }));
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
    checkWelcome();
    checkIncoming();
    checkCongrats();
    checkMemoPop();
    cleanOldMeals();
    cleanOldChat();
    chatTick();
    if (store && myId) { const lb = document.getElementById('login-banner'); if (lb) lb.hidden = true; }
    if (currentView() === 'feed') renderFeed();
    if (currentView() === 'rank') render();
    if (openPerson) renderPerson();
    if (!$('#post-modal').hidden) renderPostCmts();
    try { if (window.athlete && window.athlete.memosChanged) window.athlete.memosChanged(); } catch {}
  }

  const myNick = () => (members[myId] && members[myId].nick) || '';
  /* ---- 처음 들어온 사람: 닉네임부터 등록 ---- */
  function checkWelcome() {
    const need = !!store && ready && !failed && !myNick();
    const el = $('#welcome-modal');
    if (need && el.hidden) {
      const names = Object.values(members).map((m) => m.nick).filter(Boolean);
      $('#welcome-who').textContent = names.length
        ? `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 외 ${names.length - 5}명` : ''} 님이 이미 함께하고 있어요`
        : '첫 번째 멤버가 되어보세요!';
      el.hidden = false;
      document.body.classList.add('modal-open');
      setTimeout(() => $('#welcome-nick').focus(), 300);
    } else if (!need && !el.hidden) {
      el.hidden = true;
      document.body.classList.remove('modal-open');
    }
  }
  const nickOf = (id) => (members[id] && members[id].nick) || '알 수 없음';

  /* ---- 내 요약 올리기 ---- */
  // 최근 3일 운동 마감 시각 (친구 축하 팝업용)
  function recentClosed() {
    const cut = addDays(todayStr(), -2), out = {};
    for (const [d, t] of Object.entries(closedMap)) if (d >= cut && dayVolume(d) > 0) out[d] = t;
    return out;
  }
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
    return { days, best, cdays, log: shareLog() ? recentLog(30) : {}, custom: myCustoms(), dsum: daySums(40), char: (() => { try { return window.athlete ? window.athlete.summary() : null; } catch { return null; } })(), live: myLive(), closed: recentClosed() };
  }
  /* ---- 하루 요약 (왕 계산용, 최근 40일) ---- */
  const RUN_NAMES = ['러닝', '트레드밀', '인터벌 러닝'];
  const armPart = (p) => (p === '이두' || p === '삼두' || p === '전완' ? '팔' : p);
  const idHour = (id) => { const t = parseInt(String(id || '').slice(0, -5), 36); return t > 1.5e12 && t < 4e12 ? t : 0; };
  function daySum(d) {
    const out = { v: 0, p: {}, km: 0, rmin: 0, goals: 0, sets: 0, reps: 0, maxW: 0, top: 0, n: [] };
    let h0 = 99, h1 = -1;
    for (const ex of db[d] || []) {
      const v = exerciseVolume(ex, d);
      if (!(v > 0)) continue;
      const info = cardioInfo(ex);
      const part = info ? '유산소' : armPart(partOf(ex.name));
      out.v += v; out.p[part] = Math.round((out.p[part] || 0) + v);
      out.top = Math.max(out.top, Math.round(v));
      if (!out.n.includes(ex.name)) out.n.push(ex.name);
      const t = idHour(ex.id);
      if (t && toStr(new Date(t)) === d) { const h = new Date(t).getHours(); h0 = Math.min(h0, h); h1 = Math.max(h1, h); }
      for (const st of ex.sets) {
        if (isGolf(ex)) {
          const h = num(st.h) || 18, r = num(st.r);
          if (r > 0 && h >= 9) { const per18 = Math.round((r * 18) / h); out.golf = out.golf ? Math.min(out.golf, per18) : per18; }
          continue;
        }
        if (info) {
          if (RUN_NAMES.includes(ex.name) && num(st.km) > 0) { out.km += num(st.km); out.rmin += num(st.min); }
          out.goals += num(st.goals);
        } else if (num(st.r) > 0) {
          if (isPenalty(ex)) continue;
          out.sets++; out.reps += num(st.r);
          if (!bwType(ex)) out.maxW = Math.max(out.maxW, num(st.w));
        }
      }
    }
    if (!(out.v > 0)) return null;
    out.v = Math.round(out.v); out.km = +out.km.toFixed(2);
    if (h1 >= 0) { out.h0 = h0; out.h1 = h1; }
    return out;
  }
  function daySums(back) {
    const from = addDays(todayStr(), -(back - 1)), out = {};
    for (const d of Object.keys(db)) if (d >= from) { const x = daySum(d); if (x) out[d] = x; }
    return out;
  }

  /* ---- 운동 내용 공유 (최근 30일) ---- */
  const SHARE_KEY = 'gymlog.shareLog';
  function shareLog() { try { return localStorage.getItem(SHARE_KEY) !== 'off'; } catch { return true; } }
  const kgStr = (w) => `${+num(w).toFixed(2)}kg`;
  function describeSets(ex) {
    const sets = ex.sets.filter((st) => num(st.r) > 0 || num(st.km) > 0 || num(st.min) > 0 || num(st.wkcal) > 0);
    if (!sets.length) return '';
    if (isPenalty(ex)) return sets.map((st) => `🫣 ${num(st.r)}회${num(st.min) ? ` ${num(st.min)}분` : ''} (${PENALTY_KG[ex.name]}kg)`).join(' / ');
    if (isGolf(ex)) return sets.map((st) => `⛳ ${num(st.h) || 18}홀 ${num(st.r)}타${isFieldGolf(ex) ? ` · 걷기 ${+(FIELD_GOLF_KM * ((num(st.h) || 18) / 18)).toFixed(1)}km` : ''}`).join(' / ');
    if (cardioInfo(ex)) {
      return sets.map((st) => [
        num(st.km) ? `${num(st.km)}km` : '',
        num(st.min) ? `${num(st.min)}분` : '',
        paceText(ex.name, num(st.km), num(st.min)),
        st.iv ? `⚡${String(st.iv).slice(0, 50)}` : '',
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
    const { days, best, cdays, log, custom, dsum, char, live, closed } = mySummary();
    const key = JSON.stringify({ nick, days, best, cdays, log, custom, dsum, char, live, closed });
    if (key === lastPublished) return;
    const doc = { nick, days, best, cdays, log, custom, dsum, closed, updatedAt: Date.now() };
    if (char) doc.char = char;
    if (live) doc.live = live;
    await store.doc('board/' + myId).set(doc);
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
    return Object.values(comments).flat().filter((c) => members[c.from] && c.kind !== 'meal' && c.kind !== 'fcmt' && c.kind !== 'memo' && c.kind !== 'pray' && c.kind !== 'chat').sort((a, b) => b.at - a.at);
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
  /* ---- 실시간 운동 중 + 응원 보내기 ---- */
  const LIVE_MS = 20 * 60 * 1000;
  function myLive() {
    const t = todayStr();
    if (!liveAt || toStr(new Date(liveAt)) !== t || !(dayVolume(t) > 0)) return null;
    return { at: liveAt };
  }
  const isLive = (id) => {
    const lv = id === myId ? myLive() : (members[id] || {}).live;
    return !!(lv && Date.now() - num(lv.at) < LIVE_MS);
  };
  const CHEERS = {
    '등': ['야 너 오늘 등 잘먹는다?', '광배 날개 펴지는 소리 들린다', '등짝 미쳤다 진짜', '오늘 등에 문신 새겨지겠다'],
    '가슴': ['오늘 갑빠 터지겠는데?', '가슴 펌핑 제대로네', '벤치 부서지겠다 살살해', '갑옷 하나 장만했네'],
    '하체': ['하체 한 날은 존경이지', '내일 계단 조심해라 ㅋㅋ', '허벅지 터지겠다', '레그데이 도망 안 갔네 인정'],
    '어깨': ['어깨 깡패 납신다', '어깨에 수박 들어간다', '문 옆으로 지나가야겠다'],
    '팔': ['반팔 찢어지겠다', '알통 터진다 조심해', '팔뚝 펌핑 미쳤네'],
    '유산소': ['심폐 괴물 출현', '오늘 땀 몇 리터냐', '폐가 두 개 더 있냐'],
    '축구': ['오늘 몇 골 넣었냐 메시야', '손흥민 빙의했네', '무릎은 괜찮냐 ㅋㅋ'],
    '기타': ['오늘도 불태웠네 🔥', '꾸준함 미쳤다', '오늘도 출석 인정'],
    'live': ['운동 중이구나! 한 세트 더!', '지금 불타고 있네 🔥 화이팅', '쉬지 마라 지켜보고 있다 👀'],
  };
  const cheerIdx = {};
  function todayFocus(id) {
    const t = todayStr();
    const x = id === myId ? null : friendDay(members[id], t);
    if (!x) return null;
    const names = (x.n || []).join(' ');
    if (/풋살|축구/.test(names)) return { key: '축구', label: '풋살·축구', v: x.v };
    const top = Object.entries(x.p || {}).sort((a, b) => b[1] - a[1])[0];
    const k = top ? (top[0] === '팔' || ['이두', '삼두', '전완'].includes(top[0]) ? '팔' : CHEERS[top[0]] ? top[0] : '기타') : '기타';
    return { key: k, label: top ? top[0] : '운동', v: x.v };
  }
  function cheerText(id, f) {
    const pool = isLive(id) && (cheerIdx[id] || 0) % 2 === 0 ? CHEERS.live : CHEERS[f.key] || CHEERS['기타'];
    const i = (cheerIdx[id] ?? (hashStr(id + todayStr()) % 7)) % pool.length;
    return pool[i];
  }
  function renderCheers() {
    const t = todayStr();
    const rows = Object.keys(members).filter((id) => id !== myId)
      .map((id) => ({ id, m: members[id], f: todayFocus(id), live: isLive(id) }))
      .filter((r) => r.f || r.live)
      .sort((a, b) => (b.live - a.live) || (num(b.f && b.f.v) - num(a.f && a.f.v)));
    $('#cheer-panel').hidden = !rows.length;
    if (!rows.length) return;
    const liveN = rows.filter((r) => r.live).length;
    $('#cheer-sub').textContent = liveN ? `지금 ${liveN}명 운동 중` : `오늘 ${rows.length}명 운동함`;
    $('#cheer-list').innerHTML = rows.map((r) => {
      const f = r.f || { key: '기타', label: '운동', v: 0 };
      const msg = cheerText(r.id, f);
      return `<div class="cheer-card ${r.live ? 'live' : ''}" data-id="${escapeHtml(r.id)}">
        <div class="cheer-top">
          <span class="cheer-who">${r.live ? '<i class="live-dot"></i>' : ''}<b>${escapeHtml(r.m.nick)}</b>
            <small>${r.live ? '지금 운동 중' : '오늘'} · ${escapeHtml(f.label)}${f.v ? ` ${fmtKg(f.v)}` : ''}</small></span>
        </div>
        <button type="button" class="cheer-msg" data-act="next" aria-label="다른 말로 바꾸기">“${escapeHtml(msg)}” <svg class="i"><use href="#i-right"/></svg></button>
        <div class="cheer-btns">
          <button type="button" data-act="send" data-emo="❤️">❤️ 하트</button>
          <button type="button" data-act="send" data-emo="👍">👍 따봉</button>
        </div>
      </div>`;
    }).join('');
    $('#cheer-list').querySelectorAll('.cheer-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('[data-act=next]').addEventListener('click', () => { cheerIdx[id] = (cheerIdx[id] ?? (hashStr(id + todayStr()) % 7)) + 1; renderCheers(); });
      card.querySelectorAll('[data-act=send]').forEach((b) => b.addEventListener('click', async () => {
        const msg = card.querySelector('.cheer-msg').textContent.trim().replace(/^“|”$/g, '');
        b.disabled = true;
        try {
          await store.collection(`comments/${myId}/items`).add({ to: id, text: `${b.dataset.emo} ${msg}`, at: Date.now() });
          b.classList.add('sent'); toast(`${nickOf(id)}님에게 ${b.dataset.emo} 보냈어요`);
        } catch (e) {
          toast(e && e.code === 'invalid_argument' ? '응원을 보낼 권한이 없어요 (편집자로 초대받아야 해요)' : '보내지 못했어요');
        }
        setTimeout(() => { b.disabled = false; b.classList.remove('sent'); }, 1500);
      }));
    });
  }
  // 나한테 온 응원 알림
  const CHEER_SEEN = 'gymlog.cheerSeen';
  let cheerSeen = (() => { try { return +localStorage.getItem(CHEER_SEEN) || 0; } catch { return 0; } })();
  if (!cheerSeen) { cheerSeen = Date.now(); try { localStorage.setItem(CHEER_SEEN, String(cheerSeen)); } catch {} }
  function checkIncoming() {
    if (!myId) return;
    const fresh = Object.values(comments).flat().filter((c) => c.to === myId && c.from !== myId && num(c.at) > cheerSeen).sort((a, b) => a.at - b.at);
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1];
    cheerSeen = num(last.at);
    try { localStorage.setItem(CHEER_SEEN, String(cheerSeen)); } catch {}
    toast(`${nickOf(last.from)}: ${String(last.text).slice(0, 40)}${fresh.length > 1 ? ` 외 ${fresh.length - 1}개` : ''}`);
  }

  /* ---- 🔒 어제 운동 안 한 사람 → 오늘 산스장 교도소 (오늘 운동하면 석방) ---- */
  function isJailed(id) {
    const t = todayStr(), y = addDays(t, -1);
    if (id === myId) {
      if (dayVolume(t) > 0) return false;
      return Object.keys(db).some((d) => d < y && dayVolume(d) > 0) && !(dayVolume(y) > 0);
    }
    const m = members[id]; if (!m) return false;
    if (friendDay(m, t)) return false;
    const ever = Object.keys(m.days || {}).length + Object.keys(m.cdays || {}).length + Object.keys(m.dsum || {}).length;
    return ever > 0 && !friendDay(m, y);
  }
  /* ---- 🎉 친구가 운동 기록 남기면 첫 화면에 축하 팝업 (축하/피드백해야 닫힘) ---- */
  const CONGRATS_KEY = 'gymlog.congrats';
  let congratsArmed = true, congratsQ = [], congratsCur = null;
  const congratsDone = () => { try { return JSON.parse(localStorage.getItem(CONGRATS_KEY) || '{}') || {}; } catch { return {}; } };
  function markCongrats(key) {
    const d = congratsDone(); d[key] = Date.now();
    const cut = Date.now() - 5 * 864e5;
    for (const k of Object.keys(d)) if (d[k] < cut) delete d[k];
    try { localStorage.setItem(CONGRATS_KEY, JSON.stringify(d)); } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { congratsArmed = true; setTimeout(checkCongrats, 1200); } });
  function checkCongrats() {
    if (!store || !myId || !ready || !myNick()) return;
    if (!$('#welcome-modal').hidden || !$('#congrats-modal').hidden) return;
    if (!comments[myId]) return;   // 내가 보낸 댓글을 불러온 뒤에 판단 (이미 반응한 친구는 건너뜀)
    congratsArmed = false;
    const t = todayStr(), y = addDays(t, -1), done = congratsDone();
    congratsQ = [];
    for (const id of Object.keys(members)) {
      if (id === myId || !members[id].nick) continue;
      for (const d of [t, y]) {
        const x = friendDay(members[id], d);
        if (!x || !(num(x.v) > 0)) continue;
        if (!(members[id].closed || {})[d]) break;   // 운동 마감한 기록만 팝업
        // 한 번만: 이 기기에서 반응했거나, 이미 그날(마감 이후) 그 친구에게 댓글·축하를 보냈으면 안 띄움
        const since = new Date(`${d}T00:00:00`).getTime();
        const reacted = (comments[myId] || []).some((c) => c.to === id && num(c.at) >= since);
        if (reacted) { if (!done[`${id}|${d}`]) markCongrats(`${id}|${d}`); }
        else if (!done[`${id}|${d}`]) congratsQ.push({ id, d, x });
        break;   // 가장 최근 날 하나만
      }
    }
    congratsQ.sort((a, b) => (b.d > a.d) - (b.d < a.d) || num(b.x.v) - num(a.x.v));
    if (congratsQ.length) showCongrats();
  }
  /* 📌 누가 내 방 메모판에 메모를 붙이면 바로가기 팝업 */
  const MEMO_SEEN_KEY = 'gymlog.memoSeen';
  const memoSeen = () => { try { return +localStorage.getItem(MEMO_SEEN_KEY) || 0; } catch { return 0; } };
  let memoPopList = [];
  function checkMemoPop() {
    if (!store || !myId || !ready || !myNick()) return;
    const busy = ['#welcome-modal', '#congrats-modal', '#part-modal'].some((q) => { const e = $(q); return e && !e.hidden; });
    if (busy) return;
    const from = Math.max(memoSeen(), Date.now() - 3 * 86400000);
    memoPopList = Object.values(comments).flat()
      .filter((c) => c.kind === 'memo' && c.to === myId && c.from !== myId && members[c.from] && num(c.at) > from)
      .sort((a, b) => num(b.at) - num(a.at));
    if (!memoPopList.length) return;
    const who = [...new Set(memoPopList.map((c) => nickOf(c.from)))];
    $('#memo-pop-title').textContent = `${who.slice(0, 2).join(', ')}${who.length > 2 ? ` 외 ${who.length - 2}명` : ''}님이 내 방에 메모를 붙였어요!`;
    $('#memo-pop-list').innerHTML = memoPopList.slice(0, 3).map((c) => `<div class="memo-item c-${escapeHtml(c.c || 'y')}"><span>${escapeHtml(String(c.text || ''))}</span><small>${escapeHtml(nickOf(c.from))}</small></div>`).join('')
      + (memoPopList.length > 3 ? `<p class="memo-pop-more">외 ${memoPopList.length - 3}장 더</p>` : '');
    $('#memo-pop').hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeMemoPop() {
    const top = memoPopList.reduce((a, c) => Math.max(a, num(c.at)), 0);
    try { localStorage.setItem(MEMO_SEEN_KEY, String(Math.max(top, memoSeen()))); } catch { /* 없음 */ }
    $('#memo-pop').hidden = true;
    document.body.classList.remove('modal-open');
  }
  $('#memo-pop-later').addEventListener('click', closeMemoPop);
  $('#memo-pop .rest-backdrop').addEventListener('click', closeMemoPop);
  $('#memo-pop-go').addEventListener('click', () => {
    closeMemoPop();
    if (window.athlete && window.athlete.goMemo) window.athlete.goMemo();
  });
  function showCongrats() {
    const c = congratsQ.shift();
    const el = $('#congrats-modal');
    if (!c) { el.hidden = true; document.body.classList.remove('modal-open'); congratsCur = null; setTimeout(checkMemoPop, 300); return; }
    congratsCur = c;
    const nk = nickOf(c.id), when = c.d === todayStr() ? '오늘' : '어제';
    const parts = Object.entries(c.x.p || {}).filter(([, v]) => num(v) > 0).sort((a, b) => b[1] - a[1]);
    const top = parts[0] ? parts[0][0] : '';
    const key = /풋살|축구/.test((c.x.n || []).join(' ')) ? '축구' : (CHEERS[armPart(top)] ? armPart(top) : '기타');
    c.focus = top ? `${top} ` : '';
    $('#congrats-title').textContent = `${nk}님이 ${when} 운동을 마감했어요!`;
    $('#congrats-sub').textContent = `총 ${fmtKg(num(c.x.v))}${(c.x.n || []).length ? ` · ${(c.x.n || []).slice(0, 3).join(', ')}${c.x.n.length > 3 ? ` 외 ${c.x.n.length - 3}개` : ''}` : ''}`;
    $('#congrats-parts').innerHTML = parts.slice(0, 4).map(([p, v]) => `<span>${escapeHtml(p)} <b>${fmtKg(num(v))}</b></span>`).join('');
    $('#congrats-count').textContent = congratsQ.length ? `🎉 축하할 기록 ${congratsQ.length + 1}개` : '🎉 새 기록';
    const pool = CHEERS[key] || CHEERS['기타'];
    const start = hashStr(c.id + c.d) % pool.length;
    $('#congrats-chips').innerHTML = [0, 1, 2].map((i) => pool[(start + i) % pool.length]).filter((v, i, a) => a.indexOf(v) === i)
      .map((m) => `<button type="button" data-msg="${escapeHtml(m)}">“${escapeHtml(m)}”</button>`).join('');
    $('#congrats-chips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => sendCongrats(`👍 ${b.dataset.msg}`)));
    $('#congrats-text').value = '';
    el.querySelector('.congrats-sheet').classList.remove('pop'); void el.offsetWidth; el.querySelector('.congrats-sheet').classList.add('pop');
    el.hidden = false; document.body.classList.add('modal-open');
  }
  async function sendCongrats(text) {
    const c = congratsCur; if (!c) return;
    const btns = $('#congrats-modal').querySelectorAll('button');
    btns.forEach((b) => (b.disabled = true));
    markCongrats(`${c.id}|${c.d}`);   // 보내기 전에 먼저 '반응함' 표시 → 다시 안 뜸
    try {
      await store.collection(`comments/${myId}/items`).add({ to: c.id, text, at: Date.now() });
      toast(`${nickOf(c.id)}님에게 보냈어요 🎉`);
    } catch (e) {
      toast(e && e.code === 'invalid_argument' ? '보낼 권한이 없어요 (편집자로 초대받아야 해요)' : '보내지 못했어요');
    }
    markCongrats(`${c.id}|${c.d}`);
    btns.forEach((b) => (b.disabled = false));
    showCongrats();
  }
  $('#congrats-go').addEventListener('click', () => {
    const c = congratsCur; if (!c) return;
    sendCongrats(`🎉 축하해! ${c.d === todayStr() ? '오늘' : '어제'} 총 ${fmtKg(num(c.x.v))} 미쳤다 👏`);
  });
  $('#congrats-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#congrats-text').value.trim();
    if (!v) { $('#congrats-text').focus(); return; }
    sendCongrats(`💬 ${v}`);
  });

  /* ---- 주간 · 월간 왕 ---- */
  let awPeriod = 'week';
  // 친구의 하루 요약: 새 버전이면 dsum, 아니면 공유된 기록으로 추정
  function friendDay(m, d) {
    const ds = (m.dsum || {})[d];
    if (ds) return ds;
    const v = num((m.days || {})[d]) + num((m.cdays || {})[d]);
    if (!(v > 0)) return null;
    const items = (m.log || {})[d];
    const out = { v, p: {}, km: 0, rmin: 0, goals: 0, sets: 0, reps: 0, maxW: 0, top: 0, n: [] };
    if (Array.isArray(items)) for (const x of items) {
      const part = x.c ? '유산소' : armPart(partOf(x.n));
      out.p[part] = (out.p[part] || 0) + num(x.v);
      out.top = Math.max(out.top, num(x.v));
      if (x.n && !out.n.includes(x.n)) out.n.push(x.n);
    }
    return out;
  }
  const dayTotal = (id, d) => id === myId ? dayVolume(d) : num((members[id].days || {})[d]) + num((members[id].cdays || {})[d]);
  function awardRange() {
    const t = todayStr();
    const dates = (awPeriod === 'week' ? weekDates(t) : monthDays(t)).filter((d) => d <= t);
    const len = awPeriod === 'week' ? 7 : dates.length;
    const prev = awPeriod === 'week' ? dates.map((d) => addDays(d, -7)) : Array.from({ length: len }, (_, i) => addDays(monthDays(addDays(dates[0], -1))[0], i));
    return { dates, past: dates.filter((d) => d < t), prev };
  }
  function statsFor(id, range, cmts) {
    const S = { total: 0, p: {}, km: 0, rmin: 0, goals: 0, reps: 0, maxW: 0, top: 0, names: new Set(), dayMax: 0, dates: new Set(), weekend: 0, late: 0, early: 0, cmt: 0, streak: 0, growth: 0 };
    let run = 0;
    for (const d of range.dates) {
      const x = id === myId ? daySum(d) : friendDay(members[id], d);
      if (!x) { if (d < todayStr()) run = 0; continue; }
      S.dates.add(d); run++; S.streak = Math.max(S.streak, run);
      S.total += num(x.v); S.dayMax = Math.max(S.dayMax, num(x.v));
      for (const [k, v] of Object.entries(x.p || {})) S.p[k] = (S.p[k] || 0) + num(v);
      S.km += num(x.km); S.rmin += num(x.rmin); S.goals += num(x.goals); S.reps += num(x.reps);
      S.maxW = Math.max(S.maxW, num(x.maxW)); S.top = Math.max(S.top, num(x.top));
      if (num(x.golf) > 0) S.golf = S.golf ? Math.min(S.golf, num(x.golf)) : num(x.golf);
      (x.n || []).forEach((n) => S.names.add(n));
      const dow = parse(d).getDay();
      if (dow === 0 || dow === 6) S.weekend += num(x.v);
      if (x.h1 !== undefined && x.h1 >= 22) S.late++;
      if (x.h0 !== undefined && x.h0 < 8) S.early++;
    }
    S.cmt = cmts.filter((c) => c.from === id).length;
    const before = range.prev.reduce((a, d) => a + dayTotal(id, d), 0);
    S.growth = before > 0 && S.total > before ? Math.round(((S.total - before) / before) * 100) : 0;
    S.pace = S.km >= 3 && S.rmin > 0 ? S.rmin / S.km : 0;
    S.rest = range.past.filter((d) => !S.dates.has(d)).length;
    S.perfect = S.dates.size > 0 && range.past.every((d) => S.dates.has(d));
    S.legSkip = S.dates.size >= 3 && !(S.p['하체'] > 0);
    return S;
  }
  const pace = (v) => `${Math.floor(v)}'${String(Math.round((v % 1) * 60)).padStart(2, '0')}"/km`;
  const AWARDS = [
    { icon: '🛡️', name: '가슴왕', desc: '가슴 볼륨', get: (S) => num(S.p['가슴']), fmt: fmtKg },
    { icon: '🦅', name: '등왕', desc: '등 볼륨', get: (S) => num(S.p['등']), fmt: fmtKg },
    { icon: '🦵', name: '하체왕', desc: '하체 볼륨', get: (S) => num(S.p['하체']), fmt: fmtKg },
    { icon: '🎯', name: '어깨왕', desc: '어깨 볼륨', get: (S) => num(S.p['어깨']), fmt: fmtKg },
    { icon: '💪', name: '팔왕', desc: '팔 볼륨 (이두·삼두·전완)', get: (S) => num(S.p['팔']), fmt: fmtKg },
    { icon: '🏃', name: '이봉주', desc: '러닝 거리', get: (S) => S.km, fmt: (v) => `${+v.toFixed(1)}km` },
    { icon: '⚽', name: '득점왕', desc: '풋살·축구 골', get: (S) => S.goals, fmt: (v) => `${v}골` },
    { icon: '⛳', name: '골프왕', desc: '스크린·필드골프 최저타 (18홀 기준)', get: (S) => num(S.golf), fmt: (v) => `${v}타`, low: true },
    { icon: '📅', name: '출석왕', desc: '운동한 날 수', get: (S) => S.dates.size, fmt: (v) => `${v}일` },
    { icon: '🏅', name: '개근상', desc: '하루도 안 빠진 사람 전원', all: (S) => S.perfect, sub: (S) => `${S.dates.size}일째 개근`, none: '하루도 안 빠지면 받아요', meWin: '나도 받음 🎉' },
    { icon: '🛋️', name: '휴식왕', desc: '가장 많이 쉰 사람', get: (S) => S.rest, fmt: (v) => `${v}일 쉼`, ties: true, meWin: '나… 😅' },
  ];
  const FUN_AWARDS = [
    { icon: '🏋️', name: '최고중량왕', desc: '가장 무거운 한 세트', get: (S) => S.maxW, fmt: (v) => `${+v.toFixed(1)}kg` },
    { icon: '🔁', name: '횟수왕', desc: '총 반복 횟수', get: (S) => S.reps, fmt: (v) => `${v.toLocaleString()}회` },
    { icon: '💥', name: '하루 볼륨왕', desc: '하루 최고 볼륨', get: (S) => S.dayMax, fmt: fmtKg },
    { icon: '🍱', name: '종목왕', desc: '해본 종목 수', get: (S) => S.names.size, fmt: (v) => `${v}종목` },
    { icon: '🔥', name: '연속 출석왕', desc: '최장 연속 운동', get: (S) => S.streak, fmt: (v) => `${v}일 연속` },
    { icon: '📈', name: '성장왕', desc: '지난 기간보다 볼륨 증가율', get: (S) => S.growth, fmt: (v) => `+${v}%` },
    { icon: '🏖️', name: '주말왕', desc: '토·일 볼륨', get: (S) => S.weekend, fmt: fmtKg },
    { icon: '⚡', name: '페이스왕', desc: '러닝 평균 페이스 (3km 이상)', get: (S) => S.pace, fmt: pace, low: true },
    { icon: '🌙', name: '야간 운동왕', desc: '밤 10시 넘어 운동한 날', get: (S) => S.late, fmt: (v) => `${v}번` },
    { icon: '🌅', name: '새벽 운동왕', desc: '오전 8시 전에 운동한 날', get: (S) => S.early, fmt: (v) => `${v}번` },
    { icon: '💬', name: '댓글왕', desc: '댓글·응원 많이 단 사람', get: (S) => S.cmt, fmt: (v) => `${v}개` },
    { icon: '🐔', name: '하체 도망자', desc: '3일 이상 운동했는데 하체 0', all: (S) => S.legSkip, sub: (S) => `${S.dates.size}일 운동 · 하체 0kg`, none: '모두 하체 했어요 👏', meWin: '나… 🐔' },
  ];
  const ALL_AWARDS = [...AWARDS, ...FUN_AWARDS];
  const periodPrefix = () => (awPeriod === 'week' ? '이주의' : '이달의');
  // 부문 전체 순위
  function awardRows(a, people) {
    if (a.all) return people.filter((x) => a.all(x.S)).map((x) => ({ ...x, label: a.sub(x.S) }));
    return people.map((x) => ({ ...x, v: a.get(x.S) })).filter((x) => x.v > 0)
      .sort((p, q) => (a.low ? p.v - q.v : q.v - p.v)).map((x) => ({ ...x, label: a.fmt(x.v) }));
  }
  function awardCard(a, people, idx) {
    const rows = awardRows(a, people);
    let win = [], meTxt = '';
    if (rows.length) {
      win = a.all ? rows : a.ties ? rows.filter((x) => x.v === rows[0].v) : [rows[0]];
      const myIdx = rows.findIndex((x) => x.id === myId);
      if (win.some((x) => x.id === myId)) meTxt = `<span class="aw-me win">${a.meWin || '나 🔥'}</span>`;
      else if (myIdx > 0) meTxt = `<span class="aw-me">나 ${myIdx + 1}위</span>`;
    }
    const names = win.length ? win.map((x) => escapeHtml(x.nick)).join('·') : (a.none || '아직 없음');
    const val = win.length ? (a.all ? `${win.length}명` : rows[0].label) : '';
    const second = !a.all && !a.ties && rows[1] ? `<span class="aw-next">2위 ${escapeHtml(rows[1].nick)}${rows[2] ? ` · 3위 ${escapeHtml(rows[2].nick)}` : ''}</span>` : '';
    return `<button type="button" class="aw-row ${a.hero ? 'hero' : ''} ${win.length ? '' : 'empty'}" data-aw="${idx}">
      <span class="aw-icon">${a.icon}</span>
      <span class="aw-main"><small>${periodPrefix()}</small><strong>${a.name}</strong><em class="aw-desc">${a.desc}</em><b>${names}</b>${second}</span>
      <span class="aw-val">${val}${meTxt}</span>
    </button>`;
  }
  let awPeople = [];
  function renderAwards() {
    const t = todayStr();
    $('#awards-title').textContent = awPeriod === 'week' ? '이주의 왕' : `${+t.slice(5, 7)}월의 왕`;
    $('#awards-hint').textContent = awPeriod === 'week' ? '매주 월요일 초기화 · 눌러서 전체 순위' : '매달 1일 초기화 · 눌러서 전체 순위';
    document.querySelectorAll('#aw-period button').forEach((b) => b.classList.toggle('active', b.dataset.p === awPeriod));
    const range = awardRange();
    const start = parse(range.dates[0]).getTime();
    const cmts = allComments().filter((c) => c.kind !== 'share' && c.at >= start);
    awPeople = Object.entries(members).map(([id, m]) => ({ id, nick: m.nick, S: statsFor(id, range, cmts) }));
    $('#awards-list').innerHTML = AWARDS.map((a, i) => awardCard(a, awPeople, i)).join('');
    $('#fun-awards').innerHTML = FUN_AWARDS.map((a, i) => awardCard(a, awPeople, AWARDS.length + i)).join('');
    document.querySelectorAll('.awards .aw-row').forEach((b) => b.addEventListener('click', () => openAward(+b.dataset.aw)));
  }
  // 부문 눌렀을 때: 1위 · 2위 · 3위 … 전체 순위 팝업
  function openAward(i) {
    const a = ALL_AWARDS[i];
    if (!a) return;
    const rows = awardRows(a, awPeople);
    $('#award-icon').textContent = a.icon;
    $('#award-title').textContent = `${periodPrefix()} ${a.name}`;
    $('#award-desc').textContent = a.desc + (a.low ? ' · 낮을수록 좋아요' : '');
    const medal = ['🥇', '🥈', '🥉'];
    $('#award-list').innerHTML = rows.length ? rows.map((x, k) => {
      const rank = a.all ? 0 : a.ties ? rows.findIndex((y) => y.v === x.v) : k;
      return `<button type="button" class="aw-rank ${x.id === myId ? 'me' : ''}" data-id="${escapeHtml(x.id)}">
        <span class="aw-no">${a.all ? a.icon : rank < 3 ? medal[rank] : rank + 1}</span>
        <span class="aw-who">${escapeHtml(x.nick)}${x.id === myId ? '<span class="me-tag">나</span>' : ''}</span>
        <span class="aw-v">${x.label}</span>
      </button>`;
    }).join('') : `<p class="empty-text">${a.none || '아직 기록한 사람이 없어요'}</p>`;
    const rest = a.all ? [] : awPeople.filter((x) => !rows.some((r) => r.id === x.id));
    $('#award-rest').textContent = rest.length ? `기록 없음: ${rest.map((x) => x.nick).join(', ')}` : '';
    $('#award-list').querySelectorAll('.aw-rank').forEach((b) => b.addEventListener('click', () => { closeAward(); openProfile(b.dataset.id); }));
    $('#award-modal').hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeAward() { $('#award-modal').hidden = true; document.body.classList.remove('modal-open'); }
  $('#award-close').addEventListener('click', closeAward);
  $('#award-modal .rest-backdrop').addEventListener('click', closeAward);
  document.querySelectorAll('#aw-period button').forEach((b) => b.addEventListener('click', () => { awPeriod = b.dataset.p; renderAwards(); }));
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
    $('#rank-kings').hidden = mode !== 'kings';
    $('#rank-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
    if (mode === 'kings') { renderAwards(); return; }
    renderCheers();

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
          <span class="rank-name">${isLive(r.id) ? '<i class="live-dot" title="지금 운동 중"></i>' : ''}${escapeHtml(r.m.nick)}${r.id === myId ? '<span class="me-tag">나</span>' : ''}<span class="title-chip">${escapeHtml(titleOf(r.id, todayStr()))}</span>
            ${cmtCount[r.id] ? `<span class="rank-cmt"><svg class="i"><use href="#i-chat"/></svg>${cmtCount[r.id]}</span>` : ''}</span>
          <span class="rank-bar"><div style="width:${(r.value / max) * 100}%"></div></span>
        </span>
        <span class="rank-val">${fmtMetric(r.value)}</span>
      </button>`).join('');
    $('#rank-list').querySelectorAll('.rank-row').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.id)));

    const feed = allComments().slice(0, 30);
    // 펼쳐둔 상세는 새로고침돼도 그대로
    document.querySelectorAll('#feed-list details[data-fold]').forEach((d) => { d.open ? openFolds.add(d.dataset.fold) : openFolds.delete(d.dataset.fold); });
    $('#feed-list').innerHTML = feed.length ? feed.map((c) => c.kind === 'share' ? `
      <div class="feed-item share-post" data-from="${escapeHtml(c.from)}">
        <div class="feed-meta"><b>${escapeHtml(nickOf(c.from))}</b> 님이 운동을 공유했어요 · ${relTime(c.at)}
          ${c.from === myId ? `<button class="comment-del" data-del="${escapeHtml(c.id)}">삭제</button>` : ''}</div>
        <div class="share-sum">${escapeHtml(String(c.summary || ''))}</div>
        ${c.text ? `<div class="feed-text">${escapeHtml(c.text)}</div>` : ''}
        ${Array.isArray(c.items) && c.items.length ? `<details class="share-fold" data-fold="${escapeHtml(c.from + '/' + c.id)}" ${openFolds.has(c.from + '/' + c.id) ? 'open' : ''}><summary><span>운동 ${c.items.length}개 상세 보기</span><svg class="i"><use href="#i-right"/></svg></summary><div class="share-items">${c.items.slice(0, 15).map((x) => `<div><b>${escapeHtml(String(x.n || ''))}</b> <span>${escapeHtml(String(x.d || ''))}</span></div>`).join('')}</div></details>` : ''}
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
    $('#person-name').innerHTML = `${escapeHtml(m.nick + (openPerson === myId ? ' (나)' : ''))}<span class="person-title">✦ ${escapeHtml(titleOf(openPerson, todayStr()))}</span>`;
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
      return true;
    } catch (e) {
      const denied = !e || e.code !== 'unavailable';
      toast(denied ? '참가 권한이 없어요. 초대 메일을 수락했는지 확인해 주세요' : '참가하지 못했어요. 다시 시도해 주세요');
      return denied ? 'denied' : false;
    }
  }

  // 이벤트
  $('#join-form').addEventListener('submit', (e) => { e.preventDefault(); join($('#join-nick').value); });
  $('#welcome-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#welcome-form button');
    btn.disabled = true;
    const r = await join($('#welcome-nick').value);
    btn.disabled = false;
    if (r === 'denied' || r === false) $('#welcome-err').hidden = false;
    checkWelcome();
  });

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

  /* ---- 눈바디 피드 (셋로그처럼 사진만 모아보기) ---- */
  let mode = 'board', feedSrc = 'friends', feedList = [], feedIdx = 0;
  $('#rank-mode').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function setMode(m) {
    mode = m;
    $('#page-title').textContent = RANK_TITLES[m];
    window.scrollTo({ top: 0 });
    render();
  }
  $('#feed-chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    feedSrc = b.dataset.src;
    $('#feed-chips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    renderPhotoFeed();
  }));

  async function renderPhotoFeed() {
    const grid = $('#photo-feed-grid'), hint = $('#photo-feed-hint');
    if (feedSrc === 'friends') {
      feedList = allComments().filter((c) => c.kind === 'share' && typeof c.img === 'string' && c.img.startsWith('data:image/'))
        .map((c) => ({ img: c.img, who: nickOf(c.from), from: c.from, date: c.date, summary: c.summary, text: c.text, items: c.items, at: c.at, mine: c.from === myId, pid: `${c.from}/${c.id}` }));
      hint.textContent = feedList.length ? '공유할 때 눈바디 사진을 켜면 여기에 모여요' : '아직 공유된 눈바디가 없어요. 운동 마감 → 친구에게 공유 → 눈바디 사진 켜기';
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
        <span class="pf-tag">${x.own ? escapeHtml(fmtDate(x.date)) : escapeHtml(x.who)}</span>${cmtBadge(x.pid)}
      </button>`).join('');
    grid.querySelectorAll('.pf-cell[data-i]').forEach((el) => el.addEventListener('click', () => openPost(+el.dataset.i)));
  }

  function openPost(i) {
    feedIdx = (i + feedList.length) % feedList.length;
    const x = feedList[feedIdx];
    if (!x) return;
    $('#post-who').textContent = x.own ? `내 눈바디 · ${fmtDate(x.date)}` : `${x.mine ? '나' : x.who} · ${x.at ? relTime(x.at) : ''}`;
    $('#post-del').hidden = !(x.meal && x.mine);
    $('#post-img').src = x.img;
    $('#post-sum').textContent = String(x.summary || '');
    $('#post-text').textContent = String(x.text || '');
    $('#post-items').innerHTML = Array.isArray(x.items) ? x.items.slice(0, 15).map((it) => `<div><b>${escapeHtml(String(it.n || ''))}</b> <span>${escapeHtml(String(it.d || ''))}</span></div>`).join('') : '';
    $('#post-cheers').hidden = !!x.mine;
    $('#post-cmts').open = false;
    renderPostCmts();
    $('#post-modal').hidden = false;
    document.body.classList.add('modal-open');
  }
  /* ---- 💬 피드 댓글 (날개 펼쳐서 보기) ---- */
  const feedCmts = (pid) => pid ? Object.values(comments).flat().filter((c) => c.kind === 'fcmt' && c.ref === pid && members[c.from]).sort((a, b) => a.at - b.at) : [];
  const cmtBadge = (pid) => { const n = feedCmts(pid).length; return n ? `<i class="cmt-badge">💬 ${n}</i>` : ''; };
  function renderPostCmts() {
    const x = feedList[feedIdx];
    const box = $('#post-cmts');
    box.hidden = !x || !x.pid || !store;
    if (box.hidden) return;
    const list = feedCmts(x.pid);
    $('#post-cmt-n').textContent = list.length ? `댓글 ${list.length}개` : '댓글 달기';
    $('#post-cmt-peek').textContent = list.length ? `${nickOf(list[list.length - 1].from)}: ${String(list[list.length - 1].text).slice(0, 24)}` : '';
    $('#post-cmt-list').innerHTML = list.length ? list.map((c) => `<div class="pc-item">
        <b>${escapeHtml(c.from === myId ? '나' : nickOf(c.from))}</b><span>${escapeHtml(String(c.text))}</span>
        <small>${relTime(c.at)}</small>${c.from === myId ? `<button type="button" data-del="${escapeHtml(c.id)}" aria-label="댓글 삭제">✕</button>` : ''}
      </div>`).join('') : '<p class="pc-empty">첫 댓글을 남겨보세요</p>';
    $('#post-cmt-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      try { await store.doc(`comments/${myId}/items/${b.dataset.del}`).delete(); } catch { toast('삭제하지 못했어요'); }
    }));
  }
  $('#post-cmt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = feedList[feedIdx], inp = $('#post-cmt-text'), text = inp.value.trim();
    if (!x || !x.pid || !text || !store) return;
    const btn = $('#post-cmt-form button'); btn.disabled = true;
    try {
      await store.collection(`comments/${myId}/items`).add({ to: x.from, kind: 'fcmt', ref: x.pid, text: text.slice(0, 200), at: Date.now() });
      inp.value = '';
      $('#post-cmts').open = true;
    } catch (err) { toast(err && err.code === 'invalid_argument' ? '댓글 쓸 권한이 없어요' : '댓글을 올리지 못했어요'); }
    btn.disabled = false;
  });
  function closePost() { $('#post-modal').hidden = true; document.body.classList.remove('modal-open'); }
  $('#post-del').addEventListener('click', async () => {
    const x = feedList[feedIdx];
    if (!x || !x.meal || !x.mine) return;
    if (!(await askConfirm('이 식단 사진을 삭제할까요?', { okText: '삭제', danger: true }))) return;
    try { await store.doc(`comments/${myId}/items/${x.meal}`).delete(); closePost(); toast('삭제했어요'); } catch { toast('삭제하지 못했어요'); }
  });
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

  /* ---- 🍱 식단 피드 · 눈바디 피드 (피드 탭) ---- */
  const MEAL_KEEP_DAYS = 14;
  let feedKind = 'meal', mealRows = [], chatJump = true;
  function allMeals() {
    return Object.values(comments).flat().filter((c) => c.kind === 'meal' && members[c.from] && typeof c.img === 'string' && c.img.startsWith('data:image/')).sort((a, b) => b.at - a.at);
  }
  function renderFeed() {
    const ok = !!store && ready && !!myNick();
    $('#feed-off').hidden = ok;
    $('#feed-main').hidden = !ok;
    if (!ok) return;
    document.querySelectorAll('#feed-kind button').forEach((b) => b.classList.toggle('active', b.dataset.k === feedKind));
    $('#meal-box').hidden = feedKind !== 'meal';
    $('#photo-feed').hidden = feedKind !== 'body';
    $('#chat-box').hidden = feedKind !== 'chat';
    if (feedKind === 'chat') { renderChat(chatJump || window.scrollY < 40); chatJump = false; return; }
    chatJump = true;
    if (feedKind === 'body') { renderPhotoFeed(); return; }
    // 사람별로 묶고, 가장 최근에 올린 사람이 맨 위 · 사진은 옆으로 쌓이게
    const byWho = new Map();
    for (const c of allMeals()) { if (!byWho.has(c.from)) byWho.set(c.from, []); byWho.get(c.from).push(c); }
    const people = [...byWho.entries()];   // allMeals가 최신순이라 첫 등장 순서 = 최근 업데이트 순
    mealRows = people.map(([from, list]) => list.map((c) => ({ img: c.img, who: nickOf(from), from, date: c.date, summary: fmtDate(c.date), text: c.text, at: c.at, mine: from === myId, meal: c.id, pid: `${from}/${c.id}` })));
    $('#meal-grid').innerHTML = people.length ? people.map(([from, list], r) => `
      <div class="meal-row">
        <div class="meal-who"><b>${escapeHtml(from === myId ? '나' : nickOf(from))}</b><small>${relTime(list[0].at)} · ${list.length}장</small></div>
        <div class="meal-strip">${list.map((c, i) => `<button type="button" class="meal-cell" data-r="${r}" data-i="${i}">
          <img src="${c.img}" alt="" loading="lazy" />${cmtBadge(`${from}/${c.id}`)}
          <span>${escapeHtml(c.text || fmtDate(c.date))}</span>
        </button>`).join('')}</div>
      </div>`).join('') : '<p class="hint center">아직 올라온 식단이 없어요. 첫 식단을 올려보세요 🍱</p>';
    $('#meal-grid').querySelectorAll('.meal-cell').forEach((el) => el.addEventListener('click', () => { feedList = mealRows[+el.dataset.r]; openPost(+el.dataset.i); }));
  }
  document.querySelectorAll('#feed-kind button').forEach((b) => b.addEventListener('click', () => { feedKind = b.dataset.k; renderFeed(); }));
  $('#meal-add').addEventListener('click', () => $('#meal-file').click());
  $('#meal-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !store) return;
    const btn = $('#meal-add');
    btn.disabled = true; btn.querySelector('span').textContent = '올리는 중…';
    try {
      const img = await photos.shrink(file, 640, 75000);
      await store.collection(`comments/${myId}/items`).add({ to: '__meal', kind: 'meal', date: todayStr(), text: ($('#meal-text').value || '').trim().slice(0, 60), img, at: Date.now() });
      $('#meal-text').value = '';
      toast('🍱 식단을 올렸어요');
    } catch (err) {
      toast(err && err.code === 'invalid_argument' ? '올릴 권한이 없어요' : '사진을 올리지 못했어요');
    }
    btn.disabled = false; btn.querySelector('span').textContent = '식단 사진 올리기';
  });
  // 2주 지난 내 식단 사진은 자동 정리 (용량 관리)
  let mealCleaned = false;
  function cleanOldMeals() {
    if (mealCleaned || !store || !comments[myId]) return;
    mealCleaned = true;
    const cut = addDays(todayStr(), -MEAL_KEEP_DAYS);
    comments[myId].filter((c) => c.kind === 'meal' && c.date < cut).forEach((c) => { store.doc(`comments/${myId}/items/${c.id}`).delete().catch(() => {}); });
  }

  /* ---- 💬 운동톡방 (단톡방) ----
   * comments/{내id}/items 에 { to: '__chat', kind: 'chat', text, at } 로 저장 → 모두가 실시간으로 받음 */
  const CHAT_SEEN_KEY = 'gymlog.chatSeen';
  const CHAT_KEEP_DAYS = 30;
  const chatBoot = Date.now();
  const chatToasted = new Set();
  let chatCleaned = false, chatCount = 0;
  const chatSeen = () => { try { return +localStorage.getItem(CHAT_SEEN_KEY) || 0; } catch { return 0; } };
  function chatMsgs() {
    return Object.values(comments).flat().filter((c) => c.kind === 'chat' && members[c.from] && typeof c.text === 'string')
      .sort((a, b) => num(a.at) - num(b.at)).slice(-300);
  }
  function cleanOldChat() {
    if (chatCleaned || !store || !comments[myId]) return;
    chatCleaned = true;
    const cut = Date.now() - CHAT_KEEP_DAYS * 86400000;
    comments[myId].filter((c) => c.kind === 'chat' && num(c.at) < cut).forEach((c) => { store.doc(`comments/${myId}/items/${c.id}`).delete().catch(() => {}); });
  }
  function avaColor(id) { return `hsl(${hashStr(String(id)) % 360} 55% 58%)`; }
  /** 새 메시지 → 탭 점 + (톡방 밖이면) 토스트 */
  function chatTick() {
    const list = chatMsgs();
    if (inChat()) { renderChat(false); return; }
    const seen = chatSeen();
    const fresh = list.filter((c) => c.from !== myId && num(c.at) > seen);
    chatBadge(fresh.length);
    const pop = fresh.filter((c) => num(c.at) > chatBoot - 5000 && !chatToasted.has(c.id));
    pop.forEach((c) => chatToasted.add(c.id));
    const last = pop[pop.length - 1];
    if (last) toast(`💬 ${nickOf(last.from)}: ${last.text.slice(0, 40)}`);
  }
  const inChat = () => currentView() === 'feed' && feedKind === 'chat';
  /** 안 읽은 톡 개수 → 피드 탭 + 톡 버튼 숫자 (보면 사라짐) */
  function chatBadge(n) {
    const t = n > 99 ? '99+' : String(n);
    for (const id of ['#feed-badge', '#chat-badge']) { const el = $(id); el.textContent = t; el.hidden = !n; }
  }
  function renderChat(jump) {
    if (!store || !myId || !ready || !myNick()) return;
    const list = chatMsgs();
    try { localStorage.setItem(CHAT_SEEN_KEY, String(Date.now())); } catch { /* 없음 */ }
    chatBadge(0);
    list.forEach((c) => chatToasted.add(c.id));
    $('#chat-count').textContent = `${Object.values(members).filter((m) => m && m.nick).length}명`;
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    const changed = list.length !== chatCount;
    chatCount = list.length;
    const tm = (t) => { const d = new Date(t); const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const dayLabel = (t) => { const d = new Date(t); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`; };
    let html = '', prevDay = '';
    list.forEach((c, i) => {
      const at = num(c.at), day = toStr(new Date(at));
      if (day !== prevDay) { html += `<div class="chat-day"><span>${dayLabel(at)}</span></div>`; prevDay = day; }
      const prev = list[i - 1], next = list[i + 1];
      const first = !prev || prev.from !== c.from || toStr(new Date(num(prev.at))) !== day || at - num(prev.at) > 180000;
      const lastOfGroup = !next || next.from !== c.from || toStr(new Date(num(next.at))) !== day || num(next.at) - at > 180000 || tm(num(next.at)) !== tm(at);
      const mine = c.from === myId;
      const nk = nickOf(c.from);
      const bubble = `<div class="chat-bubble${c.share ? ' share' : ''}" ${mine ? `data-del="${escapeHtml(c.id)}"` : ''}>${escapeHtml(c.text)}</div>`;
      const time = lastOfGroup ? `<span class="chat-time">${tm(at)}</span>` : '';
      if (mine) html += `<div class="chat-row me${first ? ' first' : ''}">${time}${bubble}</div>`;
      else html += `<div class="chat-row${first ? ' first' : ''}">${first ? `<span class="chat-ava" style="background:${avaColor(c.from)}">${escapeHtml([...nk][0] || '?')}</span>` : '<span class="chat-ava ghost"></span>'}<div class="chat-col">${first ? `<span class="chat-nick">${escapeHtml(nk)}</span>` : ''}<div class="chat-line">${bubble}${time}</div></div></div>`;
    });
    $('#chat-list').innerHTML = html || '<p class="chat-empty">아직 조용해요. 첫 메시지를 보내보세요 💪</p>';
    $('#chat-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('이 메시지를 지울까요?')) return;
      try { await store.doc(`comments/${myId}/items/${b.dataset.del}`).delete(); } catch { toast('지우지 못했어요'); }
    }));
    if (jump || (changed && nearBottom)) requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: jump ? 'auto' : 'smooth' }));
  }
  async function sendChat(text, extra) {
    text = String(text || '').trim().slice(0, 300);
    if (!text || !store || !myId) return false;
    try { await store.collection(`comments/${myId}/items`).add({ to: '__chat', kind: 'chat', text, at: Date.now(), ...(extra || {}) }); return true; }
    catch { toast('메시지를 보내지 못했어요'); return false; }
  }
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#chat-text');
    const t = inp.value;
    if (!t.trim()) return;
    inp.value = '';
    if (!(await sendChat(t))) inp.value = t;
    inp.focus();
  });
  $('#chat-share').addEventListener('click', async () => {
    const d = todayStr(), list = (db[d] || []).filter((ex) => exerciseVolume(ex, d) !== 0 || ex.sets.some((st) => num(st.r) > 0 || num(st.min) > 0));
    if (!list.length) { toast('오늘 기록한 운동이 없어요'); return; }
    const lines = list.slice(0, 8).map((ex) => `· ${ex.name} ${fmtKg(Math.round(exerciseVolume(ex, d)))}`);
    const text = `💪 오늘 운동 기록\n총 ${fmtKg(Math.round(dayVolume(d)))}\n${lines.join('\n')}${list.length > 8 ? `\n외 ${list.length - 8}개` : ''}`;
    if (await sendChat(text, { share: 1 })) toast('오늘 운동을 톡방에 올렸어요');
  });

  /* ---- 운동 공유 ---- */
  let shareDate = null;
  function shareSummary(date) {
    const vol = dayVolume(date), goal = dailyGoal(date), g = gradeOf(vol, goal);
    const plan = planOf(date);
    const cardio = dayCardioVolume(date);
    return [fmtDate(date), plan.length ? plan.join('·') : '', fmtKg(vol), g ? g.label : '', cardio ? `(근력 ${fmtShort(vol - cardio) || 0} · 유산소 ${fmtShort(cardio)})` : ''].filter(Boolean).join(' · ');
  }
  async function openShare(date) {
    if (!store) { toast('공유는 공유 링크(claude.ai)에서 열었을 때 돼요'); return; }
    if (!myNick()) { toast('먼저 랭킹 탭에서 닉네임으로 참가해 주세요'); showView('rank'); return; }
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
  /** 친구의 그날 칭호 (공유 기록 기반, 기록 비공개면 볼륨만으로) */
  function titleOf(id, date) {
    const m = members[id];
    if (!m) return '';
    if (id === myId) return myTitle(date);
    const v = num((m.days || {})[date]) + num((m.cdays || {})[date]);
    const items = (m.log || {})[date];
    if (Array.isArray(items) && items.length) return titleFor(id, date, items);
    return titleFor(id, date, v > 0 ? [{ n: '', v, c: 0 }] : []);
  }
  function activeToday() {
    const t = todayStr();
    return Object.entries(members)
      .filter(([id]) => id !== myId)
      .map(([id, m]) => ({ nick: m.nick, v: num((m.days || {})[t]) + num((m.cdays || {})[t]) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
  }

  return { renderChat, init, publish, render, openShare, wasShared, activeToday, titleOf, setMode, mode: () => mode, id: () => myId, ready: () => ready,
    members: () => members, jailed: isJailed,
    // 🏠 각자 짐 메모: { 주인id: [{id, from, who, text, c, at, mine}] } (최신순)
    memos: () => {
      const out = {};
      for (const c of Object.values(comments).flat()) {
        if (c.kind !== 'memo' || !members[c.from] || !members[c.to]) continue;
        (out[c.to] ||= []).push({ id: c.id, from: c.from, who: c.from === myId ? '나' : nickOf(c.from), text: String(c.text || ''), c: c.c || 'y', at: num(c.at), mine: c.from === myId });
      }
      Object.values(out).forEach((l) => l.sort((a, b) => b.at - a.at));
      return out;
    },
    // 🙏 스쿼트 대불 기도: [{who, text, n, at, mine}] 최신순
    prayers: () => Object.values(comments).flat().filter((c) => c.kind === 'pray' && members[c.from])
      .map((c) => ({ id: c.id, who: c.from === myId ? '나' : nickOf(c.from), text: String(c.text || ''), n: num(c.n), at: num(c.at), mine: c.from === myId })).sort((a, b) => b.at - a.at),
    addPrayer: async (text, n) => { if (!store || !myId) throw new Error('no'); await store.collection(`comments/${myId}/items`).add({ to: '__pray', kind: 'pray', text: String(text).slice(0, 40), n, at: Date.now() }); },
    addMemo: async (to, text, c) => { if (!store || !myId) throw new Error('no'); await store.collection(`comments/${myId}/items`).add({ to, kind: 'memo', text: String(text).slice(0, 40), c, at: Date.now() }); },
    delMemo: async (id) => { await store.doc(`comments/${myId}/items/${id}`).delete(); }, me: () => members[myId], nick: () => myNick(), openProfile, renderFeed, live: (id) => isLive(id),
    focus: (id) => { try { return todayFocus(id); } catch { return null; } },
    send: async (to, text) => { if (!store || !myId) throw new Error('no'); await store.collection(`comments/${myId}/items`).add({ to, text, at: Date.now() }); } };
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

  // 앱이 열려 있는 동안 20초마다 확인 + 알림 시각에 앱이 열리면(단축어 자동화 등) 바로 확인
  setTimeout(check, 3500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(check, 2000); });
  setInterval(check, 20000);
  return { show, check };
})();

/* ---------- 📋 루틴 ---------- */
const routines = (() => {
  const KEY = 'gymlog.routines', DISMISS = 'gymlog.routineDismissed';
  let list = (() => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } })();
  let dismissed = (() => { try { return JSON.parse(localStorage.getItem(DISMISS)) || []; } catch { return []; } })();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} cloud.markDirty(); };
  const sig = (names) => [...new Set(names)].sort().join('|');
  const jac = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; A.forEach((x) => B.has(x) && i++); return i / (A.size + B.size - i || 1); };
  const cleanSets = (sets) => sets.map((x) => { const o = {}; for (const k of ['w', 'r', 'km', 'min', 'kcal', 'wkcal']) if (x[k] !== undefined && x[k] !== '') o[k] = x[k]; return o; });

  function partsName(names) {
    const cnt = {};
    names.forEach((n) => { const p = cardioInfo({ name: n }) ? '유산소' : partOf(n); cnt[p] = (cnt[p] || 0) + 1; });
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).join('·');
  }
  function fromDay(date, name) {
    const exs = (db[date] || []).filter((ex) => exerciseVolume(ex, date) > 0 || ex.sets.some((x) => num(x.w) || num(x.r)));
    return { id: uid(), name: name || `${partsName(exs.map((e) => e.name))} 루틴`, items: exs.map((ex) => ({ n: ex.name, sets: cleanSets(ex.sets) })) };
  }

  /* 한 달 기록에서 자주 하는 운동 조합 찾기 */
  function eligibility() {
    const days = Object.keys(db).filter((d) => dayVolume(d) > 0).sort();
    if (!days.length) return { ok: false, left: 30 };
    const span = Math.round((parse(todayStr()) - parse(days[0])) / 86400000);
    return { ok: span >= 28 && days.length >= 8, left: Math.max(0, 28 - span), days: days.length };
  }
  function suggest() {
    if (!eligibility().ok) return [];
    const from = addDays(todayStr(), -60);
    const days = Object.keys(db).filter((d) => d >= from && dayVolume(d) > 0).sort();
    const rows = days.map((d) => ({ d, names: [...new Set(db[d].filter((ex) => exerciseVolume(ex, d) > 0).map((ex) => ex.name))] })).filter((r) => r.names.length >= 2);
    const clusters = [];
    for (const r of rows) {
      let best = null, bs = 0;
      for (const c of clusters) { const sc = jac(r.names, c.core); if (sc > bs) { bs = sc; best = c; } }
      if (best && bs >= 0.5) { best.days.push(r); const cnt = {}; best.days.forEach((x) => x.names.forEach((n) => (cnt[n] = (cnt[n] || 0) + 1))); best.core = Object.keys(cnt).filter((n) => cnt[n] / best.days.length >= 0.5); }
      else clusters.push({ core: r.names, days: [r] });
    }
    return clusters.filter((c) => c.days.length >= 3 && c.core.length >= 2)
      .map((c) => {
        const pos = {}, cnt = {};
        c.days.forEach((x) => db[x.d].forEach((ex, i) => { if (c.core.includes(ex.name)) { pos[ex.name] = (pos[ex.name] || 0) + i; cnt[ex.name] = (cnt[ex.name] || 0) + 1; } }));
        const names = [...c.core].sort((a, b) => pos[a] / cnt[a] - pos[b] / cnt[b]);
        const lastDay = c.days[c.days.length - 1].d;
        return { id: 'sg-' + sig(names), name: `${partsName(names)} 루틴`, items: names.map((n) => ({ n, sets: cleanSets((db[lastDay].find((ex) => ex.name === n) || { sets: [] }).sets) })), times: c.days.length };
      })
      .filter((r) => !dismissed.includes(r.id) && !list.some((x) => jac(x.items.map((i) => i.n), r.items.map((i) => i.n)) >= 0.8))
      .sort((a, b) => b.times - a.times).slice(0, 3);
  }

  function apply(r) {
    if (isClosed(state.day)) { toast('마감된 날이에요. 다시 열기를 눌러주세요'); return; }
    const have = new Set((db[state.day] || []).map((e) => e.name));
    let n = 0;
    for (const it of r.items) {
      if (have.has(it.n)) continue;
      const e = makeEntry(it.n, it.sets);
      if (r.useLast === false && it.sets && it.sets.length) e.sets = it.sets.map((x) => ({ ...x }));
      (db[state.day] ||= []).push(e); n++;
    }
    save(); renderDay(); close();
    toast(n ? `📋 ${r.name} · 운동 ${n}개를 불러왔어요` : '이미 다 추가돼 있어요');
  }
  function open() { render(); $('#routine-modal').hidden = false; document.body.classList.add('modal-open'); }
  function close() { $('#routine-modal').hidden = true; document.body.classList.remove('modal-open'); }
  const itemsText = (r) => r.items.map((i) => escapeHtml(i.n)).join(' · ');
  function render() {
    const today = db[state.day] || [];
    $('#routine-save').hidden = !today.length;
    $('#routine-list').innerHTML = list.length ? list.map((r) => `<div class="rt-card" data-id="${r.id}">
        <div class="rt-main"><b>${escapeHtml(r.name)}</b><small>${r.items.length}개 · ${itemsText(r)}</small></div>
        <div class="rt-acts"><button type="button" class="rt-apply" data-act="apply">불러오기</button><button type="button" class="rt-del" data-act="edit" aria-label="수정"><svg class="i"><use href="#i-settings"/></svg></button><button type="button" class="rt-del" data-act="del" aria-label="삭제"><svg class="i"><use href="#i-trash"/></svg></button></div>
      </div>`).join('') : '<p class="empty-text">아직 저장한 루틴이 없어요</p>';
    const el = eligibility(), sg = suggest();
    $('#routine-suggest').innerHTML = !el.ok
      ? `<p class="rt-wait">운동 기록이 한 달 쌓이면 자주 하는 운동 조합으로 루틴을 추천해 드려요${el.left ? ` · D-${el.left}` : ''}</p>`
      : sg.length ? sg.map((r) => `<div class="rt-card sg" data-id="${r.id}">
          <div class="rt-main"><b>✦ ${escapeHtml(r.name)}</b><small>최근 ${r.times}번 함 · ${itemsText(r)}</small></div>
          <div class="rt-acts"><button type="button" class="rt-apply" data-act="keep">루틴으로 저장</button><button type="button" class="rt-del" data-act="skip" aria-label="추천 숨기기"><svg class="i"><use href="#i-x"/></svg></button></div>
        </div>`).join('') : '<p class="rt-wait">새로 추천할 루틴이 없어요. 자주 하는 조합은 이미 저장돼 있어요 👍</p>';
    document.querySelectorAll('#routine-modal .rt-card').forEach((c) => c.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      const id = c.dataset.id, act = b.dataset.act;
      if (act === 'apply') apply(list.find((x) => x.id === id));
      if (act === 'edit') builder.open(list.find((x) => x.id === id));
      if (act === 'del') { if (!(await askConfirm('이 루틴을 삭제할까요?', { okText: '삭제', danger: true }))) return; list = list.filter((x) => x.id !== id); persist(); render(); }
      if (act === 'keep') { const r = sg.find((x) => x.id === id); list.push({ id: uid(), name: r.name, items: r.items }); persist(); toast('루틴으로 저장했어요'); render(); renderNudge(); }
      if (act === 'skip') { dismissed.push(id); try { localStorage.setItem(DISMISS, JSON.stringify(dismissed)); } catch {} render(); renderNudge(); }
    })));
  }
  /* 일간 화면 추천 알림 */
  function renderNudge() {
    const el = $('#routine-nudge');
    if (!el) return;
    const sg = suggest();
    el.hidden = !sg.length || (db[state.day] || []).length > 0;
    if (!el.hidden) el.querySelector('span').textContent = `한 달 기록을 보니 자주 하는 조합이 ${sg.length}개 있어요. 루틴으로 만들어 볼까요?`;
  }
  $('#routine-btn').addEventListener('click', open);
  $('#routine-nudge').addEventListener('click', open);
  $('#routine-close').addEventListener('click', close);
  $('#routine-modal .rest-backdrop').addEventListener('click', close);
  $('#routine-save button').addEventListener('click', () => {
    const r = fromDay(state.day);
    if (!r.items.length) { toast('기록한 운동이 없어요'); return; }
    const name = ($('#routine-name').value || '').trim().slice(0, 20);
    if (name) r.name = name;
    list.push(r); persist(); $('#routine-name').value = '';
    toast(`📋 "${r.name}" 저장했어요`); render();
  });
  /* ---- 직접 만들기 / 수정 ---- */
  const builder = (() => {
    let draft = null, part = '전체';
    const isCardioName = (n) => !!(typeof CARDIO !== 'undefined' && CARDIO[n]);
    function open(r) {
      draft = r ? JSON.parse(JSON.stringify(r)) : { id: null, name: '', useLast: true, items: [] };
      if (draft.useLast === undefined) draft.useLast = true;
      draft.items.forEach((it) => { if (!it.sets || !it.sets.length) it.sets = [isCardioName(it.n) ? { min: '' } : { w: '', r: '10' }]; });
      part = '전체';
      $('#rb-name').value = draft.name || '';
      $('#rb-uselast').checked = draft.useLast;
      $('#rb-search').value = '';
      $('#rb-title').textContent = r ? '루틴 수정' : '루틴 직접 만들기';
      $('#rb-modal').hidden = false; document.body.classList.add('modal-open');
      renderParts(); renderResults(); renderItems();
    }
    function close() { $('#rb-modal').hidden = true; if ($('#routine-modal').hidden) document.body.classList.remove('modal-open'); }
    function renderParts() {
      $('#rb-parts').innerHTML = ['전체', ...EXERCISE_PARTS].map((p) => `<button type="button" class="chip ${p === part ? 'active' : ''}" data-p="${p}">${p}</button>`).join('');
      $('#rb-parts').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { part = b.dataset.p; renderParts(); renderResults(); }));
    }
    function renderResults() {
      const q = $('#rb-search').value.trim();
      const have = new Set(draft.items.map((i) => i.n));
      const res = EXERCISES.filter((e) => part === '전체' || e.part === part)
        .map((e) => ({ e, sc: matchScore(e, q) })).filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc).slice(0, q ? 12 : 8);
      $('#rb-results').innerHTML = res.map(({ e }) => `<button type="button" class="rb-res ${have.has(e.name) ? 'on' : ''}" data-n="${escapeHtml(e.name)}"><span>${escapeHtml(e.name)}<small>${e.part}</small></span><b>${have.has(e.name) ? '✓' : '+'}</b></button>`).join('')
        || '<p class="rt-wait">검색 결과가 없어요</p>';
      $('#rb-results').querySelectorAll('.rb-res').forEach((b) => b.addEventListener('click', () => {
        const n = b.dataset.n;
        if (draft.items.some((i) => i.n === n)) draft.items = draft.items.filter((i) => i.n !== n);
        else {
          const last = findLastExercise(n, addDays(todayStr(), 1));
          const sets = last ? last.sets.map((x) => ({ ...x })) : isCardioName(n) ? [{ min: '30' }] : [1, 2, 3].map(() => ({ w: '', r: '10' }));
          draft.items.push({ n, sets });
        }
        renderResults(); renderItems();
      }));
    }
    function renderItems() {
      $('#rb-count').textContent = draft.items.length ? `${draft.items.length}개` : '';
      $('#rb-items').innerHTML = draft.items.length ? draft.items.map((it, i) => {
        const c = isCardioName(it.n), f = it.sets[0] || {};
        return `<div class="rb-item" data-i="${i}">
          <div class="rb-top"><b>${i + 1}. ${escapeHtml(it.n)}</b>
            <span class="rb-move"><button type="button" data-a="up" aria-label="위로">↑</button><button type="button" data-a="down" aria-label="아래로">↓</button><button type="button" data-a="rm" aria-label="빼기">✕</button></span></div>
          <div class="rb-opts">${c
            ? `<label>시간 <input type="text" inputmode="numeric" data-k="min" value="${escapeHtml(String(f.min ?? ''))}" placeholder="30" />분</label>`
            : `<span class="rb-step"><button type="button" data-a="minus">−</button><em>${it.sets.length}세트</em><button type="button" data-a="plus">+</button></span>
               <label><input type="text" inputmode="decimal" data-k="w" value="${escapeHtml(String(f.w ?? ''))}" placeholder="0" />kg</label>
               <label><input type="text" inputmode="numeric" data-k="r" value="${escapeHtml(String(f.r ?? ''))}" placeholder="10" />회</label>`}
          </div></div>`;
      }).join('') : '<p class="rt-wait">위에서 운동을 골라 추가하세요</p>';
      $('#rb-items').querySelectorAll('.rb-item').forEach((row) => {
        const i = +row.dataset.i, it = draft.items[i];
        row.querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', () => {
          const a = b.dataset.a;
          if (a === 'up' && i > 0) [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]];
          if (a === 'down' && i < draft.items.length - 1) [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]];
          if (a === 'rm') draft.items.splice(i, 1);
          if (a === 'plus' && it.sets.length < 10) it.sets.push({ ...it.sets[it.sets.length - 1] });
          if (a === 'minus' && it.sets.length > 1) it.sets.pop();
          renderItems(); renderResults();
        }));
        row.querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
          const k = inp.dataset.k, v = inp.value.replace(/[^0-9.]/g, '');
          it.sets.forEach((x) => { x[k] = v; });   // 모든 세트에 같은 값
        }));
      });
    }
    $('#rb-search').addEventListener('input', renderResults);
    $('#rb-close').addEventListener('click', close);
    $('#rb-modal .rest-backdrop').addEventListener('click', close);
    $('#rb-save').addEventListener('click', () => {
      if (!draft.items.length) { toast('운동을 하나 이상 골라주세요'); return; }
      draft.name = ($('#rb-name').value || '').trim().slice(0, 20) || `${partsName(draft.items.map((i) => i.n))} 루틴`;
      draft.useLast = $('#rb-uselast').checked;
      const items = draft.items.map((it) => ({ n: it.n, sets: cleanSets(it.sets) }));
      if (draft.id) list = list.map((x) => (x.id === draft.id ? { ...x, name: draft.name, useLast: draft.useLast, items } : x));
      else list.push({ id: uid(), name: draft.name, useLast: draft.useLast, items });
      persist(); close(); render();
      toast(`📋 "${draft.name}" 저장했어요`);
    });
    return { open };
  })();
  $('#routine-new').addEventListener('click', () => builder.open(null));

  function restore(remote) {
    const ids = new Set(list.map((x) => x.id));
    let changed = false;
    for (const r of remote) if (r && r.id && !ids.has(r.id)) { list.push(r); changed = true; }
    if (changed) try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  }
  return { list: () => list, restore, renderNudge };
})();
routines.renderNudge();

cloud.init();
// 로그인 안 된 상태(카톡 인앱 브라우저 등)면 참가 안내
setTimeout(() => {
  let ok = false;
  try { ok = !!social.id(); } catch {}
  $('#login-banner').hidden = ok;
}, 9000);

/* ---------- 🎉 이벤트 배경 ---------- */
(() => {
  const KEY = 'gymlog.eventBg';
  // 하루 한정 이벤트 배경 (날짜 → 사진) — 그날만 적용, 다음 날 원래 디자인
  const EVENTS = { '2026-11-02': 'event-bg.jpg', '2026-11-03': 'event-bg2.jpg', '2026-11-04': 'event-bg3.jpg', '2026-11-05': 'event-bg4.jpg', '2026-11-06': 'event-bg5.jpg', '2026-11-07': 'event-bg6.jpg' };
  let on = true;
  try { on = localStorage.getItem(KEY + '.' + todayStr()) !== 'off'; } catch {}
  const live = () => !!EVENTS[todayStr()];
  const apply = () => {
    if (live()) document.body.style.setProperty('--event-img', `url("${EVENTS[todayStr()]}")`);
    document.body.classList.toggle('event-bg', on && live());
    $('#event-on').checked = on;
    $('#event-on').closest('.panel').hidden = !live();
  };
  setInterval(() => { if (document.body.classList.contains('event-bg') && !live()) apply(); }, 60000);
  $('#event-on').addEventListener('change', (e) => {
    on = e.target.checked;
    try { localStorage.setItem(KEY + '.' + todayStr(), on ? 'on' : 'off'); } catch {}
    apply();
  });
  apply();
})();
