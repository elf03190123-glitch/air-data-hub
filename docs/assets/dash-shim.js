/*
 * claude.ai Data 유형 아티팩트의 `dash` 런타임을 정적 사이트에서 흉내 내는 최소 구현.
 * 데이터 허브 페이지가 쓰는 것만 있다: dash.data / dash.calc / dash.colors / dash.setLink / dash.onData.
 * 원천 데이터는 data/<이름>.json 에서 불러온다(목록은 window.DASH_SOURCES, build.py 가 넣는다).
 */
(function () {
  'use strict';
  var SOURCES = window.DASH_SOURCES || [];
  var raw = {};          // id -> { status, data }
  var calcs = {};        // id -> { inputs, fn }
  var memo = {};         // id -> { status, data } (calc 결과 캐시)
  var listeners = [];
  var loaded = false;

  SOURCES.forEach(function (id) { raw[id] = { status: 'loading', data: [] }; });

  function data(id, stack) {
    if (raw[id]) return raw[id];
    if (!calcs[id]) return { status: 'error', data: [], error: 'unknown source ' + id };
    if (memo[id]) return memo[id];
    stack = stack || [];
    if (stack.indexOf(id) >= 0) return { status: 'error', data: [], error: 'cycle ' + stack.concat(id).join(' > ') };
    var spec = calcs[id];
    var args = [];
    for (var i = 0; i < spec.inputs.length; i++) {
      var d = data(spec.inputs[i], stack.concat(id));
      if (d.status !== 'ok') {
        var r = { status: d.status === 'loading' ? 'loading' : 'error', data: [] };
        if (r.status === 'error') memo[id] = r;
        return r;
      }
      args.push(d.data);
    }
    try {
      memo[id] = { status: 'ok', data: spec.fn.apply(null, args) || [] };
    } catch (e) {
      console.error('[dash] calc 실패:', id, e);
      memo[id] = { status: 'error', data: [], error: String(e) };
    }
    return memo[id];
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[dash] onData 처리 실패:', e); }
    });
  }

  window.dash = {
    colors: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'],
    calc: function (id, spec) { calcs[id] = spec; delete memo[id]; },
    data: function (id) { return data(id); },
    setLink: function (tab) {
      try { history.replaceState(null, '', '#' + tab); } catch (e) { location.hash = tab; }
    },
    onData: function (fn) { listeners.push(fn); if (loaded) fn(); },
  };

  function load() {
    Promise.all(SOURCES.map(function (id) {
      return fetch('data/' + id + '.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); })
        .then(function (rows) { raw[id] = { status: 'ok', data: rows }; })
        .catch(function (e) { console.error('[dash] 데이터 불러오기 실패:', id, e); raw[id] = { status: 'error', data: [] }; });
    })).then(function () {
      memo = {};
      loaded = true;
      notify();
      // #탭 주소로 열면 브라우저가 섹션 위치로 내려가 제목·탭이 가려지므로 맨 위로 되돌림
      if (location.hash && document.querySelector('.ab-tab[data-tab="' + location.hash.slice(1) + '"]')) window.scrollTo(0, 0);
    });
  }

  // 화면 폭이 바뀌면 차트를 다시 그린다 (SVG 가 clientWidth 기준으로 그려짐)
  var t = null, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(function () { if (loaded) notify(); }, 150);
  });

  // 주소창의 #탭 을 바꾸거나 뒤로 가기를 하면 그 탭을 연다
  window.addEventListener('hashchange', function () {
    var tab = document.querySelector('.ab-tab[data-tab="' + location.hash.slice(1) + '"]');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
  });

  // 다크/라이트 전환 시 다시 그림
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (loaded) notify(); });
  } catch (e) { /* 구형 브라우저 */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
