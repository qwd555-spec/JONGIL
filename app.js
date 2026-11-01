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
          if (body.bodyweight && typeof body.bodyweight === 'object') bwMap = { ...bwMap, ...body.bodyweight };
          syncedSettings = JSON.stringify({ restSeconds: body.restSeconds || 60, bodyweight: body.bodyweight || {} });
        }
      }
      for (const [k, v] of Object.entries(remote)) synced[k] = JSON.stringify(v);
      // 클라우드 기록 우선, 이 브라우저에만 있던 날짜는 클라우드로 올림
      Object.assign(db, remote);
      col = c;
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
      const st = JSON.stringify({ restSeconds: restSeconds(), bodyweight: bwMap });
      if (st !== syncedSettings) { await col.doc('settings').set(JSON.parse(st)); syncedSettings = st; }
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
function setVolume(set, ex, date) {
  const w = num(set.w), r = num(set.r);
  const type = bwType(ex);
  if (!type) return w * r;
  const bw = bodyweightOn(date);
  if (type === 'assist') return Math.max(0, bw - w) * r;
  return (bw + w) * r;
}
function exerciseVolume(ex, date) { return ex.sets.reduce((a, s) => a + setVolume(s, ex, date), 0); }
function dayVolume(date) { return (db[date] || []).reduce((a, ex) => a + exerciseVolume(ex, date), 0); }
function rangeVolume(dates) { return dates.reduce((a, d) => a + dayVolume(d), 0); }

function rangeStats(dates) {
  const byEx = {};
  let sets = 0, reps = 0, days = 0;
  for (const d of dates) {
    const list = db[d] || [];
    if (list.some((ex) => ex.sets.length)) days++;
    for (const ex of list) {
      const e = (byEx[ex.name] ||= { volume: 0, sets: 0, reps: 0 });
      for (const s of ex.sets) {
        e.volume += setVolume(s, ex, d);
        e.sets++;
        e.reps += num(s.r);
        sets++;
        reps += num(s.r);
      }
    }
  }
  return { total: rangeVolume(dates), byEx, sets, reps, days };
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
const PAGE_TITLES = { day: 'Today', week: 'Weekly', month: 'Monthly', settings: 'Settings' };
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
  // 마지막으로 했던 같은 운동의 세트를 기본값으로 불러오기
  const last = findLastExercise(name, state.day);
  const sets = last ? last.sets.map((s) => ({ ...s })) : [{ w: '', r: '' }];
  (db[state.day] ||= []).push({ id: uid(), name, sets });
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
  const parts = ['전체', '최근', ...EXERCISE_PARTS, '내 운동'];
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
  let pool = [...EXERCISES, ...custom];

  if (picker.part === '최근') pool = pool.filter((e) => usage[e.name]);
  else if (picker.part === '내 운동') pool = pool.filter((e) => e.custom);
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

function renderDay() {
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
    const isCatalog = EXERCISES.some((e) => e.name === ex.name);
    const chip = node.querySelector('.bw-chip');
    if (type || !isCatalog) {
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
    const tbody = node.querySelector('tbody');

    const refreshTotals = () => {
      volEl.textContent = fmtKg(exerciseVolume(ex, state.day));
      updateDaySummary();
    };

    ex.sets.forEach((set, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="set-no">${i + 1}</span></td>
        <td><input type="number" inputmode="decimal" min="0" step="0.5" value="${set.w}" data-k="w" /></td>
        <td><input type="number" inputmode="numeric" min="0" step="1" value="${set.r}" data-k="r" /></td>
        <td class="vol">${fmtShort(setVolume(set, ex, state.day)) || '-'}</td>
        <td><button class="del-set" title="세트 삭제" aria-label="세트 삭제"><svg class="i"><use href="#i-x"/></svg></button></td>`;
      const volTd = tr.querySelector('.vol');
      tr.querySelectorAll('input').forEach((inp) =>
        inp.addEventListener('input', () => {
          set[inp.dataset.k] = inp.value === '' ? '' : +inp.value;
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
    });

    node.querySelector('.add-set').addEventListener('click', () => {
      const prev = ex.sets[ex.sets.length - 1];
      ex.sets.push(prev ? { ...prev } : { w: '', r: '' });
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
  if (!resultsEl.hidden) renderResults();
  updateDaySummary();
}

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
function updateDaySummary() {
  updateBwRow();
  const list = db[state.day] || [];
  const total = dayVolume(state.day);
  $('#day-total').textContent = fmtKg(total);
  const sets = list.reduce((a, ex) => a + ex.sets.length, 0);
  const label = state.day === todayStr() ? '오늘' : fmtDate(state.day);
  document.querySelector('#view-day .summary-label').textContent = `${label} 총 볼륨`;
  $('#day-sub').textContent = list.length ? `운동 ${list.length}개 · ${sets}세트` : '';
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
  ].filter(Boolean).join('<br />');

  const vols = dates.map(dayVolume);
  const max = Math.max(...vols, 1);
  const today = todayStr();
  $('#week-chart').innerHTML = dates.map((d, i) => `
    <div class="bar-col ${d === today ? 'today' : ''}" data-date="${d}">
      <div class="bar-val">${fmtShort(vols[i])}</div>
      <div class="bar-track"><div class="bar ${vols[i] ? '' : 'zero'}" style="height:${(vols[i] / max) * 100}%"></div></div>
      <div class="bar-label">${WEEKDAYS[i]}</div>
    </div>`).join('');
  $('#week-chart').querySelectorAll('.bar-col').forEach((c) =>
    c.addEventListener('click', () => goToDay(c.dataset.date))
  );

  $('#week-parts').innerHTML = partsHtml(stats);
  $('#week-breakdown').innerHTML = breakdownHtml(stats);
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
    diffText(stats.total, prevTotal, '지난달'),
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
  $('#month-breakdown').innerHTML = breakdownHtml(stats);
}

/* ---------- 공통 ---------- */
function breakdownHtml(stats) {
  const entries = Object.entries(stats.byEx).sort((a, b) => b[1].volume - a[1].volume);
  if (!entries.length) return '<p class="empty-text">기록이 없어요</p>';
  const max = Math.max(...entries.map(([, e]) => e.volume), 1);
  return entries.map(([name, e]) => `
    <div class="breakdown-row">
      <div class="breakdown-top">
        <span>${escapeHtml(name)} <span class="meta">${e.sets}세트 · ${e.reps}회</span></span>
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
  const rows = [['날짜', '운동', '세트', '무게(kg)', '횟수', '볼륨']];
  for (const d of Object.keys(db).sort()) {
    for (const ex of db[d]) {
      ex.sets.forEach((s, i) => rows.push([d, ex.name, i + 1, num(s.w), num(s.r), setVolume(s, ex, d)]));
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
cloud.init();
