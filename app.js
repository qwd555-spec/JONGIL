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
function save() {
  // 빈 날짜는 정리
  for (const k of Object.keys(db)) if (!db[k] || db[k].length === 0) delete db[k];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}
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
function setVolume(set) { return num(set.w) * num(set.r); }
function exerciseVolume(ex) { return ex.sets.reduce((a, s) => a + setVolume(s), 0); }
function dayVolume(date) { return (db[date] || []).reduce((a, ex) => a + exerciseVolume(ex), 0); }
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
        e.volume += setVolume(s);
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
  render();
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

$('#add-exercise-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#exercise-name');
  const name = input.value.trim();
  if (!name) return;
  // 마지막으로 했던 같은 운동의 세트를 기본값으로 불러오기
  const last = findLastExercise(name, state.day);
  const sets = last ? last.sets.map((s) => ({ ...s })) : [{ w: '', r: '' }];
  (db[state.day] ||= []).push({ id: uid(), name, sets });
  save();
  input.value = '';
  renderDay();
});

function findLastExercise(name, beforeDate) {
  const dates = Object.keys(db).filter((d) => d < beforeDate).sort().reverse();
  for (const d of dates) {
    const ex = db[d].find((e) => e.name === name);
    if (ex) return ex;
  }
  return null;
}

function allExerciseNames() {
  const set = new Set();
  for (const list of Object.values(db)) for (const ex of list) set.add(ex.name);
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
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
    const volEl = node.querySelector('.exercise-volume');
    const tbody = node.querySelector('tbody');

    const refreshTotals = () => {
      volEl.textContent = fmtKg(exerciseVolume(ex));
      updateDaySummary();
    };

    ex.sets.forEach((set, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><input type="number" inputmode="decimal" min="0" step="0.5" value="${set.w}" data-k="w" /></td>
        <td><input type="number" inputmode="numeric" min="0" step="1" value="${set.r}" data-k="r" /></td>
        <td class="vol">${fmtShort(setVolume(set)) || '-'}</td>
        <td><button class="del-set" title="세트 삭제">✕</button></td>`;
      const volTd = tr.querySelector('.vol');
      tr.querySelectorAll('input').forEach((inp) =>
        inp.addEventListener('input', () => {
          set[inp.dataset.k] = inp.value === '' ? '' : +inp.value;
          volTd.textContent = fmtShort(setVolume(set)) || '-';
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

    node.querySelector('.delete-exercise').addEventListener('click', () => {
      if (!confirm(`"${ex.name}" 운동을 삭제할까요?`)) return;
      db[state.day] = list.filter((e) => e !== ex);
      save();
      renderDay();
    });

    refreshTotals();
    container.appendChild(node);
  });

  $('#day-empty').style.display = list.length ? 'none' : 'block';
  $('#exercise-list').innerHTML = allExerciseNames().map((n) => `<option value="${escapeHtml(n)}">`).join('');
  updateDaySummary();
}

function updateDaySummary() {
  const list = db[state.day] || [];
  const total = dayVolume(state.day);
  $('#day-total').textContent = fmtKg(total);
  const sets = list.reduce((a, ex) => a + ex.sets.length, 0);
  const label = state.day === todayStr() ? '오늘' : fmtDate(state.day);
  document.querySelector('#view-day .summary-label').textContent = `${label} 총 볼륨`;
  $('#day-sub').textContent = list.length ? `운동 ${list.length}개 · ${sets}세트` : '';
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
    const alpha = v ? 0.25 + 0.75 * (v / max) : 0;
    const bg = v ? `background: rgba(34,197,94,${alpha.toFixed(2)});` : '';
    const col = (lead + i) % 7;
    html += `
      <div class="cal-cell ${d === today ? 'today' : ''}" data-date="${d}" style="${bg}">
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
      <span>${i + 1}주차 <small class="hint">${fmtDate(w.dates[0])} ~ ${fmtDate(w.dates[w.dates.length - 1])}</small></span>
      <span>${fmtKg(rangeVolume(w.dates))}</span>
    </div>`).join('');

  $('#month-breakdown').innerHTML = breakdownHtml(stats);
}

/* ---------- 공통 ---------- */
function breakdownHtml(stats) {
  const entries = Object.entries(stats.byEx).sort((a, b) => b[1].volume - a[1].volume);
  if (!entries.length) return '<p class="empty">기록이 없어요.</p>';
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
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#export-btn').addEventListener('click', () => {
  download(`gymlog-${todayStr()}.json`, JSON.stringify(db, null, 2), 'application/json');
});

$('#export-csv-btn').addEventListener('click', () => {
  const rows = [['날짜', '운동', '세트', '무게(kg)', '횟수', '볼륨']];
  for (const d of Object.keys(db).sort()) {
    for (const ex of db[d]) {
      ex.sets.forEach((s, i) => rows.push([d, ex.name, i + 1, num(s.w), num(s.r), setVolume(s)]));
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
    for (const [k, v] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v)) throw new Error('형식 오류');
    }
    if (!confirm('가져온 데이터로 기존 기록을 덮어쓸까요?')) return;
    db = data;
    save();
    alert('가져오기 완료!');
    render();
  } catch (err) {
    alert('파일을 읽을 수 없어요: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

$('#reset-btn').addEventListener('click', () => {
  if (!confirm('정말 모든 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
  db = {};
  save();
  render();
});

render();
