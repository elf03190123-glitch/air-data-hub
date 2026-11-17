"""주간 운항 스케줄 수집 — 공항 공식 시간표 → hubs/<slug>/data/schedule_week.json, week_meta.json

  python -I scripts/collect_week.py central-asia                  # 오늘(KST)부터 7일
  python -I scripts/collect_week.py central-asia --start 2026-11-15
  python -I scripts/collect_week.py central-asia --dry-run        # 저장하지 않고 요약만

출처
  인천(ICN): 인천국제공항공사 여객 출·도착 시간표 (날짜별 실제 운항, 오늘 기준 -13일~+6일만 조회 가능)
     POST https://www.airport.kr/dep/ap_ko/getDepPasSchList.do  (도착은 /arr/ap_ko/getArrPasSchList.do)
     — 먼저 /ap_ko/869/subview.do 를 열어 쿠키를 받아야 한다. airport=<현지 공항 코드>, daySel=YYYYMMDD
     — 공동운항은 같은 masterflight 의 다른 fnumber 로 온다. 실제 운항편은 fnumber == masterflight.
  지방공항(PUS·CJJ·TAE·MWX·YNY·CJU·GMP): 한국공항공사 국제선 운항스케줄 (요일·적용 기간)
     POST https://www.airport.co.kr/gimhae/ajaxf/frFlightSchSvc/getFilghtSchInternational.do
     pAirport=<한국 공항>, pSelType=sel, pFindDate=YYYY-MM-DD, pIotype=ALL  → data.outList / data.inList
     — 공동운항 정보 없음. 같은 편이 여러 행(기간·요일별)으로 나뉘어 올 수 있어 날짜로 합친다.

hub.json 에서 쓰는 값: R, dest[].code/name, focus, kr[].code/name, collect.kac(조회할 지방공항), collect.season_note
결과는 날짜별로 펼쳐 센 뒤 (방향·한국 공항·현지 공항·편명·시각) 단위로 묶는다.
"""
from __future__ import annotations

import datetime as dt
import http.cookiejar
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (air-data-hub schedule collector)"}
DOW = ["월", "화", "수", "목", "금", "토", "일"]
KAC_NAMES = {"PUS": "부산(김해)", "CJJ": "청주", "TAE": "대구", "MWX": "무안", "YNY": "양양", "CJU": "제주", "GMP": "김포"}
KAC_DAY_FIELDS = ["INTERNATIONAL_MON", "INTERNATIONAL_TUE", "INTERNATIONAL_WED", "INTERNATIONAL_THU", "INTERNATIONAL_FRI", "INTERNATIONAL_SAT", "INTERNATIONAL_SUN"]


def post(opener, url: str, data: dict, headers: dict | None = None) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={**UA, **(headers or {})})
    for attempt in range(3):
        try:
            return json.loads(opener.open(req, timeout=40).read().decode("utf-8"))
        except Exception:  # noqa: BLE001 — 네트워크 일시 오류는 두 번 더 시도
            if attempt == 2:
                raise
            time.sleep(2)
    raise RuntimeError("unreachable")


def collect_icn(days: list[dt.date], dests: list[str]) -> list[dict]:
    """인천 출·도착을 날짜·현지 공항별로 받아 운항편 단위 레코드로 돌려준다."""
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.open(urllib.request.Request("https://www.airport.kr/ap_ko/869/subview.do", headers=UA), timeout=40).read()
    out = []
    for kind, page, api in [("OUT", 869, "dep/ap_ko/getDepPasSchList.do"), ("IN", 872, "arr/ap_ko/getArrPasSchList.do")]:
        for ap in dests:
            for day in days:
                ymd = day.strftime("%Y%m%d")
                d = post(op, "https://www.airport.kr/" + api, {
                    "intg": "", "keyWord": "", "curDate": ymd, "startTime": "0000", "airPort": "", "endTime": "2359",
                    "siteId": "ap_ko", "langSe": "ko", "termId": "", "daySel": ymd, "fromTime": "0000", "toTime": "2359",
                    "airport": ap, "airline": "", "airplane": ""},
                    {"X-Requested-With": "XMLHttpRequest", "Referer": f"https://www.airport.kr/ap_ko/{page}/subview.do"})
                lst = d.get("scheduleList") or []
                ops = [s for s in lst if s.get("fnumber") == s.get("masterflight")]
                for s in ops:
                    codes = sorted({x["fnumber"] for x in lst if x.get("masterflight") == s["masterflight"] and x["fnumber"] != s["fnumber"]})
                    via = [c for c in (s.get("p2code"), s.get("p3code")) if c]
                    out.append({"dir": kind, "kr_code": "ICN", "ph_code": ap, "airline": s.get("airlineNameKo", ""), "flight": s["fnumber"],
                                "codeshare": ", ".join(codes), "time": s.get("stime", ""), "terminal": s.get("terminal", ""), "date": day,
                                "via": via, "first_port": s.get("p1code", ""), "source": "인천국제공항공사 여객 출·도착 시간표"})
                time.sleep(0.25)
    return out


def collect_kac(days: list[dt.date], dests: list[str], airports: list[str]) -> list[dict]:
    op = urllib.request.build_opener()
    want = set(dests)
    out = []
    for kr in airports:
        for day in days:
            d = post(op, "https://www.airport.co.kr/gimhae/ajaxf/frFlightSchSvc/getFilghtSchInternational.do",
                     {"pAirport": kr, "pSelType": "sel", "pFindDate": day.isoformat(), "pIotype": "ALL"})
            data = d.get("data") or {}
            for kind, key in [("OUT", "outList"), ("IN", "inList")]:
                for r in data.get(key) or []:
                    if r.get("INTERNATIONAL_AIRPORT_INTE") not in want:
                        continue
                    if r.get(KAC_DAY_FIELDS[day.weekday()]) != "Y":
                        continue
                    t = str(r.get("INTERNATIONAL_TIME", ""))
                    out.append({"dir": kind, "kr_code": kr, "ph_code": r["INTERNATIONAL_AIRPORT_INTE"], "airline": r.get("AIRLINE_KOREAN", ""),
                                "flight": r.get("INTERNATIONAL_NUM", ""), "codeshare": "", "time": f"{t[:2]}:{t[2:4]}" if len(t) == 4 else t,
                                "terminal": "", "date": day, "via": [], "first_port": "", "source": "한국공항공사 국제선 운항스케줄"})
            time.sleep(0.25)
    # 같은 날 같은 편이 여러 행으로 오면 하나로
    seen, uniq = set(), []
    for r in out:
        k = (r["dir"], r["kr_code"], r["ph_code"], r["flight"], r["time"], r["date"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    return uniq


def days_label(dates: list[dt.date], all_days: list[dt.date]) -> str:
    if len(dates) == len(all_days) == 7:
        return "매일"
    return "·".join(DOW[d] for d in sorted({x.weekday() for x in dates}, key=lambda w: w))


def build_rows(recs: list[dict], cfg: dict, all_days: list[dt.date]) -> list[dict]:
    names = {d["code"]: d["name"] for d in cfg["dest"]}
    krn = {k["code"]: k["name"] for k in cfg["kr"]}
    R = cfg["R"]
    focus = set(cfg.get("focus") or [])
    aname = cfg.get("collect", {}).get("airline_names", {})  # 공항 사이트 표기 → 페이지 표기
    # 같은 편이 날에 따라 시각만 조금 다르면 한 줄로 합친다 (많은 쪽 시각을 대표로, 나머지는 비고에).
    # 같은 날 같은 편명이 두 번 뜨면(시각이 다른 별개 운항) 시각별로 따로 둔다.
    by_flight: dict[tuple, list[dict]] = {}
    for r in recs:
        by_flight.setdefault((r["dir"], r["kr_code"], r["ph_code"], r["flight"]), []).append(r)
    groups: dict[tuple, dict] = {}
    for fk, rs in by_flight.items():
        per_day: dict = {}
        for r in rs:
            per_day.setdefault(r["date"], set()).add(r["time"])
        split = any(len(ts) > 1 for ts in per_day.values())
        for r in rs:
            k = fk + ((r["time"],) if split else ("",))
            g = groups.setdefault(k, {**r, "dates": set(), "codes": set(), "times": {}})
            g["dates"].add(r["date"])
            g["times"][r["date"]] = r["time"]
            g["codes"].update(c for c in r["codeshare"].split(", ") if c)
    rows = []
    for (d, kr, ph, fl, _), g in groups.items():
        dates = sorted(g["dates"])
        counts: dict[str, int] = {}
        for t in g["times"].values():
            counts[t] = counts.get(t, 0) + 1
        tm = sorted(counts, key=lambda t: (-counts[t], t))[0]
        notes = []
        others = sorted({(x, t) for x, t in g["times"].items() if t != tm})
        if others:
            word = "출발" if d == "OUT" else "도착"
            notes.append("다른 시각: " + ", ".join(f"{DOW[x.weekday()]}({x.month}/{x.day}) {t} {word}" for x, t in others))
        if g["via"]:
            notes.append(f"경유: {'·'.join(g['via'])}")
        rows.append({
            "id": f"{d}-{kr}-{fl}-{tm.replace(':', '')}", "dir": d, "direction": f"한국→{R}" if d == "OUT" else f"{R}→한국",
            "kr_code": kr, "kr_airport": krn.get(kr, KAC_NAMES.get(kr, kr)), "ph_code": ph, "ph_airport": names.get(ph, ph),
            "project": "Y" if ph in focus else "", "airline": aname.get(g["airline"], g["airline"]), "flight": fl, "codeshare": ", ".join(sorted(g["codes"])),
            "days": days_label(dates, all_days), "weekly": len(dates), "kr_time": tm, "time_basis": "한국 출발" if d == "OUT" else "한국 도착",
            "terminal": g["terminal"], "dates": "·".join(f"{x.month}/{x.day}" for x in dates), "source": g["source"], "note": "; ".join(notes),
        })
    order = {c["code"]: i for i, c in enumerate(cfg["dest"])}
    rows.sort(key=lambda r: (r["dir"] != "OUT", order.get(r["ph_code"], 99), r["kr_code"] != "ICN", r["kr_time"]))
    return rows


def main() -> None:
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    slug = args[0]
    hub_dir = ROOT / "hubs" / slug
    cfg = json.loads((hub_dir / "hub.json").read_text(encoding="utf-8"))
    kst_today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
    start = dt.date.fromisoformat(args[args.index("--start") + 1]) if "--start" in args else kst_today
    days = [start + dt.timedelta(i) for i in range(7)]
    dests = [d["code"] for d in cfg["dest"]]
    kr_codes = [k["code"] for k in cfg["kr"]]
    kac = [a for a in (cfg.get("collect", {}).get("kac") or []) if a != "ICN"]

    recs = collect_icn(days, dests) if "ICN" in kr_codes else []
    recs += collect_kac(days, dests, sorted(set(kac) | {k for k in kr_codes if k != "ICN"}))
    rows = build_rows(recs, cfg, days)

    extra = sorted({r["kr_code"] for r in rows} - set(kr_codes))
    label = f"{days[0].month}/{days[0].day}~{days[-1].month}/{days[-1].day}"
    meta = [{
        "label": label, "start": days[0].isoformat(), "end": days[-1].isoformat(), "queried": kst_today.isoformat(),
        "days": "·".join(f"{d.month}/{d.day}" for d in days),
        "kr_airports": "·".join(k["name"] for k in cfg["kr"]),
        "season_note": cfg.get("collect", {}).get("season_note", ""),
        "updated_by": "collect_week.py (공항 사이트 조회)",
    }]
    out_n = sum(r["weekly"] for r in rows if r["dir"] == "OUT")
    in_n = sum(r["weekly"] for r in rows if r["dir"] == "IN")
    summary = [f"{slug} {label}: 한국 출발 {out_n}회 · 도착 {in_n}회 · {len(rows)}행"]
    for r in rows:
        summary.append(f"  {r['dir']:<3} {r['kr_code']}-{r['ph_code']} {r['flight']:<7} {r['kr_time']} {r['days']:<12} x{r['weekly']} {r['airline']} {r['codeshare']} {r['note']}")
    if extra:
        summary.append(f"  ! hub.json kr 에 없는 한국 공항에서 운항 발견: {', '.join(extra)} — kr 목록에 추가 검토")
    no_flight = [d for d in dests if not any(r["ph_code"] == d for r in rows)]
    if no_flight:
        summary.append(f"  운항 없음: {', '.join(no_flight)}")
    text = "\n".join(summary) + "\n"
    (hub_dir / "collect_last.txt").write_text(text, encoding="utf-8", newline="\n")
    if "--dry-run" in args:
        print("dry-run: 저장하지 않음 (요약은 collect_last.txt)")
        return
    (hub_dir / "data").mkdir(exist_ok=True)
    (hub_dir / "data" / "schedule_week.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    (hub_dir / "data" / "week_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"저장: schedule_week {len(rows)}행, week_meta (요약은 collect_last.txt)")


if __name__ == "__main__":
    main()
