/*
 * 항공 데이터 허브 공통 화면 스크립트.
 * 원본: Aboitiz 세부·보홀 데이터 허브(claude.ai Data 아티팩트)의 화면 스크립트를 나라별 설정(window.HUB)으로 돌게 고친 것.
 * 나라마다 다른 값은 모두 hubs/<slug>/hub.json 에서 온다 — 이 파일에 나라 이름·공항 코드를 직접 쓰지 않는다.
 */
const HUB = window.HUB;
const R = HUB.R;                                   // 지역 이름 (예: 필리핀, 중앙아시아)
const PROJECT = HUB.focus || [];                   // 중점 공항 코드 (없으면 빈 배열)
const ORDER = HUB.dest.map((d) => d.code);         // 현지 공항 표시 순서
const DNAME = new Map(HUB.dest.map((d) => [d.code, d.name]));
const DGROUP = new Map(HUB.dest.map((d) => [d.code, d.group || '']));
const KR = HUB.kr;                                 // 한국 공항 [{code, name}]
const SUPPLY_KR = (HUB.supply_kr || KR.map((k) => k.code)).map((c) => KR.find((k) => k.code === c) || { code: c, name: c });
const PAIR_PLUS1 = HUB.pair_plus1 || [];           // 귀국편 짝을 편명+1 로 먼저 찾는 항공사
const BASIS = HUB.basis_label || '원문';           // 기종·현지 도착 정보의 근거 이름
const FOCUS_SHORT = HUB.focus_short || '중점';
const has = (w) => w !== null && w !== undefined && w !== '';
const lc = (s) => String(s).toLowerCase();

/* ===== 원문(항공 공급) 집계 ===== */
dash.calc('by_dest', {
  inputs: ['flights'],
  title: '목적지별 주간 운항',
  fn: (flights) => ORDER.filter((code) => flights.some((f) => f.dest_code === code)).map((code) => {
    const rows = flights.filter((f) => f.dest_code === code);
    const known = rows.filter((f) => has(f.weekly));
    const sum = (o) => known.filter((f) => f.origin_code === o).reduce((a, f) => a + Number(f.weekly), 0);
    const out = { dest_code: code, dest: rows.length ? rows[0].dest : (DNAME.get(code) || code), unconfirmed: rows.length - known.length, airlines: new Set(rows.map((f) => f.airline)).size };
    let total = 0;
    SUPPLY_KR.forEach((k) => { const v = sum(k.code); out['o_' + lc(k.code)] = v; total += v; });
    out.total = total;
    return out;
  }),
});

dash.calc('by_airline', {
  inputs: ['flights'],
  title: '항공사별 주간 운항',
  fn: (flights) => {
    const m = new Map();
    flights.forEach((f) => {
      if (!has(f.weekly)) return;
      const a = m.get(f.airline) || { airline: f.airline, project: 0, other: 0 };
      if (PROJECT.includes(f.dest_code)) a.project += Number(f.weekly); else a.other += Number(f.weekly);
      m.set(f.airline, a);
    });
    return [...m.values()].map((a) => ({ ...a, total: a.project + a.other })).sort((x, y) => y.project - x.project || y.total - x.total);
  },
});

dash.calc('headline', {
  inputs: ['flights'],
  title: '원문 요약',
  fn: (flights) => {
    const known = flights.filter((f) => has(f.weekly));
    const p = known.filter((f) => PROJECT.includes(f.dest_code));
    const total = p.reduce((a, f) => a + Number(f.weekly), 0);
    const night = p.filter((f) => Number(f.dep.slice(0, 2)) >= 20).reduce((a, f) => a + Number(f.weekly), 0);
    return [{ project_weekly: total, night_pct: total ? Math.round((night / total) * 100) : 0, earliest_dep: p.map((f) => f.dep).sort()[0], all_weekly: known.reduce((a, f) => a + Number(f.weekly), 0) }];
  },
});

dash.calc('flight_detail', {
  inputs: ['schedule_week', 'flights', 'seat_configs'],
  title: '항공편 상세 (통합)',
  fn: (schedule_week, flights, seat_configs) => {
    const norm = (s) => String(s || '').replace(/\s/g, '');
    const pre = (s) => norm(s).slice(0, 2);
    const num = (s) => Number(norm(s).slice(2));
    const known = (v) => v !== null && v !== undefined && v !== '';
    const seatOf = (code, label) => { const c = seat_configs.find((s) => s.airline_code === code && s.aircraft_label === label); return c ? Number(c.total) : null; };
    const orig = flights.map((f) => ({ ...f, fn: norm(f.flight), ac: f.aircraft === '확인 필요' ? '' : (f.aircraft || '') }));
    const enrich = (fn, krCode, phCode) => {
      const rs = orig.filter((f) => f.fn === fn && f.origin_code === krCode && f.dest_code === phCode);
      const acs = rs.filter((f) => f.ac);
      return { rs, acs };
    };
    const rows = schedule_week.map((w) => {
      let basis = '', src = enrich(w.flight, w.kr_code, w.ph_code);
      if (w.dir === 'OUT') basis = src.acs.length ? BASIS : '';
      else {
        const outs = new Set(schedule_week.filter((x) => x.dir === 'OUT' && x.kr_code === w.kr_code && x.ph_code === w.ph_code).map((x) => norm(x.flight)).concat(orig.filter((f) => f.origin_code === w.kr_code && f.dest_code === w.ph_code).map((f) => f.fn)));
        const n = num(w.flight), p = pre(w.flight);
        const order = PAIR_PLUS1.includes(p) ? [n + 1, n - 1] : [n - 1, n + 1];
        const hit = order.map((k) => [...outs].find((o) => pre(o) === p && num(o) === k)).find(Boolean);
        const pair = hit ? orig.filter((f) => f.fn === hit && f.origin_code === w.kr_code && f.dest_code === w.ph_code) : [];
        src = { rs: [], acs: pair.filter((f) => f.ac) };
        basis = src.acs.length ? `짝편 ${hit}` : '';
      }
      const acList = [...new Set(src.acs.map((f) => f.ac))];
      const seatList = acList.map((a) => seatOf(pre(w.flight), a));
      let weeklySeats = null;
      if (acList.length === 1 && seatList[0]) weeklySeats = seatList[0] * Number(w.weekly);
      else if (acList.length > 1 && seatList.every(Boolean)) {
        const split = src.acs.filter((f) => known(f.weekly));
        if (split.reduce((a, f) => a + Number(f.weekly), 0) === Number(w.weekly)) weeklySeats = split.reduce((a, f) => a + Number(f.weekly) * seatOf(pre(w.flight), f.ac), 0);
      }
      const o = w.dir === 'OUT' ? src.rs.find((f) => f.arr) : null;
      return {
        id: w.id, dir: w.dir, direction: w.direction, kr_code: w.kr_code, kr_airport: w.kr_airport, ph_code: w.ph_code, ph_airport: w.ph_airport,
        project: w.project, airline: w.airline, flight: w.flight, codeshare: w.codeshare || '', days: w.days, weekly: Number(w.weekly),
        kr_time: w.kr_time, time_basis: w.time_basis, ph_arr: o ? o.arr : '', duration: o ? o.duration : '',
        aircraft: acList.map((a) => a.replace(/ \(.+\)$/, '')).join(' / '), aircraft_basis: basis,
        seats: [...new Set(seatList.filter(Boolean))].join(' / '), weekly_seats: weeklySeats, terminal: w.terminal || '', dates: w.dates || '',
        source: '공항 공식', note: w.note || '',
      };
    });
    const inWeek = new Set(schedule_week.filter((w) => w.dir === 'OUT').map((w) => `${norm(w.flight)}|${w.kr_code}|${w.ph_code}`));
    orig.filter((f) => !inWeek.has(`${f.fn}|${f.origin_code}|${f.dest_code}`)).forEach((f) => {
      rows.push({
        id: `ORIG-${f.id}`, dir: 'OUT', direction: `한국→${R}`, kr_code: f.origin_code, kr_airport: f.origin, ph_code: f.dest_code, ph_airport: f.dest,
        project: PROJECT.includes(f.dest_code) ? 'Y' : '', airline: f.airline, flight: f.fn, codeshare: '', days: f.days || '',
        weekly: known(f.weekly) ? Number(f.weekly) : null, kr_time: f.dep || '', time_basis: '한국 출발', ph_arr: f.arr || '', duration: f.duration || '',
        aircraft: f.ac.replace(/ \(.+\)$/, ''), aircraft_basis: f.ac ? BASIS : '', seats: f.ac ? String(seatOf(f.fn.slice(0, 2), f.ac) || '') : '',
        weekly_seats: null, terminal: f.dep_terminal || '', dates: f.valid || '', source: `${BASIS}만`,
        note: `${BASIS}에만 있음 — 이번 주 공항 시간표에 없음${f.note ? ' · ' + f.note : ''}`,
      });
    });
    return rows;
  },
});

dash.calc('detail_headline', {
  inputs: ['flight_detail'],
  title: '항공편 상세 요약',
  fn: (flight_detail) => {
    const out = flight_detail.filter((r) => r.dir === 'OUT');
    const sum = (rs, k) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return [{
      out_weekly: sum(out, 'weekly'), in_weekly: sum(flight_detail.filter((r) => r.dir === 'IN'), 'weekly'),
      out_seats: sum(out, 'weekly_seats'), proj_seats: sum(out.filter((r) => PROJECT.includes(r.ph_code)), 'weekly_seats'),
      out_unknown: new Set(out.filter((r) => !r.aircraft).map((r) => r.flight)).size,
    }];
  },
});

dash.calc('seat_routes', {
  inputs: ['seat_configs', 'flights'],
  title: '기종별 운항 노선',
  fn: (seat_configs, flights) => seat_configs.map((s) => {
    const fs = flights.filter((f) => f.airline === s.airline && f.aircraft === s.aircraft_label);
    const routes = [...new Set(fs.map((f) => `${f.origin}→${f.dest}`))].join(', ');
    const weekly = fs.filter((f) => has(f.weekly)).reduce((a, f) => a + Number(f.weekly), 0);
    return { id: s.id, routes, weekly };
  }),
});

/* ===== 주간 운항 스케줄 (공항 공식) 집계 ===== */
const WK_DOW_ALL = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_SEGS = (HUB.day_segments || PROJECT.map((c) => ({ name: DNAME.get(c) || c, codes: [c] })));
const SEG_CODES = new Set(DAY_SEGS.flatMap((s) => s.codes));
const HAS_OTHER = ORDER.some((c) => !SEG_CODES.has(c));
const WEEK_GROUPS = HUB.week_groups || [];

dash.calc('week_by_ph', {
  inputs: ['schedule_week'],
  title: '현지 공항별 주간 운항',
  fn: (schedule_week) => ORDER.map((code) => {
    const rows = schedule_week.filter((r) => r.ph_code === code);
    const s = (dir, kr) => rows.filter((r) => r.dir === dir && (!kr || r.kr_code === kr)).reduce((a, r) => a + Number(r.weekly), 0);
    const out = { ph_code: code, ph_airport: rows.length ? rows[0].ph_airport : (DNAME.get(code) || code), group: DGROUP.get(code) || '',
      out_total: s('OUT'), in_total: s('IN'), airlines: new Set(rows.map((r) => r.airline)).size };
    KR.forEach((k) => { out['out_' + lc(k.code)] = s('OUT', k.code); out['in_' + lc(k.code)] = s('IN', k.code); });
    return out;
  }),
});

dash.calc('week_headline', {
  inputs: ['schedule_week'],
  title: '주간 운항 요약',
  fn: (schedule_week) => {
    const sum = (f) => schedule_week.filter(f).reduce((a, r) => a + Number(r.weekly), 0);
    return [{ out_total: sum((r) => r.dir === 'OUT'), in_total: sum((r) => r.dir === 'IN'),
      routes: new Set(schedule_week.map((r) => r.kr_code + '-' + r.ph_code)).size, airlines: new Set(schedule_week.map((r) => r.airline)).size }];
  },
});

dash.calc('week_groups', {
  inputs: ['schedule_week'],
  title: '묶음별 주간 운항',
  fn: (schedule_week) => {
    const sum = (f) => schedule_week.filter(f).reduce((a, r) => a + Number(r.weekly), 0);
    const all = sum((r) => r.dir === 'OUT');
    return WEEK_GROUPS.map((g) => {
      const out = sum((r) => r.dir === 'OUT' && g.codes.includes(r.ph_code));
      const inn = sum((r) => r.dir === 'IN' && g.codes.includes(r.ph_code));
      return { label: g.label, out, in: inn, share: all ? Math.round((out / all) * 100) : 0,
        airlines: new Set(schedule_week.filter((r) => g.codes.includes(r.ph_code)).map((r) => r.airline)).size };
    });
  },
});

dash.calc('week_by_day', {
  inputs: ['schedule_week', 'week_meta'],
  title: '요일별 운항',
  fn: (schedule_week, week_meta) => String(week_meta[0] ? week_meta[0].days : '').split('·').filter(Boolean).map((day) => {
    const on = (r) => String(r.dates).split('·').includes(day);
    const c = (dir, f) => schedule_week.filter((r) => r.dir === dir && on(r) && f(r)).length;
    const row = { day };
    DAY_SEGS.forEach((s, i) => { row[`s${i}_out`] = c('OUT', (r) => s.codes.includes(r.ph_code)); row[`s${i}_in`] = c('IN', (r) => s.codes.includes(r.ph_code)); });
    row.oth_out = c('OUT', (r) => !SEG_CODES.has(r.ph_code)); row.oth_in = c('IN', (r) => !SEG_CODES.has(r.ph_code));
    return row;
  }),
});

dash.calc('week_vs_original', {
  inputs: ['flights', 'schedule_week'],
  title: '원문 대비 차이',
  fn: (flights, schedule_week) => {
    const k = (fn, o, d) => String(fn).replace(/\s+/g, '').split('-')[0] + '|' + o + '|' + d;
    const off = new Map(schedule_week.filter((r) => r.dir === 'OUT').map((r) => [k(r.flight, r.kr_code, r.ph_code), r]));
    const org = new Map(flights.map((r) => [k(r.flight, r.origin_code, r.dest_code), r]));
    const rows = [];
    org.forEach((r, key) => { if (!off.has(key)) rows.push({ key, flight: String(r.flight).replace(/\s+/g, ''), route: `${r.origin}→${r.dest}`, status: `${BASIS}에만 있음 — 이번 주 공항 스케줄에 없음` }); });
    off.forEach((r, key) => { if (!org.has(key)) rows.push({ key, flight: r.flight, route: `${r.kr_airport}→${r.ph_airport}`, status: `공항 스케줄에만 있음 — ${r.airline}, ${r.days} ${r.kr_time} 출발` }); });
    return rows;
  },
});

/* ===== 화면 뼈대: 탭·카드를 설정대로 만든다 ===== */
const fmt = d3.format(',');
const TABS = HUB.tabs || ['overview', 'week', 'days', 'routes', 'detail', 'supply', 'seats', 'seatmap', 'glossary'];
document.querySelectorAll('.ab-tab').forEach((t) => { if (!TABS.includes(t.dataset.tab)) t.remove(); });
document.querySelectorAll('.ab-page').forEach((p) => { if (!TABS.includes(p.id)) p.remove(); });
document.querySelectorAll('[data-go]').forEach((b) => { if (!TABS.includes(b.dataset.go)) (b.closest('.ab-card') || b).remove(); });
if (!HUB.show_week_diff) { const b = document.getElementById('week-diff-box'); if (b) b.remove(); }
// 항공편 상세에서 숨길 열 (예: 공식 시간표에 없는 현지 도착·비행시간)
const DETAIL_HIDE = new Set(HUB.detail_hide_cols || []);
DETAIL_HIDE.forEach((f) => { const th = document.querySelector(`#table-detail th[data-field="${f}"]`); if (th) th.remove(); });

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function mark(source, field, opt = {}) {
  const s = el('span', opt.cls || '', '—'); s.dataset.source = source; s.dataset.field = field;
  if (opt.row !== undefined) s.dataset.row = String(opt.row); if (opt.where) s.dataset.where = opt.where; return s;
}
function kpiCard({ label, tag, source, field, row, where, sub }) {
  const c = el('div', 'ab-card' + (tag ? ' ab-proj' : ''));
  const l = el('div', 'ab-k-label', label + ' ');
  if (tag) l.append(el('span', 'ab-tag', HUB.focus_label || '중점'));
  const n = mark(source, field, { cls: 'ab-num dash-skeleton', row, where });
  const s = el('div', 'ab-k-sub'); s.innerHTML = sub || '';
  c.append(l, n, s); return c;
}
// 개요 KPI
const ovk = document.getElementById('overview-kpis');
if (ovk) (HUB.overview_kpis || []).forEach((k) => ovk.append(kpiCard(k)));
// 주간 스케줄: 묶음 카드
const wkRoutes = document.getElementById('week-kpi-routes');
if (wkRoutes) WEEK_GROUPS.forEach((g, i) => {
  if (g.week_card === false) return;   // 개요 카드에만 쓰는 묶음
  const c = el('div', 'ab-card' + (g.tag ? ' ab-proj' : ''));
  const l = el('div', 'ab-k-label', `${g.label} (한국 출발) `); if (g.tag) l.append(el('span', 'ab-tag', HUB.focus_label || '중점'));
  const s = el('div', 'ab-k-sub');
  s.append(document.createTextNode(`${R} 전체의 `), mark('week_groups', 'share', { row: i }), document.createTextNode('% · 귀국편 '), mark('week_groups', 'in', { row: i }), document.createTextNode('회'));
  if (g.show_airlines) s.append(document.createTextNode(' · 항공사 '), mark('week_groups', 'airlines', { row: i }), document.createTextNode('곳'));
  c.append(l, mark('week_groups', 'out', { cls: 'ab-num dash-skeleton', row: i }), s);
  wkRoutes.before(c);
});
// 원문 탭: 목적지 카드와 범례
const kpiDest = document.getElementById('kpi-dest');
function ensureDestCards() {
  if (!kpiDest || kpiDest.children.length) return;
  const fd = dash.data('flights'); if (fd.status !== 'ok') return;
  const present = new Set(fd.data.map((f) => f.dest_code));
  ORDER.filter((code) => present.has(code)).forEach((code) => {
  const w = `dest_code=${code}`; const proj = PROJECT.includes(code);
  const c = el('div', 'ab-card' + (proj ? ' ab-proj' : '')); c.id = `kpi-${lc(code)}`;
  const l = el('div', 'ab-k-label', `${DNAME.get(code) || code} `); if (proj) l.append(el('span', 'ab-tag', HUB.focus_label || '중점'));
  const s1 = el('div', 'ab-k-sub', '회/주');
  SUPPLY_KR.forEach((k) => s1.append(document.createTextNode(` · ${k.name} `), mark('by_dest', 'o_' + lc(k.code), { where: w })));
  const s2 = el('div', 'ab-k-sub', '운항 항공사 '); s2.append(mark('by_dest', 'airlines', { where: w }), document.createTextNode('곳'));
  const s3 = el('div', 'ab-k-warn', '요일 미확인 '); s3.append(mark('by_dest', 'unconfirmed', { where: w }), document.createTextNode('편'));
  c.append(l, mark('by_dest', 'total', { cls: 'ab-num dash-skeleton', where: w }), s1, s2, s3);
  kpiDest.append(c);
  });
}
const destLegend = document.getElementById('dest-legend');
if (destLegend) SUPPLY_KR.forEach((k, i) => { const s = el('span'); const sw = el('span', 'ab-sw'); sw.style.background = dash.colors[i]; s.append(sw, document.createTextNode(`${k.name} 출발`)); destLegend.append(s); });
const swProj = document.getElementById('sw-proj'); if (swProj) swProj.style.background = dash.colors[0];
const swOther = document.getElementById('sw-other'); if (swOther) swOther.style.background = 'var(--cds-chart-muted)';
// 요일별 운항 범례
const DAY_SEG_DEF = DAY_SEGS.map((s, i) => ({ f: `s${i}`, n: s.name, c: dash.colors[i % dash.colors.length] }))
  .concat(HAS_OTHER ? [{ f: 'oth', n: DAY_SEGS.length ? `기타 ${R}` : R, c: DAY_SEGS.length ? 'var(--cds-chart-muted)' : dash.colors[0] }] : []);
const wkLegend = document.getElementById('wkday-legend');
if (wkLegend) DAY_SEG_DEF.forEach((s) => { const e = el('span'); const sw = el('span', 'ab-sw'); sw.style.background = s.c; e.append(sw, document.createTextNode(s.n)); wkLegend.append(e); });

let current = TABS[0];
const tabs = [...document.querySelectorAll('.ab-tab')];

function show(id, link) {
  current = id;
  tabs.forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === id ? 'true' : 'false'));
  document.querySelectorAll('.ab-page').forEach((p) => { p.hidden = p.id !== id; });
  if (link) dash.setLink(id);
  draw();
}
tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab, true)));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go, true)));

function failLine(box) {
  const d = document.createElement('div'); d.className = 'ab-fail';
  const dot = document.createElement('span'); dot.className = 'ab-dot';
  d.append(dot, document.createTextNode('불러오지 못했습니다'));
  box.replaceChildren(d);
}
function emptyLine(box, msg) {
  const d = document.createElement('div'); d.className = 'ab-fail'; d.textContent = msg; box.replaceChildren(d);
}
function prep(chartId, dsId) {
  const wrap = document.getElementById(chartId);
  if (!wrap) return null;
  const box = wrap.querySelector('.ab-box');
  const tip = wrap.querySelector('.ab-tip');
  const d = dash.data(dsId);
  tip.hidden = true;
  if (d.status === 'error' || d.status === 'connect' || d.status === 'declined') { box.classList.remove('dash-skeleton'); failLine(box); return null; }
  if (d.status !== 'ok') { box.replaceChildren(); box.classList.add('dash-skeleton'); return null; }
  box.classList.remove('dash-skeleton');
  return { wrap, box, tip, rows: d.data };
}
function showTip(ctx, event, head, lines) {
  const { wrap, tip } = ctx;
  const h = document.createElement('div'); h.className = 'ab-tip-h'; h.textContent = head;
  tip.replaceChildren(h, ...lines.map((l) => { const e = document.createElement('div'); e.textContent = l; return e; }));
  tip.hidden = false;
  const r = wrap.getBoundingClientRect();
  let x = event.clientX - r.left + 12, y = event.clientY - r.top + 12;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > r.width) x = Math.max(0, event.clientX - r.left - tw - 12);
  if (y + th > r.height) y = Math.max(0, event.clientY - r.top - th - 12);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function measure(svg, texts, cls) {
  const g = svg.append('g'); let w = 0;
  texts.forEach((t) => { const n = g.append('text').attr('class', cls).text(t); w = Math.max(w, n.node().getComputedTextLength()); });
  g.remove(); return w;
}

function drawStack(chartId, dsId, opt) {
  const ctx = prep(chartId, dsId); if (!ctx) return;
  const { box, tip, rows } = ctx;
  const W = box.clientWidth; if (!W) return;
  if (!rows.length) { emptyLine(box, '데이터가 없습니다'); return; }
  const rowH = 34, top = 4, bottom = 26;
  const H = top + rows.length * rowH + bottom;
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  const labelW = measure(svg, rows.map(opt.label), 'ab-tick-strong');
  const endW = measure(svg, rows.map(opt.endLabel), 'ab-tick');
  const left = labelW + 12, right = endW + 12;
  const max = d3.max(rows, (r) => opt.segs.reduce((a, s) => a + Number(r[s.field]), 0)) || 1;
  const x = d3.scaleLinear([0, max], [left, Math.max(left + 40, W - right)]).nice();
  const y = d3.scaleBand(rows.map(opt.key), [top, top + rows.length * rowH]).padding(0.32);
  const ticks = x.ticks(Math.max(2, Math.floor((W - left - right) / 70)));
  svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', (t) => x(t)).attr('x2', (t) => x(t)).attr('y1', top).attr('y2', H - bottom).attr('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'ab-tick').attr('x', (t) => x(t)).attr('y', H - 8).attr('text-anchor', 'middle').text((t) => fmt(t));
  rows.forEach((r) => {
    let acc = 0;
    const g = svg.append('g');
    opt.segs.forEach((s) => {
      const v = Number(r[s.field]);
      if (v > 0) g.append('rect').attr('x', x(acc)).attr('y', y(opt.key(r))).attr('width', Math.max(1, x(acc + v) - x(acc) - 1)).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', s.color(r));
      acc += v;
    });
    svg.append('text').attr('class', opt.strong(r) ? 'ab-tick-strong' : 'ab-tick').attr('x', left - 8).attr('y', y(opt.key(r)) + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(opt.label(r));
    svg.append('text').attr('class', 'ab-tick').attr('x', x(acc) + 6).attr('y', y(opt.key(r)) + y.bandwidth() / 2).attr('dy', '0.35em').text(opt.endLabel(r));
    svg.append('rect').attr('x', 0).attr('y', y(opt.key(r)) - 4).attr('width', W).attr('height', y.bandwidth() + 8).attr('fill', 'transparent')
      .on('mousemove', (event) => showTip(ctx, event, opt.label(r), opt.tip(r)))
      .on('mouseleave', () => { tip.hidden = true; });
  });
}

function drawDest() {
  drawStack('chart-dest', 'by_dest', {
    key: (r) => r.dest_code, label: (r) => r.dest, strong: (r) => PROJECT.includes(r.dest_code),
    segs: SUPPLY_KR.map((k, i) => ({ field: 'o_' + lc(k.code), color: () => dash.colors[i] })),
    endLabel: (r) => `주 ${fmt(r.total)}회` + (r.unconfirmed ? ` +${r.unconfirmed}` : ''),
    tip: (r) => SUPPLY_KR.map((k) => `${k.name} 출발 주 ${r['o_' + lc(k.code)]}회`).concat([`운항 항공사 ${r.airlines}곳`]).concat(r.unconfirmed ? [`요일 미확인 ${r.unconfirmed}편`] : []),
  });
}
function drawAirline() {
  drawStack('chart-airline', 'by_airline', {
    key: (r) => r.airline, label: (r) => r.airline, strong: (r) => r.project > 0,
    segs: [{ field: 'project', color: () => dash.colors[0] }, { field: 'other', color: () => 'var(--cds-chart-muted)' }],
    endLabel: (r) => `주 ${fmt(r.total)}회`,
    tip: (r) => [`${HUB.focus_names || FOCUS_SHORT} 주 ${r.project}회`, `기타 ${R} 주 ${r.other}회`],
  });
}

function drawTime() {
  const ctx = prep('chart-time', 'flights'); if (!ctx) return;
  const { box, tip, rows } = ctx;
  const W = box.clientWidth; if (!W) return;
  const names = new Map(rows.map((r) => [r.dest_code, r.dest]));
  const dests = ORDER.filter((c) => names.has(c));
  if (!dests.length) { emptyLine(box, '데이터가 없습니다'); return; }
  const rowH = 40, top = 6, bottom = 26;
  const H = top + dests.length * rowH + bottom;
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  const left = measure(svg, dests.map((c) => names.get(c)), 'ab-tick-strong') + 12;
  const x = d3.scaleLinear([0, 24], [left, W - 14]);
  const y = d3.scaleBand(dests, [top, top + dests.length * rowH]).padding(0.15);
  [[0, 6], [20, 24]].forEach(([a, b]) => svg.append('rect').attr('x', x(a)).attr('width', x(b) - x(a)).attr('y', top).attr('height', H - top - bottom).attr('fill', 'var(--cds-chart-grid)').attr('opacity', 0.6));
  const ticks = (W - left) > 360 ? [0, 3, 6, 9, 12, 15, 18, 21, 24] : [0, 6, 12, 18, 24];
  svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', (t) => x(t)).attr('x2', (t) => x(t)).attr('y1', top).attr('y2', H - bottom).attr('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data(ticks).join('text').attr('class', 'ab-tick').attr('x', (t) => x(t)).attr('y', H - 8).attr('text-anchor', 'middle').text((t) => `${t}시`);
  dests.forEach((c) => {
    svg.append('text').attr('class', PROJECT.includes(c) ? 'ab-tick-strong' : 'ab-tick').attr('x', left - 8).attr('y', y(c) + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(names.get(c));
    svg.append('line').attr('x1', left).attr('x2', W - 14).attr('y1', y(c) + y.bandwidth() / 2).attr('y2', y(c) + y.bandwidth() / 2).attr('stroke', 'var(--cds-chart-axis)').attr('opacity', 0.4);
    const fl = rows.filter((r) => r.dest_code === c).sort((a, b) => a.dep.localeCompare(b.dep));
    fl.forEach((r, i) => {
      const hr = Number(r.dep.slice(0, 2)) + Number(r.dep.slice(3, 5)) / 60;
      const known = has(r.weekly);
      const rad = known ? 3 + Math.sqrt(Number(r.weekly)) * 1.6 : 5;
      const col = PROJECT.includes(c) || !PROJECT.length ? dash.colors[0] : 'var(--cds-chart-muted)';
      const cy = y(c) + y.bandwidth() / 2 + ((i % 3) - 1) * 6;
      svg.append('circle').attr('cx', x(hr)).attr('cy', cy).attr('r', rad)
        .attr('fill', known ? col : 'none').attr('stroke', col).attr('stroke-width', known ? 1 : 1.5).attr('fill-opacity', 0.75)
        .on('mousemove', (event) => showTip(ctx, event, `${r.airline} ${r.flight}`, [r.arr ? `${r.origin} ${r.dep} 출발 → ${r.arr} 도착` : `${r.origin} ${r.dep} 출발 (한국 시각)`, known ? `${r.days} · 주 ${r.weekly}회` : '운항 요일 확인 필요']))
        .on('mouseleave', () => { tip.hidden = true; });
    });
  });
}

function drawScheduleTimeline() {
  const container = document.getElementById('timeline-container');
  if (!container) return;
  const d = dash.data('schedule_timeline');
  if (d.status === 'error' || d.status === 'connect' || d.status === 'declined') { container.innerHTML = '<div class="ab-fail"><span class="ab-dot"></span>불러오지 못했습니다</div>'; return; }
  if (d.status !== 'ok') { return; }
  const rows = d.data;
  const card = document.getElementById('card-schedule');
  if (card) card.hidden = !rows.length;
  if (!rows.length) { container.replaceChildren(); return; }
  const destRows = {};
  rows.forEach((r) => {
    if (!destRows[r.dest_code]) destRows[r.dest_code] = [];
    destRows[r.dest_code].push(r);
  });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const html = ORDER.filter((c) => destRows[c]).map((code) => {
    const destName = destRows[code][0].dest;
    const isProj = PROJECT.includes(code) || !PROJECT.length;
    const flights = destRows[code].sort((a, b) => a.dep_h - b.dep_h);
    const rowsHtml = flights.map((f) => {
      const maxH = 48;
      const depPct = (f.dep_h / maxH) * 100;
      const durPct = ((f.arr_h - f.dep_h) / maxH) * 100;
      const col = isProj ? `var(--color-ok)` : `var(--cds-chart-muted)`;
      return `<div class="ab-timeline-row">
        <div class="ab-timeline-label">${esc(f.flight)}</div>
        <div class="ab-timeline-bar">
          <div class="ab-timeline-seg" style="left: ${depPct}%; width: ${durPct}%; background: ${col}; opacity: 0.7;">
            <div class="ab-timeline-seg-label">${esc(f.dep)} → ${esc(f.arr)}</div>
          </div>
        </div>
      </div>`;
    }).join('');
    const axisHours = [0, 6, 12, 18, 24, 30, 36, 42, 48].map((h) => {
      const pct = (h / 48) * 100;
      const label = h <= 24 ? `${h}시` : `+${h - 24}시`;
      return `<span style="left: ${pct}%">${label}</span>`;
    }).join('');
    return `<div style="margin-bottom: var(--cds-gap-lg);">
      <div style="font-weight: var(--cds-font-weight-medium); margin-bottom: var(--cds-gap-xs); font-size: var(--cds-font-size-body); ${isProj ? 'color: var(--color-fg);' : 'color: var(--color-fg-muted);'}">${esc(destName)}</div>
      <div>${rowsHtml}</div>
      <div class="ab-timeline-axis" style="position: relative; height: 18px;">
        ${axisHours}
      </div>
      <div style="font-size: 11px; color: var(--color-fg-muted); margin-top: 4px;">← 한국 시각 0시 | 자정 넘어 도착은 우측 축으로 표시</div>
    </div>`;
  }).join('');
  container.innerHTML = html;
}

function drawIssues() {
  const ul = document.getElementById('data-issues');
  if (!ul) return;
  const d = dash.data('flights');
  if (d.status !== 'ok') { ul.replaceChildren(); return; }
  const items = d.data.filter((r) => r.note);
  ul.replaceChildren(...items.map((r) => {
    const li = document.createElement('li');
    const b = document.createElement('span'); b.className = 'ab-strong'; b.textContent = `${r.flight} (${r.origin}→${r.dest})`;
    li.append(b, document.createTextNode(r.note));
    return li;
  }));
}

const gsearch = document.getElementById('gloss-search');
if (gsearch) gsearch.addEventListener('input', () => drawGlossary());
function drawGlossary() {
  const tbody = document.querySelector('#table-glossary tbody');
  if (!tbody) return;
  const d = dash.data('glossary');
  if (d.status !== 'ok') { tbody.replaceChildren(); return; }
  const q = gsearch.value.trim().toLowerCase();
  const rows = d.data.filter((r) => !q || `${r.code} ${r.meaning} ${r.category}`.toLowerCase().includes(q));
  tbody.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr'); tr.dataset.key = r.code;
    ['category', 'code', 'meaning'].forEach((c) => { const td = document.createElement('td'); td.textContent = r[c]; if (c !== 'meaning') td.className = 'ab-nowrap'; tr.append(td); });
    return tr;
  }));
}

// 화면의 data-source/data-field 자리에 값을 채운다 (data-row 또는 data-where 로 행 선택)
function fillMarks() {
  document.querySelectorAll('[data-source][data-field]:not(th)').forEach((e) => {
    const d = dash.data(e.dataset.source);
    if (d.status !== 'ok') { if (d.status !== 'loading') { e.classList.remove('dash-skeleton'); e.textContent = '—'; } return; }
    e.classList.remove('dash-skeleton');
    let row = null;
    if (e.dataset.row !== undefined) row = d.data[Number(e.dataset.row)];
    else if (e.dataset.where) { const [k, v] = e.dataset.where.split('='); row = d.data.find((r) => String(r[k]) === v); }
    const v = row ? row[e.dataset.field] : null;
    e.textContent = v === null || v === undefined || v === '' ? '—' : (typeof v === 'number' ? fmt(v) : String(v));
  });
  document.querySelectorAll('.ab-k-warn').forEach((e) => {
    const span = e.querySelector('[data-field="unconfirmed"]');
    e.style.visibility = span && span.textContent !== '0' && span.textContent !== '—' ? 'visible' : 'hidden';
  });
}

/* ===== 주간 운항 스케줄 그리기 ===== */
let wkDir = 'OUT';
function chipRow(e, opts, cur, set) {
  e.replaceChildren(...opts.map(([v, n]) => {
    const b = document.createElement('button'); b.className = 'ab-chip'; b.textContent = n;
    b.setAttribute('aria-pressed', cur === v ? 'true' : 'false');
    b.addEventListener('click', () => { set(v); draw(); });
    return b;
  }));
  e.style.display = 'inline-flex'; e.style.flexWrap = 'wrap'; e.style.gap = 'var(--cds-gap-xs)';
}

let wkMx = 'OUT';
function drawWeekMatrix() {
  const tbody = document.querySelector('#table-week-matrix tbody');
  chipRow(document.getElementById('wkmx-dir'), [['OUT', `한국 → ${R}`], ['IN', `${R} → 한국`]], wkMx, (v) => { wkMx = v; });
  const pre = wkMx === 'OUT' ? 'out' : 'in';
  const oth = wkMx === 'OUT' ? 'in' : 'out';
  const head = document.getElementById('mx-head');
  const th = (text, cls) => { const t = el('th', cls || '', text); return t; };
  head.replaceChildren(th(`${R} 공항`, 'ab-mx-l'), ...KR.map((k) => th(wkMx === 'OUT' ? `${k.name} 출발` : `${k.name} 도착`)), th('합계 (주)', 'ab-mx-toth'), th('항공사'));
  const d = dash.data('week_by_ph');
  if (d.status !== 'ok') { tbody.replaceChildren(); return; }
  const maxCell = d3.max(d.data, (r) => d3.max(KR, (k) => Number(r[`${pre}_${lc(k.code)}`]))) || 1;
  const maxTot = d3.max(d.data, (r) => Number(r[`${pre}_total`])) || 1;
  const base = dash.colors[0];
  tbody.replaceChildren(...d.data.map((r) => {
    const tr = document.createElement('tr'); tr.dataset.key = r.ph_code;
    const proj = PROJECT.includes(r.ph_code);
    if (proj) tr.className = 'ab-mx-proj';
    const name = el('td', 'ab-mx-name');
    name.append(el('span', 'ab-mx-n', r.ph_airport), el('span', 'ab-mx-c', r.group ? `${r.ph_code} · ${r.group}` : r.ph_code));
    if (proj) name.append(el('span', 'ab-tag ab-proj', FOCUS_SHORT));
    tr.append(name);
    KR.forEach((k) => {
      const v = Number(r[`${pre}_${lc(k.code)}`]);
      const td = el('td', 'ab-mx-cell');
      if (!v) { td.classList.add('ab-mx-zero'); td.textContent = '–'; }
      else { td.textContent = fmt(v); td.style.background = `color-mix(in srgb, ${base} ${Math.round(12 + 48 * v / maxCell)}%, transparent)`; }
      tr.append(td);
    });
    const tot = Number(r[`${pre}_total`]);
    const td = el('td', 'ab-mx-tot');
    const bar = el('span', 'ab-mx-bar');
    bar.style.width = `calc((100% - 2 * var(--cds-pad-sm)) * ${(tot / maxTot).toFixed(3)})`;
    bar.style.background = proj || !PROJECT.length ? `color-mix(in srgb, ${base} 35%, transparent)` : 'color-mix(in srgb, var(--cds-chart-muted) 45%, transparent)';
    const ov = Number(r[`${oth}_total`]);
    td.append(bar, el('span', 'ab-mx-tv', fmt(tot)), el('span', 'ab-mx-sub', wkMx === 'OUT' ? `귀국 ${fmt(ov)}회` : `출발 ${fmt(ov)}회`)); tr.append(td);
    tr.append(el('td', 'ab-mx-air', r.airlines ? `${r.airlines}곳` : '–'));
    return tr;
  }));
}

function drawWeekDay() {
  chipRow(document.getElementById('wkday-dir'), [['OUT', `한국→${R}`], ['IN', `${R}→한국`]], wkDir, (v) => { wkDir = v; });
  const ctx = prep('chart-week-day', 'week_by_day'); if (!ctx) return;
  const { box, tip, rows } = ctx;
  const W = box.clientWidth; if (!W) return;
  const sfx = wkDir === 'OUT' ? '_out' : '_in';
  const segs = DAY_SEG_DEF;
  const H = 220, top = 18, bottom = 40;
  box.replaceChildren();
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  const tot = (r) => segs.reduce((a, s) => a + Number(r[s.f + sfx]), 0);
  const max = d3.max(rows, tot) || 1;
  const y = d3.scaleLinear([0, max], [H - bottom, top]).nice();
  const yt = y.ticks(Math.min(4, max));
  const left = measure(svg, yt.map((t) => fmt(t)), 'ab-tick') + 10;
  const x = d3.scaleBand(rows.map((r) => r.day), [left, W - 6]).padding(0.3);
  const dow = (day) => { const m = String(day).match(/(\d+)\/(\d+)/); const yr = Number(String((dash.data('week_meta').data[0] || {}).start || '').slice(0, 4)) || new Date().getFullYear(); return m ? WK_DOW_ALL[new Date(yr, Number(m[1]) - 1, Number(m[2])).getDay()] : ''; };
  svg.append('g').selectAll('line').data(yt).join('line').attr('x1', left).attr('x2', W - 6).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).attr('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data(yt).join('text').attr('class', 'ab-tick').attr('x', left - 6).attr('y', (t) => y(t)).attr('dy', '0.35em').attr('text-anchor', 'end').text((t) => fmt(t));
  const bw = Math.min(32, x.bandwidth());
  rows.forEach((r) => {
    let acc = 0; const cx = x(r.day) + (x.bandwidth() - bw) / 2;
    segs.forEach((s) => {
      const v = Number(r[s.f + sfx]);
      if (v > 0) svg.append('rect').attr('x', cx).attr('width', bw).attr('y', y(acc + v)).attr('height', Math.max(1, y(acc) - y(acc + v) - 1)).attr('rx', 3).attr('fill', s.c);
      acc += v;
    });
    const wd = dow(r.day);
    svg.append('text').attr('class', 'ab-tick-strong').attr('x', x(r.day) + x.bandwidth() / 2).attr('y', y(acc) - 5).attr('text-anchor', 'middle').text(fmt(acc));
    svg.append('text').attr('class', 'ab-tick').attr('x', x(r.day) + x.bandwidth() / 2).attr('y', H - bottom + 16).attr('text-anchor', 'middle').text(r.day);
    svg.append('text').attr('class', 'ab-tick').attr('x', x(r.day) + x.bandwidth() / 2).attr('y', H - bottom + 30).attr('text-anchor', 'middle').text(`(${wd})`);
    svg.append('rect').attr('x', x(r.day)).attr('width', x.bandwidth()).attr('y', top).attr('height', H - bottom - top).attr('fill', 'transparent')
      .on('mousemove', (event) => showTip(ctx, event, `${r.day} (${wd}) · ${wkDir === 'OUT' ? `한국→${R}` : `${R}→한국`}`, segs.map((s) => `${s.n} ${r[s.f + sfx]}편`).concat([`합계 ${acc}편`])))
      .on('mouseleave', () => { tip.hidden = true; });
  });
}

function drawWeekDiff() {
  const ul = document.getElementById('week-diff');
  if (!ul) return;
  const d = dash.data('week_vs_original');
  if (d.status !== 'ok') { ul.replaceChildren(); return; }
  ul.replaceChildren(...d.data.map((r) => {
    const li = document.createElement('li');
    const b = document.createElement('span'); b.className = 'ab-strong'; b.textContent = `${r.flight} (${r.route})`;
    li.append(b, document.createTextNode(r.status));
    return li;
  }));
}

/* ===== 항공편 상세 ===== */
let dtDir = 'OUT', dtKr = 'ALL', dtPh = 'ALL', dtSort = null, dtSortDir = 1;
const dtSearch = document.getElementById('dt-search');
if (dtSearch) dtSearch.addEventListener('input', () => drawDetail());
document.querySelectorAll('#table-detail th button').forEach((b) => b.addEventListener('click', () => {
  if (dtSort === b.dataset.dsort) dtSortDir = -dtSortDir; else { dtSort = b.dataset.dsort; dtSortDir = 1; }
  document.querySelectorAll('#table-detail th').forEach((th) => th.removeAttribute('aria-sort'));
  b.parentElement.setAttribute('aria-sort', dtSortDir > 0 ? 'ascending' : 'descending');
  drawDetail();
}));
function dtChips(e, opts, cur, set, toggle) {
  e.className = 'ab-seg';
  e.replaceChildren(...opts.map(([v, n]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ab-seg-b'; b.textContent = n;
    b.setAttribute('aria-pressed', cur === v ? 'true' : 'false');
    b.addEventListener('click', () => { set(toggle && cur === v ? 'ALL' : v); drawDetail(); });
    return b;
  }));
}
function drawDetail() {
  const tbody = document.querySelector('#table-detail tbody');
  const d = dash.data('flight_detail');
  const foot = document.getElementById('dt-foot');
  if (d.status !== 'ok') { tbody.replaceChildren(); foot.replaceChildren(); return; }
  dtChips(document.getElementById('dt-chip-dir'), [['OUT', `한국 → ${R}`], ['IN', `${R} → 한국`]], dtDir, (v) => { dtDir = v; });
  dtChips(document.getElementById('dt-chip-kr'), [['ALL', '한국 전체']].concat(KR.map((k) => [k.code, k.name])), dtKr, (v) => { dtKr = v; });
  const names = new Map(d.data.map((r) => [r.ph_code, r.ph_airport]));
  dtChips(document.getElementById('dt-chip-ph'), [['ALL', `${R} 전체`]].concat(ORDER.filter((c) => names.has(c)).map((c) => [c, names.get(c)])), dtPh, (v) => { dtPh = v; });
  const q = dtSearch.value.trim().toLowerCase();
  let rows = d.data.filter((r) => r.dir === dtDir && (dtKr === 'ALL' || r.kr_code === dtKr) && (dtPh === 'ALL' || r.ph_code === dtPh)
    && (!q || `${r.airline} ${r.flight} ${r.codeshare} ${r.kr_airport} ${r.ph_airport} ${r.aircraft}`.toLowerCase().includes(q)));
  const numK = new Set(['weekly', 'weekly_seats']);
  if (dtSort) rows = rows.slice().sort((a, b) => (numK.has(dtSort) ? (Number(a[dtSort]) || -1) - (Number(b[dtSort]) || -1) : String(a[dtSort] ?? '').localeCompare(String(b[dtSort] ?? ''), 'ko')) * dtSortDir);
  const pair = dtDir === 'IN' ? ['ph_airport', 'kr_airport'] : ['kr_airport', 'ph_airport'];
  const fKr = document.getElementById('frow-kr'), fPh = document.getElementById('frow-ph');
  if (dtDir === 'IN') fKr.before(fPh); else fPh.before(fKr);
  const hrow = document.querySelector('#table-detail thead tr');
  pair.slice().reverse().forEach((f) => hrow.prepend(hrow.querySelector(`th[data-field="${f}"]`)));
  const cols = [...pair, 'airline', 'flight', 'codeshare', 'days', 'weekly', 'kr_time', 'time_basis', 'ph_arr', 'duration', 'aircraft', 'aircraft_basis', 'seats', 'weekly_seats', 'terminal', 'dates', 'source', 'note'].filter((c) => !DETAIL_HIDE.has(c));
  tbody.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr'); tr.dataset.key = r.id;
    if (PROJECT.includes(r.ph_code)) tr.className = 'ab-row-proj';
    cols.forEach((c) => {
      const td = document.createElement('td');
      const v = r[c];
      if (c === 'weekly_seats') td.textContent = v === null || v === undefined ? '—' : fmt(v);
      else if (c === 'weekly') td.textContent = v === null || v === undefined ? '—' : String(v);
      else if (c === 'aircraft') td.textContent = v || '확인 필요';
      else td.textContent = v === null || v === undefined ? '' : String(v);
      td.className = c === 'note' ? 'ab-warn' : (c === 'dates' ? '' : 'ab-nowrap');
      if (c === 'weekly' || c === 'weekly_seats') td.className += ' ab-num-c';
      if (c === 'aircraft' && !v) td.className += ' ab-zero';
      tr.append(td);
    });
    return tr;
  }));
  const known = rows.filter((r) => r.weekly !== null && r.weekly !== undefined);
  const wSum = known.reduce((s, r) => s + Number(r.weekly), 0);
  const seatRows = rows.filter((r) => r.weekly_seats !== null && r.weekly_seats !== undefined);
  const sSum = seatRows.reduce((s, r) => s + Number(r.weekly_seats), 0);
  const wi = cols.indexOf('weekly'), si = cols.indexOf('weekly_seats');
  const cells = [];
  const lab = document.createElement('td'); lab.colSpan = wi;
  const lb = document.createElement('span'); lb.textContent = '합계 ';
  const lm = document.createElement('span'); lm.className = 'ab-foot-m';
  lm.textContent = `${rows.length}행${rows.length - known.length ? ` · 요일 미확인 ${rows.length - known.length}행 제외` : ''}`;
  lab.append(lb, lm); cells.push(lab);
  const wt = document.createElement('td'); wt.className = 'ab-num-c';
  const wn = document.createElement('span'); wn.className = 'ab-foot-n'; wn.textContent = `${fmt(wSum)}회`; wt.append(wn); cells.push(wt);
  const mid = document.createElement('td'); mid.colSpan = si - wi - 1; cells.push(mid);
  const st = document.createElement('td'); st.className = 'ab-num-c';
  const sn = document.createElement('span'); sn.className = 'ab-foot-n'; sn.textContent = fmt(sSum);
  const sm = document.createElement('div'); sm.className = 'ab-foot-m'; sm.textContent = seatRows.length < rows.length ? `기종 미확인 ${rows.length - seatRows.length}행 제외` : '';
  st.append(sn, sm); cells.push(st);
  const rest = document.createElement('td'); rest.colSpan = cols.length - si - 1; cells.push(rest);
  foot.replaceChildren(...cells);
}

/* ===== 기종별 좌석 · 좌석 지도 ===== */
const SEAT_CLS = [
  { key: 'first', layout: 'first_layout', label: (s) => s.first_name || '일등석', color: () => dash.colors[3], pitch: 1.9 },
  { key: 'business', layout: 'business_layout', label: (s) => s.business_name || '비즈니스', color: () => dash.colors[0], pitch: 1.6 },
  { key: 'premium', layout: 'premium_layout', label: (s) => s.premium_name || '프리미엄 이코노미', color: () => dash.colors[1], pitch: 1.25 },
  { key: 'economy', layout: 'economy_layout', label: () => '이코노미', color: () => dash.colors[2], pitch: 1 },
];
// 좌석 범례: 데이터에 있는 등급만 (프리미엄 이코노미가 없는 허브는 기존과 같음)
function seatLegend(rows) {
  const hasP = rows.some((s) => Number(s.premium) > 0);
  return [['일등석', dash.colors[3]], ['비즈니스·프레스티지', dash.colors[0]]].concat(hasP ? [['프리미엄 이코노미', dash.colors[1]]] : []).concat([['이코노미', dash.colors[2]]]);
}
function drawSeatTable() {
  const tbody = document.querySelector('#table-seats tbody');
  const d = dash.data('seat_configs');
  if (d.status !== 'ok') { tbody.replaceChildren(); return; }
  const rt = dash.data('seat_routes');
  const rmap = new Map(rt.status === 'ok' ? rt.data.map((r) => [r.id, r]) : []);
  const hasP = d.data.some((s) => Number(s.premium) > 0);
  const pth = document.querySelector('#table-seats th[data-field="premium"]'); if (pth) pth.hidden = !hasP;
  tbody.replaceChildren(...d.data.map((s) => {
    const tr = document.createElement('tr'); tr.dataset.key = s.id;
    const r = rmap.get(s.id) || {};
    const cells = [
      [s.airline, 'ab-nowrap'], [s.aircraft, 'ab-nowrap'], [s.aircraft_code, 'ab-nowrap'],
      [fmt(Number(s.total)), 'ab-num-c'],
      [fmt(Number(s.first)), Number(s.first) ? 'ab-num-c' : 'ab-num-c ab-zero'],
      [fmt(Number(s.business)), Number(s.business) ? 'ab-num-c' : 'ab-num-c ab-zero'],
      ...(hasP ? [[fmt(Number(s.premium || 0)), Number(s.premium) ? 'ab-num-c' : 'ab-num-c ab-zero']] : []),
      [fmt(Number(s.economy)), 'ab-num-c'],
      [r.routes || '—', ''], [r.weekly === undefined ? '—' : `${r.weekly}회`, 'ab-num-c ab-nowrap'], [s.note || '', ''],
    ];
    cells.forEach(([v, c], i) => {
      const td = document.createElement('td'); if (c) td.className = c;
      if (i === 1) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ab-xlink ab-xlink-map'; b.textContent = v;
        b.title = '아래에 좌석 지도 보기'; b.setAttribute('aria-label', `${s.airline} ${v} 좌석 지도 보기`);
        b.setAttribute('aria-pressed', seatSel === s.id ? 'true' : 'false');
        b.addEventListener('click', () => { seatSel = seatSel === s.id ? null : s.id; drawSeats(); const e = document.getElementById('card-seat-one'); if (seatSel && e) e.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
        td.append(b);
      } else td.textContent = v;
      tr.append(td);
    });
    tr.id = `seatrow-${s.id}`;
    if (seatSel === s.id) tr.classList.add('ab-row-sel');
    return tr;
  }));
}
function drawSeatMaps() {
  const lg = document.getElementById('seat-legend');
  const sd = dash.data('seat_configs');
  lg.replaceChildren(...seatLegend(sd.status === 'ok' ? sd.data : []).map(([n, c]) => {
    const s = document.createElement('span'); const sw = document.createElement('span'); sw.className = 'ab-sw'; sw.style.background = c; s.append(sw, document.createTextNode(n)); return s;
  }));
  const ctx = prep('chart-seatmaps', 'seat_configs'); if (!ctx) return;
  const { box, rows } = ctx;
  box.replaceChildren();
  if (!rows.length) { emptyLine(box, '데이터가 없습니다'); return; }
  // 카드를 모두 붙인 뒤 그림을 그린다 (첫 카드만 폭 0으로 작게 그려지던 문제)
  const draws = rows.map((s) => buildSeatCard(s, box, ctx, 'seatmap-', TABS.includes('seats')));
  draws.forEach((f) => f());
}
function buildSeatCard(s, box, ctx, idPrefix, withBack) {
  const card = document.createElement('div'); card.className = 'ab-seat-card'; card.id = `${idPrefix}${s.id}`;
  const head = document.createElement('div'); head.className = 'ab-seat-head';
  const nm = document.createElement('div');
  const n1 = document.createElement('span'); n1.className = 'ab-seat-name'; n1.textContent = `${s.airline} · ${s.aircraft}`;
  const n2 = document.createElement('span'); n2.className = 'ab-seat-code'; n2.textContent = `${s.airline_code} · ${s.aircraft_code} · ${s.size}`;
  nm.append(n1, n2);
  const tot = document.createElement('div'); tot.className = 'ab-seat-total'; tot.textContent = `${fmt(Number(s.total))}석`;
  head.append(nm, tot);
  const cabins = SEAT_CLS.filter((c) => Number(s[c.key]) > 0).map((c) => {
    const groups = String(s[c.layout] || '3-3').split('-').map(Number);
    const per = d3.sum(groups); const n = Number(s[c.key]);
    return { ...c, name: c.label(s), n, groups, per, layout: s[c.layout], nrows: Math.ceil(n / per), fill: c.color() };
  });
  const cls = document.createElement('div'); cls.className = 'ab-seat-cls';
  cabins.forEach((c) => {
    const e = document.createElement('span'); const sw = document.createElement('span'); sw.className = 'ab-sw'; sw.style.background = c.fill;
    const b = document.createElement('b'); b.textContent = `${fmt(c.n)}석`;
    e.append(sw, document.createTextNode(`${c.name} `), b, document.createTextNode(` (${c.layout})`)); cls.append(e);
  });
  const svgWrap = document.createElement('div'); svgWrap.className = 'ab-seat-svg';
  const foot = document.createElement('div'); foot.className = 'ab-seat-foot';
  const nt = document.createElement('span'); nt.textContent = s.note || '';
  const src = document.createElement('a'); src.href = s.source_url; src.target = '_blank'; src.rel = 'noopener noreferrer'; src.textContent = `출처: ${s.source_name}`;
  if (withBack) {
    const back = document.createElement('button'); back.type = 'button'; back.className = 'ab-xlink ab-xlink-tbl'; back.textContent = '좌석 수 표에서 보기';
    back.addEventListener('click', () => goSeatLink('seats', `seatrow-${s.id}`));
    foot.append(nt, back, src);
  } else foot.append(nt, src);
  const memo = document.createElement('div'); memo.className = 'ab-cargo';
  const mh = document.createElement('div'); mh.className = 'ab-cargo-h'; mh.textContent = '화물칸(벨리) 메모';
  const ml = document.createElement('dl');
  [['적재 가능 무게', s.cargo_weight], ['화물칸 용적', s.cargo_volume], ['컨테이너', s.cargo_uld]].forEach(([k, v]) => {
    if (!v || v === '—') return;
    const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; ml.append(dt, dd);
  });
  const ms = document.createElement('div'); ms.className = 'ab-cargo-s'; ms.textContent = s.cargo_src ? `근거: ${s.cargo_src}` : '';
  memo.append(mh, ml, ms);
  card.append(head, cls, svgWrap);
  if (ml.children.length || s.cargo_src) card.append(memo);
  card.append(foot);
  box.append(card);
  return () => drawSeatSvg(s, svgWrap, cabins, ctx);
}
function drawSeatSvg(s, svgWrap, cabins, ctx) {
  // 좌석 개략도 (단위: 이코노미 좌석 1개 = 1)
  const aisle = 0.9, cabGap = 1.4, nose = 3, tail = 2;
  const across = (c) => c.per + (c.groups.length - 1) * aisle;
  const maxAcross = d3.max(cabins, across);
  const lenUnits = nose + tail + d3.sum(cabins, (c) => c.nrows * c.pitch) + (cabins.length - 1) * cabGap;
  const W = svgWrap.clientWidth || 300;
  const u = Math.min(11, W / lenUnits);
  const pad = u * 0.8;
  const H = maxAcross * u + pad * 2;
  const svg = d3.select(svgWrap).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
    .attr('aria-label', `${s.airline} ${s.aircraft} 좌석 개략도, 총 ${s.total}석`);
  const bodyW = lenUnits * u;
  svg.append('rect').attr('x', 0.5).attr('y', 0.5).attr('width', bodyW - 1).attr('height', H - 1).attr('rx', H / 2).attr('ry', H / 2)
    .attr('fill', 'none').attr('stroke', 'var(--color-border-line)');
  let x = nose * u;
  cabins.forEach((c, ci) => {
    const g = svg.append('g').style('cursor', 'default');
    const cw = c.nrows * c.pitch * u;
    const y0 = pad + (maxAcross - across(c)) * u / 2;
    g.append('rect').attr('x', x - u * 0.2).attr('y', pad * 0.4).attr('width', cw + u * 0.4).attr('height', H - pad * 0.8).attr('fill', 'transparent');
    const seats = [];
    for (let i = 0; i < c.n; i++) {
      const row = Math.floor(i / c.per), k = i % c.per;
      let gi = 0, acc = 0; while (k >= acc + c.groups[gi]) { acc += c.groups[gi]; gi++; }
      seats.push({ x: x + row * c.pitch * u, y: y0 + (k + gi * aisle) * u });
    }
    const sw = Math.max(1, c.pitch * u - Math.max(1, u * 0.25)), sh = Math.max(1, u - Math.max(1, u * 0.25));
    g.selectAll('rect.seat').data(seats).join('rect').attr('class', 'seat')
      .attr('x', (p) => p.x).attr('y', (p) => p.y).attr('width', sw).attr('height', sh).attr('rx', Math.min(2, u * 0.2)).attr('fill', c.fill);
    g.on('mousemove', (ev) => showTip(ctx, ev, `${s.airline} · ${s.aircraft}`, [`${c.name} ${fmt(c.n)}석`, `배치 ${c.layout} · 약 ${c.nrows}열`]))
      .on('mouseleave', () => { ctx.tip.hidden = true; });
    x += cw + (ci < cabins.length - 1 ? cabGap * u : 0);
  });
}
function goSeatLink(tab, targetId) {
  show(tab, true);
  requestAnimationFrame(() => {
    const e = document.getElementById(targetId); if (!e) return;
    e.scrollIntoView({ behavior: 'smooth', block: 'center' });
    e.classList.remove('ab-flash'); void e.offsetWidth; e.classList.add('ab-flash');
    setTimeout(() => e.classList.remove('ab-flash'), 2200);
  });
}
let seatSel = null;
function drawSeatOne() {
  const wrap = document.getElementById('card-seat-one');
  const chart = document.getElementById('chart-seatone');
  const box = chart.querySelector('.ab-box');
  const tip = chart.querySelector('.ab-tip');
  const d = dash.data('seat_configs');
  const s = d.status === 'ok' ? d.data.find((r) => r.id === seatSel) : null;
  if (!s) { wrap.hidden = true; box.replaceChildren(); return; }
  wrap.hidden = false; tip.hidden = true;
  document.getElementById('seat-one-title').textContent = `좌석 지도 · ${s.airline} ${s.aircraft}`;
  const lg = document.getElementById('seat-one-legend');
  lg.replaceChildren(...seatLegend(d.data).map(([n, c]) => {
    const e = document.createElement('span'); const sw = document.createElement('span'); sw.className = 'ab-sw'; sw.style.background = c; e.append(sw, document.createTextNode(n)); return e;
  }));
  box.replaceChildren();
  buildSeatCard(s, box, { wrap: chart, box, tip, rows: d.data }, 'seatone-', false)();
}
const seatClose = document.getElementById('seat-one-close');
if (seatClose) seatClose.addEventListener('click', () => { seatSel = null; drawSeats(); });
function drawSeats() { drawSeatTable(); drawSeatOne(); }

/* ===== 신규·예정 노선 ===== */
function drawWinter() {
  const wrap = document.getElementById('chart-winter');
  const tip = wrap.querySelector('.ab-tip');
  const tbody = document.querySelector('#table-winter tbody');
  const list = document.getElementById('winter-fn');
  const d = dash.data('winter_planned');
  tip.hidden = true;
  if (d.status !== 'ok') { tbody.replaceChildren(); list.replaceChildren(); return; }
  const srcs = (r) => [1, 2, 3].map((i) => ({ name: r[`src${i}_name`], date: r[`src${i}_date`], title: r[`src${i}_title`], url: r[`src${i}_url`] })).filter((s) => s.name);
  const place = (e) => {
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect(), er = e.getBoundingClientRect();
    let x = er.right - wr.left + 8, y = er.top - wr.top;
    if (x + tip.offsetWidth > wr.width) x = Math.max(0, er.left - wr.left - tip.offsetWidth - 8);
    if (y + tip.offsetHeight > wr.height) y = Math.max(0, wr.height - tip.offsetHeight);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const showFn = (e, r) => {
    const h = document.createElement('div'); h.className = 'ab-tip-h'; h.textContent = `각주 ${r.fn} · ${r.kr_airport}→${r.ph_airport} ${r.airline}`;
    const parts = [h];
    srcs(r).forEach((s) => {
      const p = document.createElement('div'); p.className = 'ab-tip-src';
      const b = document.createElement('b'); b.textContent = `${s.name} (${s.date})`;
      p.append(b, document.createTextNode(` 「${s.title}」`)); parts.push(p);
    });
    if (r.note) { const n = document.createElement('div'); n.className = 'ab-tip-src'; n.textContent = r.note; parts.push(n); }
    tip.replaceChildren(...parts);
    place(e);
  };
  const cols = ['status', 'fn', 'kr_airport', 'ph_airport', 'airline', 'kind', 'period', 'days', 'weekly', 'out_time', 'in_time', 'note'];
  if (!d.data.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = cols.length; td.className = 'ab-zero'; td.textContent = '확인된 신규·예정 노선이 없습니다.'; tr.append(td);
    tbody.replaceChildren(tr); list.replaceChildren(); return;
  }
  tbody.replaceChildren(...d.data.map((r) => {
    const tr = document.createElement('tr'); tr.dataset.key = r.id;
    cols.forEach((c) => {
      const td = document.createElement('td');
      if (c === 'status') {
        const s = document.createElement('span'); s.className = `ab-st ${r.status === '예정' ? 'ab-st-plan' : 'ab-st-push'}`; s.textContent = r.status; td.append(s); td.className = 'ab-nowrap';
      } else if (c === 'fn') {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ab-fn'; b.textContent = String(r.fn);
        b.setAttribute('aria-label', `각주 ${r.fn}: 근거 기사 보기`);
        b.addEventListener('mouseenter', () => showFn(b, r)); b.addEventListener('focus', () => showFn(b, r));
        b.addEventListener('mouseleave', () => { tip.hidden = true; }); b.addEventListener('blur', () => { tip.hidden = true; });
        td.append(b);
      } else {
        td.textContent = c === 'weekly' ? (has(r.weekly) ? `${r.weekly}회` : '미정') : (r[c] ?? '');
        td.className = (c === 'note' || c === 'out_time' || c === 'in_time') ? '' : 'ab-nowrap';
      }
      tr.append(td);
    });
    return tr;
  }));
  list.replaceChildren(...d.data.map((r) => {
    const li = document.createElement('li'); li.value = r.fn;
    srcs(r).forEach((s, i) => {
      if (i) li.append(document.createTextNode(' · '));
      const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `${s.name} ${s.date} 「${s.title}」`;
      li.append(a);
    });
    return li;
  }));
}

function drawWeek() { drawWeekMatrix(); drawWeekDiff(); }

function draw() {
  if (current === 'supply') ensureDestCards();
  fillMarks();
  if (current === 'supply') { drawDest(); drawTime(); drawAirline(); drawScheduleTimeline(); drawIssues(); }
  if (current === 'week') drawWeek();
  if (current === 'days') drawWeekDay();
  if (current === 'routes') drawWinter();
  if (current === 'detail') drawDetail();
  if (current === 'seats') drawSeats();
  if (current === 'seatmap') drawSeatMaps();
  if (current === 'glossary') drawGlossary();
}

const START = window.DASH_START_HASH || location.hash.slice(1);
const startTab = TABS.includes(START) ? START : TABS[0];
show(startTab, false);
// #탭 은 페이지 로딩이 끝난 뒤 다시 붙인다 (로딩 중에 붙이면 브라우저가 그 섹션 위치로 내려감)
if (startTab === START) window.addEventListener('load', () => setTimeout(() => dash.setLink(startTab), 0));
dash.onData(draw);
