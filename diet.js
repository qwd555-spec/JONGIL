/* 🥗 식단 기록 (칼로리 · 탄단지) — 제대로 할 사람만 켜서 쓰는 개인 기록. 친구에게 공유되지 않음 */
window.diet = (() => {
  const KEY = 'gymlog.diet';
  const SLOTS = ['아침', '점심', '저녁', '간식'];
  const SLOT_ICON = { '아침': '🌅', '점심': '☀️', '저녁': '🌙', '간식': '🍪' };
  // 이름|1인분 기준|kcal|탄수(g)|단백질(g)|지방(g) — 식약처 식품영양성분DB 기준 평균값을 정리한 칼로리표 등 참고 (±10~15%)
  const FOODS = `흰쌀밥|1공기 210g|315|69|6|1
현미밥|1공기 210g|305|64|7|2
잡곡밥|1공기 210g|310|66|7|2
햇반 작은공기|130g|195|43|4|1
닭가슴살(삶은)|100g|110|0|23|1
닭가슴살 스테이크|1팩 100g|130|4|20|3
훈제 닭가슴살|1팩 100g|115|2|22|2
계란(삶은)|1개 50g|75|1|6|5
계란 프라이|1개|95|0|6|7
계란 흰자|1개|17|0|4|0
스크램블에그|계란 2개|200|2|13|15
두부|1/2모 150g|125|3|13|7
소고기 우둔|100g|140|0|22|5
소고기 등심|100g|250|0|19|19
삼겹살|100g|330|0|17|29
목살|100g|240|0|19|18
돼지 안심|100g|125|0|22|4
연어|100g|200|0|20|13
참치캔(살코기)|1캔 100g|120|0|26|1
고등어구이|1토막 100g|230|0|20|16
새우|100g|95|0|20|1
프로틴 쉐이크|1스쿱 30g|120|3|24|1.5
그릭요거트|100g|95|4|9|5
플레인 요거트|100g|60|5|4|3
우유|1컵 200ml|130|10|6|7
저지방 우유|1컵 200ml|90|10|6|2
두유|1팩 190ml|130|10|7|7
아몬드|한줌 20g|115|4|4|10
땅콩버터|1스푼 15g|90|3|4|8
바나나|1개|90|23|1|0
사과|1개|110|29|0|0
고구마|1개 150g|190|45|2|0
감자|1개 150g|115|26|3|0
오트밀|40g|150|27|5|3
그래놀라|40g|180|27|4|6
식빵|1장|80|15|3|1
통밀빵|1장|75|13|4|1
베이글|1개|270|53|10|2
샐러드(드레싱 포함)|1접시|150|10|3|11
닭가슴살 샐러드|1접시|250|12|25|11
김치|1접시 50g|15|2|1|0
김밥|1줄 230g|480|75|13|13
참치김밥|1줄|450|55|14|19
라면|1봉 120g|500|79|10|16
짜장면|1그릇 700g|700|115|19|18
짬뽕|1그릇 700g|600|85|26|17
탕수육|1인분 200g|500|52|18|24
비빔밥|1그릇 500g|580|88|18|16
돌솥비빔밥|1그릇|600|88|18|18
김치찌개|1인분 450g|290|13|20|17
된장찌개|1인분|150|11|11|7
순두부찌개|1인분|240|11|17|14
부대찌개|1인분|450|35|20|25
제육볶음|1인분 200g|420|15|28|27
불고기|1인분 200g|370|18|30|19
닭갈비|1인분 250g|450|25|35|22
삼계탕|1그릇|900|45|80|42
갈비탕|1그릇|500|20|40|28
설렁탕|1그릇|430|38|30|15
국밥(돼지)|1그릇|600|60|35|22
냉면|1그릇|560|110|15|5
칼국수|1그릇|520|90|17|9
우동|1그릇|430|80|12|5
떡볶이|1인분 300g|510|107|11|4
순대|1인분 150g|300|40|12|10
어묵|2꼬치|110|13|8|3
튀김(모둠)|3개|300|30|5|18
돈까스|1인분 200g|520|42|21|29
치즈돈까스|1인분|850|62|36|50
카레라이스|1그릇|650|100|15|20
오므라이스|1그릇|700|95|20|25
볶음밥|1그릇|650|90|15|25
초밥|10피스|500|85|25|5
회(광어)|200g|190|0|40|3
후라이드치킨|1마리|1900|70|130|120
양념치킨|1마리|2200|130|120|130
후라이드치킨 1조각|1조각|250|9|17|16
허니콤보(교촌)|1마리|1920|84|114|126
허니콤보(교촌) 100g|100g|320|14|19|21
삼겹살 1인분|200g|660|0|34|58
치킨너겟|5조각|250|15|12|16
피자|1조각|300|33|13|13
햄버거|1개|500|45|25|25
불고기버거|1개|450|50|16|20
감자튀김|M|340|44|4|16
핫도그|1개|300|25|10|18
샌드위치|1개|380|40|18|16
서브웨이 터키 15cm|1개|280|46|18|4
편의점 도시락|1개|750|100|25|25
삼각김밥|1개|190|38|4|2
컵라면|1개|300|43|7|11
만두|6개|300|35|12|12
떡|100g|240|53|4|0
빵(크림빵)|1개|330|45|7|14
도넛|1개|260|30|4|14
케이크|1조각|350|40|5|19
아이스크림|1개|200|25|3|10
초콜릿|1개 40g|220|24|3|13
과자(감자칩)|1봉 60g|330|32|4|21
아메리카노|1잔|10|1|1|0
카페라떼|1잔 355ml|180|15|10|9
바닐라라떼|1잔 355ml|250|35|9|8
콜라|1캔 355ml|150|39|0|0
제로콜라|1캔|0|0|0|0
맥주|1캔 500ml|230|18|2|0
소주|1병|400|0|0|0
막걸리|1병 750ml|350|28|5|0
에너지바|1개|200|25|8|8
단백질바|1개|200|20|20|7
토마토|1개|35|7|1|0
방울토마토|10개|30|6|1|0
브로콜리|100g|35|7|3|0
아보카도|1/2개|120|6|1|11
포도|1컵|100|27|1|0
귤|1개|40|10|1|0`.split('\n').map((l) => { const [n, u, k, c, p, f] = l.split('|'); return { n, u, k: +k, c: +c, p: +p, f: +f }; });

  const blank = () => ({ on: false, goal: { kcal: 0, p: 0 }, days: {}, custom: [], recent: [] });
  let D = (() => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return blank(); } })();
  let day = todayStr(), addSlot = null, pick = null, qty = 1;
  const $d = (sel) => document.querySelector(sel);
  const r1 = (v) => Math.round(v * 10) / 10;

  function persist() {
    // 120일 넘은 기록은 정리
    const cut = addDays(todayStr(), -120);
    for (const k of Object.keys(D.days)) if (k < cut) delete D.days[k];
    D.at = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(D)); } catch {}
    try { cloud.markDirty(); } catch {}
  }
  function restore(remote) {
    if (!remote || typeof remote !== 'object') return;
    if (num(remote.at) >= num(D.at)) { D = { ...blank(), ...remote }; try { localStorage.setItem(KEY, JSON.stringify(D)); } catch {} }
    if (!$d('#diet-box').hidden) render();
  }
  const goal = () => {
    const bw = bodyweightOn(todayStr()) || 70;
    return { kcal: num(D.goal.kcal) || Math.round((bw * 33) / 10) * 10, p: num(D.goal.p) || Math.round(bw * 1.6) };
  };
  const dayData = (d) => D.days[d] || {};
  function totals(d) {
    const t = { k: 0, c: 0, p: 0, f: 0 };
    for (const s of SLOTS) for (const it of dayData(d)[s] || []) { t.k += it.k * it.q; t.c += it.c * it.q; t.p += it.p * it.q; t.f += it.f * it.q; }
    return t;
  }

  /* ---------- 화면 ---------- */
  /* 식단 기록은 피드 안 [🥗 식단 기록] 칸에 그대로 펼쳐 둠 */
  const sheet = $d('#diet-modal .diet-sheet');
  if (sheet && $d('#diet-box')) { $d('#diet-box').appendChild(sheet); sheet.classList.add('inline'); }
  function open() { day = todayStr(); if (typeof social !== 'undefined' && social.openDiet) social.openDiet(); else render(); }
  function renderInline() { render(); }
  function close() { closeAdd(); }
  function render() {
    $d('#diet-intro').hidden = !!D.on;
    $d('#diet-main').hidden = !D.on;
    if (!D.on) {
      const g = goal();
      $d('#diet-goal-k').value = g.kcal; $d('#diet-goal-p').value = g.p;
      return;
    }
    const g = goal(), t = totals(day);
    const cG = Math.round((g.kcal * 0.5) / 4), fG = Math.round((g.kcal * 0.25) / 9);
    $d('#diet-date').textContent = day === todayStr() ? '오늘' : fmtDate(day);
    $d('#diet-next').disabled = day >= todayStr();
    $d('#diet-kcal').textContent = Math.round(t.k).toLocaleString();
    $d('#diet-goal').textContent = `/ ${g.kcal.toLocaleString()} kcal`;
    const pct = Math.min(1.25, t.k / g.kcal);
    $d('#diet-bar i').style.width = `${Math.min(100, pct * 100)}%`;
    $d('#diet-bar').classList.toggle('over', t.k > g.kcal);
    $d('#diet-left').textContent = t.k > g.kcal ? `${Math.round(t.k - g.kcal).toLocaleString()} kcal 초과` : `${Math.round(g.kcal - t.k).toLocaleString()} kcal 남음`;
    const mac = [['탄수화물', t.c, cG, 'c'], ['단백질', t.p, g.p, 'p'], ['지방', t.f, fG, 'f']];
    $d('#diet-macros').innerHTML = mac.map(([n, v, gg, k]) => `<div class="dm ${k}"><small>${n}</small><b>${r1(v)}<i>g</i></b><span>/${gg}g</span><em style="--w:${Math.min(100, (v / gg) * 100)}%"></em></div>`).join('');
    const kc = t.c * 4 + t.p * 4 + t.f * 9 || 1;
    $d('#diet-ratio').innerHTML = `<i class="c" style="flex:${t.c * 4 / kc}"></i><i class="p" style="flex:${t.p * 4 / kc}"></i><i class="f" style="flex:${t.f * 9 / kc}"></i>`;
    $d('#diet-ratio-txt').textContent = t.k ? `탄 ${Math.round((t.c * 400) / kc)}% · 단 ${Math.round((t.p * 400) / kc)}% · 지 ${Math.round((t.f * 900) / kc)}%` : '아직 먹은 게 없어요';
    $d('#diet-meals').innerHTML = SLOTS.map((s) => {
      const list = dayData(day)[s] || [];
      const k = list.reduce((a, it) => a + it.k * it.q, 0);
      return `<div class="dmeal">
        <div class="dmeal-head"><span class="dmeal-ic">${SLOT_ICON[s]}</span><b>${s}</b><small>${k ? `${Math.round(k).toLocaleString()} kcal` : ''}</small><button type="button" data-add="${s}" aria-label="${s} 추가">＋</button></div>
        ${list.map((it, i) => `<div class="dfood"><span>${escapeHtml(it.n)} <small>${it.q !== 1 ? `×${it.q}` : ''}${it.ai ? ' 📷AI' : ''}</small></span><em>${Math.round(it.k * it.q)} kcal</em><button type="button" data-del="${s}|${i}" aria-label="삭제">✕</button></div>`).join('')}
      </div>`;
    }).join('');
    $d('#diet-meals').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openAdd(b.dataset.add)));
    $d('#diet-meals').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const [s, i] = b.dataset.del.split('|'); const dd = D.days[day]; if (!dd || !dd[s]) return;
      dd[s].splice(+i, 1); persist(); render();
    }));
  }

  /* ---------- 📤 정리한 식단을 피드에 ---------- */
  $d('#diet-share').addEventListener('click', async () => {
    const t = totals(day);
    if (!(t.k > 0)) { toast('이 날 기록한 음식이 없어요'); return; }
    const meals = SLOTS.map((s) => {
      const list = dayData(day)[s] || [];
      return { s, k: Math.round(list.reduce((a, it) => a + it.k * it.q, 0)), items: list.slice(0, 15).map((it) => ({ n: String(it.n).slice(0, 30), q: it.q, k: Math.round(it.k * it.q) })) };
    }).filter((m) => m.items.length);
    const diet = { date: day, k: Math.round(t.k), c: Math.round(t.c), p: Math.round(t.p), f: Math.round(t.f), g: goal().kcal, meals };
    const btn = $d('#diet-share'); btn.disabled = true;
    try { if (await social.postDiet(diet)) toast('📤 식단을 피드에 올렸어요'); }
    catch { toast('올리지 못했어요'); }
    btn.disabled = false;
  });

  /* ---------- 음식 추가 ---------- */
  function openAdd(slot) {
    addSlot = slot; pick = null;
    $d('#diet-add').hidden = false; sheet.classList.add('adding'); window.scrollTo({ top: 0 }); $d('#diet-add-title').textContent = `${SLOT_ICON[slot]} ${slot}에 추가`;
    $d('#diet-q').value = ''; $d('#diet-qty').hidden = true; $d('#diet-custom').hidden = true; $d('#diet-ai').hidden = true; aiItems = [];
    ['#dc-n', '#dc-u', '#dc-k', '#dc-c', '#dc-p', '#dc-f'].forEach((k) => { $d(k).value = ''; });
    search(); setTimeout(() => $d('#diet-q').focus(), 200);
  }
  function closeAdd() { $d('#diet-add').hidden = true; sheet.classList.remove('adding'); addSlot = null; pick = null; }
  function allFoods() { return [...D.custom.map((f) => ({ ...f, mine: true })), ...FOODS]; }
  function search() {
    const q = $d('#diet-q').value.trim().replace(/\s/g, '');
    let list;
    if (!q) {
      const rec = D.recent.map((n) => allFoods().find((f) => f.n === n)).filter(Boolean);
      list = rec.length ? rec : FOODS.slice(0, 12);
      $d('#diet-q-hint').textContent = rec.length ? '최근 먹은 음식' : '자주 먹는 음식';
    } else {
      list = allFoods().filter((f) => f.n.replace(/\s/g, '').includes(q)).slice(0, 30);
      $d('#diet-q-hint').textContent = list.length ? `검색 결과 ${list.length}개` : '없으면 아래에서 직접 추가하세요';
    }
    $d('#diet-results').innerHTML = list.map((f, i) => `<button type="button" class="dres" data-i="${i}"><span><b>${escapeHtml(f.n)}</b>${f.mine ? ' <i>내 음식</i>' : ''}<small>${escapeHtml(f.u)} · 탄${f.c} 단${f.p} 지${f.f}</small></span><em>${f.k} kcal</em></button>`).join('');
    $d('#diet-results').querySelectorAll('.dres').forEach((b) => b.addEventListener('click', () => choose(list[+b.dataset.i])));
  }
  function choose(f) {
    pick = f; qty = 1;
    $d('#diet-qty').hidden = false; $d('#diet-custom').hidden = true;
    showQty();
  }
  function showQty() {
    $d('#diet-qty-name').textContent = `${pick.n} (${pick.u})`;
    $d('#diet-qty-v').textContent = qty % 1 ? qty.toFixed(1) : qty;
    $d('#diet-qty-sum').textContent = `${Math.round(pick.k * qty)} kcal · 탄${r1(pick.c * qty)} 단${r1(pick.p * qty)} 지${r1(pick.f * qty)}g`;
  }
  function saveFood() {
    if (!pick || !addSlot) return;
    const dd = (D.days[day] ||= {});
    (dd[addSlot] ||= []).push({ n: pick.n, k: pick.k, c: pick.c, p: pick.p, f: pick.f, q: qty });
    D.recent = [pick.n, ...D.recent.filter((n) => n !== pick.n)].slice(0, 15);
    persist(); toast(`${pick.n} ${Math.round(pick.k * qty)} kcal 추가`);
    closeAdd(); render();
  }

  /* ---------- 📷 사진으로 음식·칼로리 추정 (Claude) ---------- */
  let sampler = null, aiItems = [];
  (async () => {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      sampler = await window.claude.use('sample');
      const caps = sampler ? await sampler.limits().catch(() => null) : null;
      if (caps && caps.images) {
        $d('#diet-ai-btn').hidden = false;
        if (caps.images.mediaTypes) $d('#diet-ai-file').accept = caps.images.mediaTypes.join(',');
      }
    } catch {}
  })();
  const AI_ERR = {
    not_granted: 'Claude 사용을 허락해야 사진 분석을 할 수 있어요', rate_limited: '잠시 후 다시 해주세요 (요청이 많아요)',
    image_rejected: '이 사진은 분석할 수 없어요 (형식·크기)', refused: '이 사진은 분석할 수 없어요', invalid_json: '분석 결과를 읽지 못했어요. 다시 해보세요',
    sampling_disabled: '지금은 AI 분석을 쓸 수 없어요', capability_disabled: '지금은 AI 분석을 쓸 수 없어요', session_expired: '다시 로그인한 뒤 해주세요',
  };
  function toBlob(file) {
    return new Promise((res) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1024 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => res(b || file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }
  async function analyze(file) {
    if (!sampler) return;
    const box = $d('#diet-ai'); box.hidden = false;
    $d('#diet-ai-img').src = URL.createObjectURL(file);
    $d('#diet-ai-list').innerHTML = ''; $d('#diet-ai-save').hidden = true;
    $d('#diet-ai-msg').textContent = '🔍 사진 속 음식을 보고 칼로리를 계산하는 중…';
    try {
      const blob = await toBlob(file);
      const out = await sampler.json(
        '첨부한 사진은 사용자가 먹은(먹을) 음식 사진이다. 사진 속 음식을 하나하나 식별하고, 사진에 보이는 양을 기준으로 대략적인 열량(kcal)과 탄수화물·단백질·지방(g)을 추정하라. ' +
        '음식 이름은 한국어로, 보이는 양은 "1공기 210g", "치킨 3조각" 처럼 적는다. 한국 식품영양성분 DB 평균값 수준으로 현실적으로 추정한다. ' +
        '음식이 아니면 items를 빈 배열로. JSON만 답한다: {"items":[{"n":"음식명","u":"보이는 양","k":0,"c":0,"p":0,"f":0}],"note":"한 줄 코멘트(헬스하는 친구 말투)"}',
        { images: [blob], modelTier: 'default' });
      aiItems = (out && Array.isArray(out.items) ? out.items : []).map((x) => ({ n: String(x.n || '음식').slice(0, 30), u: String(x.u || '사진 속 양').slice(0, 20), k: Math.round(num(x.k)), c: r1(num(x.c)), p: r1(num(x.p)), f: r1(num(x.f)), on: true }))
        .filter((x) => x.k > 0);
      if (!aiItems.length) { $d('#diet-ai-msg').textContent = '음식을 찾지 못했어요. 다른 사진으로 해보거나 검색해주세요'; return; }
      const tot = aiItems.reduce((a, x) => a + x.k, 0);
      $d('#diet-ai-msg').textContent = `${out.note ? `${String(out.note).slice(0, 60)} · ` : ''}총 약 ${tot.toLocaleString()} kcal (AI 추정)`;
      $d('#diet-ai-list').innerHTML = aiItems.map((x, i) => `<label class="dai"><input type="checkbox" data-i="${i}" checked /><span><b>${escapeHtml(x.n)}</b><small>${escapeHtml(x.u)} · 탄${x.c} 단${x.p} 지${x.f}</small></span><em>${x.k} kcal</em></label>`).join('');
      $d('#diet-ai-list').querySelectorAll('input').forEach((c) => c.addEventListener('change', () => { aiItems[+c.dataset.i].on = c.checked; }));
      $d('#diet-ai-save').hidden = false;
    } catch (e) {
      $d('#diet-ai-msg').textContent = AI_ERR[e && e.code] || '분석하지 못했어요. 잠시 후 다시 해보세요';
    }
  }
  function saveAi() {
    const list = aiItems.filter((x) => x.on);
    if (!list.length || !addSlot) return;
    const dd = (D.days[day] ||= {});
    list.forEach((x) => (dd[addSlot] ||= []).push({ n: x.n, k: x.k, c: x.c, p: x.p, f: x.f, q: 1, ai: 1 }));
    persist(); toast(`📷 ${list.length}개 · ${list.reduce((a, x) => a + x.k, 0).toLocaleString()} kcal 추가`);
    closeAdd(); render();
  }

  /* ---------- 이벤트 ---------- */
  $d('#diet-open').addEventListener('click', open);
  $d('#diet-close').addEventListener('click', close);

  $d('#diet-start').addEventListener('click', () => {
    D.on = true; D.goal = { kcal: num($d('#diet-goal-k').value) || 0, p: num($d('#diet-goal-p').value) || 0 };
    persist(); render(); toast('🥗 식단 기록 시작! 제대로 가보자');
  });
  $d('#diet-prev').addEventListener('click', () => { day = addDays(day, -1); render(); });
  $d('#diet-next').addEventListener('click', () => { if (day < todayStr()) { day = addDays(day, 1); render(); } });
  $d('#diet-settings').addEventListener('click', () => {
    const k = prompt('하루 목표 칼로리 (kcal)', goal().kcal); if (k === null) return;
    const p = prompt('하루 목표 단백질 (g)', goal().p); if (p === null) return;
    D.goal = { kcal: num(k), p: num(p) }; persist(); render();
  });
  $d('#diet-off').addEventListener('click', async () => {
    if (!(await askConfirm('식단 기록을 끌까요? (기록은 남아 있어요)', { okText: '끄기' }))) return;
    D.on = false; persist(); render();
  });
  $d('#diet-q').addEventListener('input', search);
  $d('#diet-ai-btn').addEventListener('click', () => $d('#diet-ai-file').click());
  $d('#diet-ai-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) analyze(f); });
  $d('#diet-ai-save').addEventListener('click', saveAi);
  $d('#diet-add-close').addEventListener('click', closeAdd);
  $d('#diet-minus').addEventListener('click', () => { qty = Math.max(0.5, Math.round((qty - 0.5) * 10) / 10); showQty(); });
  $d('#diet-plus').addEventListener('click', () => { qty = Math.round((qty + 0.5) * 10) / 10; showQty(); });
  $d('#diet-save').addEventListener('click', saveFood);
  $d('#diet-custom-open').addEventListener('click', () => { $d('#diet-custom').hidden = false; $d('#diet-qty').hidden = true; $d('#dc-n').value = $d('#diet-q').value.trim(); $d('#dc-n').focus(); });
  $d('#diet-custom').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = { n: $d('#dc-n').value.trim().slice(0, 30), u: ($d('#dc-u').value.trim() || '1인분').slice(0, 20), k: num($d('#dc-k').value), c: num($d('#dc-c').value), p: num($d('#dc-p').value), f: num($d('#dc-f').value) };
    if (!f.n || !(f.k > 0)) { toast('이름과 칼로리는 꼭 적어주세요'); return; }
    D.custom = [f, ...D.custom.filter((x) => x.n !== f.n)].slice(0, 100);
    persist(); choose(f);
  });

  return { open, renderInline, restore, state: () => D, totals };
})();
