"""항공 데이터 허브 — GitHub Pages 빌드.

  python -I scripts/build.py            # 모든 허브 빌드 + 검사
  python -I scripts/build.py --check    # 검사만 (쓰지 않음)

입력 (직접 고치는 파일):
  template/hub.html, hub.js, hub.css, tokens.css, dash-shim.js   공통 화면
  hubs/<slug>/hub.json        나라별 설정 (공항 목록·중점 공항·라벨·탭)
  hubs/<slug>/text/*.html     나라별 문구 조각 ({{> 이름}} 자리에 들어감)
  hubs/<slug>/datasets.json   데이터셋 제목·설명·갱신일
  hubs/<slug>/data/*.json     데이터셋 원본 (schedule_week·week_meta 는 collect_week.py 가 만든다)

출력 (빌드 결과 — 직접 고치지 않음):
  docs/index.html             허브 목록 (GitHub Pages 가 docs/ 를 배포)
  docs/assets/                공통 화면 파일 복사본
  docs/<slug>/index.html, docs/<slug>/data/*.json·csv
"""
from __future__ import annotations

import csv
import html
import io
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TPL = ROOT / "template"
HUBS = ROOT / "hubs"
SITE = ROOT / "docs"

DATASETS = ["flights", "glossary", "schedule_timeline", "schedule_week", "seat_configs", "week_meta", "winter_planned"]
D3_URL = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"
FONTS_URL = ("https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600"
             "&family=Noto+Serif+KR:wght@400;600&display=swap")
ASSETS = ["tokens.css", "hub.css", "dash-shim.js", "hub.js"]

# 공개 사이트에 나오면 안 되는 것
# - 메일 주소: 특정 주소를 여기 적으면 그 자체가 공개되므로, 메일 주소 형식이면 모두 막는다 (연락처는 "AVIAREPS Korea"로만 표기)
# - claude.ai 아티팩트 전용 코드(트리거 호출), 개인 이니셜 표기
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
FORBIDDEN = ["trig_", "claude.use(", "fire_trigger", "Claude Code Remote", "EJ 제공", "EJ가 제공"]


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def head(title: str, desc: str, prefix: str) -> str:
    return f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS_URL}">
<link rel="stylesheet" href="{prefix}assets/tokens.css">
'''


def to_csv(rows: list[dict]) -> str:
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
    return "﻿" + buf.getvalue()


def load_hub(d: Path) -> dict:
    cfg = json.loads((d / "hub.json").read_text(encoding="utf-8"))
    meta = json.loads((d / "datasets.json").read_text(encoding="utf-8")) if (d / "datasets.json").exists() else {}
    data = {}
    for ds in DATASETS:
        p = d / "data" / f"{ds}.json"
        data[ds] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    frags = {p.stem: p.read_text(encoding="utf-8").strip() for p in (d / "text").glob("*.html")} if (d / "text").exists() else {}
    return {"dir": d, "cfg": cfg, "meta": meta, "data": data, "frags": frags}


def week_basis(hub: dict) -> str:
    w = hub["data"]["week_meta"]
    if not w:
        return ""
    return f'주간 스케줄 {w[0].get("label", "")} · {w[0].get("queried", "")} 조회'


def render_hub(hub: dict) -> str:
    cfg, data, meta = hub["cfg"], hub["data"], hub["meta"]
    page = (TPL / "hub.html").read_text(encoding="utf-8")

    downloads = "\n".join(
        f'          <li><span title="{esc(meta.get(ds, {}).get("description", ""))}">{esc(meta.get(ds, {}).get("title", ds))}'
        f' <span class="ab-dl-m">· {len(data[ds])}행{(" · " + meta[ds]["updated"]) if meta.get(ds, {}).get("updated") else ""}</span></span>'
        f'<span><a href="data/{ds}.csv" download>CSV</a><a href="data/{ds}.json">JSON</a></span></li>'
        for ds in DATASETS if data[ds]
    )

    def frag(m: re.Match) -> str:
        return hub["frags"].get(m.group(1), "")

    def var(m: re.Match) -> str:
        k = m.group(1)
        if k == "downloads":
            return downloads
        v = cfg.get(k, "")
        return v if isinstance(v, str) else str(v)

    page = re.sub(r"\{\{>\s*(\w+)\s*\}\}", frag, page)
    page = re.sub(r"\{\{(\w+)\}\}", var, page)
    left = re.findall(r"\{\{[^}]*\}\}", page)
    if left:
        raise SystemExit(f"{cfg['slug']}: 채우지 못한 자리표시 {left}")

    hub_js_cfg = {k: cfg[k] for k in cfg if k not in ("lead", "card_desc", "winter_note", "how_note")}
    return (head(cfg["title"], cfg.get("card_desc", cfg["lead"]), "../")
            + f'<link rel="stylesheet" href="../assets/hub.css">\n'
            + f'<script src="{D3_URL}"></script>\n'
            + f'<script>window.DASH_SOURCES = {json.dumps(DATASETS)};\nwindow.HUB = {json.dumps(hub_js_cfg, ensure_ascii=False)};</script>\n'
            + '<script src="../assets/dash-shim.js"></script>\n</head>\n<body>\n<div id="dash-root">\n'
            + page
            + f'<footer class="site-foot">\n  <span>AVIAREPS Korea</span>\n  <span>{esc(week_basis(hub))}</span>\n</footer>\n</div>\n'
            + '<script src="../assets/hub.js"></script>\n</body>\n</html>\n')


def render_index(hubs: list[dict]) -> str:
    cards = []
    for h in hubs:
        c = h["cfg"]
        out = sum(int(r.get("weekly") or 0) for r in h["data"]["schedule_week"] if r.get("dir") == "OUT")
        cards.append(f'''    <a class="hub-card" href="{esc(c["slug"])}/">
      <span class="hub-card-t">{esc(c.get("card_title", c["title"]))}</span>
      <span class="hub-card-d">{esc(c.get("card_desc", ""))}</span>
      <span class="hub-card-m">한국 출발 주 {out}회 · {esc(week_basis(h))}</span>
    </a>''')
    return (head("항공 데이터 허브", "나라별 한국 직항 운항·기종·좌석 데이터", "")
            + '</head>\n<body>\n<div id="dash-root">\n<main class="hub-index">\n'
            + '  <h1 class="ab-title">항공 데이터 허브</h1>\n'
            + '  <p class="ab-lead">관심 나라별로 한국과 오가는 직항의 주간 운항 스케줄, 항공편 상세, 기종별 좌석, 신규·예정 노선을 같은 형식으로 정리합니다.</p>\n'
            + '  <div class="hub-list">\n' + "\n".join(cards) + '\n  </div>\n</main>\n'
            + '<footer class="site-foot">\n  <span>AVIAREPS Korea</span>\n  <span>공항 공식 시간표(인천국제공항공사·한국공항공사) 기준</span>\n</footer>\n</div>\n</body>\n</html>\n')


def main() -> None:
    check_only = "--check" in sys.argv
    hubs = sorted((load_hub(d) for d in HUBS.iterdir() if (d / "hub.json").exists()), key=lambda h: (h["cfg"].get("order", 99), h["cfg"]["slug"]))
    files: dict[str, str] = {"index.html": render_index(hubs)}
    for a in ASSETS:
        files[f"assets/{a}"] = (TPL / a).read_text(encoding="utf-8")
    for h in hubs:
        slug = h["cfg"]["slug"]
        files[f"{slug}/index.html"] = render_hub(h)
        for ds in DATASETS:
            files[f"{slug}/data/{ds}.json"] = json.dumps(h["data"][ds], ensure_ascii=False, indent=1) + "\n"
            if h["data"][ds]:
                files[f"{slug}/data/{ds}.csv"] = to_csv(h["data"][ds])

    problems = [f"{name}: 금지 문자열 '{bad}'" for name, text in files.items() for bad in FORBIDDEN if bad in text]
    problems += [f"{name}: 메일 주소 형식 '{m}'" for name, text in files.items() for m in EMAIL_RE.findall(text)]
    if problems:
        print("검사 실패:\n - " + "\n - ".join(problems))
        raise SystemExit(1)
    if check_only:
        print(f"검사 통과 (허브 {len(hubs)}개, 파일 {len(files)}개) — 쓰지 않음")
        return

    for h in hubs:  # 허브별 data 폴더는 통째로 다시 만든다 (지운 데이터셋이 남지 않게)
        shutil.rmtree(SITE / h["cfg"]["slug"] / "data", ignore_errors=True)
    for rel, text in files.items():
        p = SITE / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
    print(f"빌드 완료: 허브 {len(hubs)}개, 파일 {len(files)}개, 금지 문자열·메일 주소 0건")
    for h in hubs:
        print(f"  {h['cfg']['slug']:<14} " + " ".join(f"{ds}={len(h['data'][ds])}" for ds in DATASETS))


if __name__ == "__main__":
    main()
