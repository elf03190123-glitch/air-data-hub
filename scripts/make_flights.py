"""기종 데이터(flights.json) 만들기 — 주간 스케줄(공항 공식) + 편명별 기종(aircraft.json, 조사)

  python -I scripts/make_flights.py <slug>

입력
  hubs/<slug>/data/schedule_week.json   collect_week.py 결과 (요일·횟수·시각은 여기서만 가져온다)
  hubs/<slug>/aircraft.json             편명 → 기종 (조사 결과, 직접 고침)
      {"KE017": {"aircraft": "B777-300ER (일등석 없음)", "note": "..."}, ...}
      aircraft 값은 seat_configs.json 의 aircraft_label 과 글자까지 같아야 좌석 수가 붙는다.
출력
  hubs/<slug>/data/flights.json         한국 출발 편마다 한 줄. arr·duration 은 비움 (공식 시간표에 없음)

aircraft.json 에 없는 편은 기종을 비워 두고("확인 필요") 요약에 적는다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    hub = ROOT / "hubs" / sys.argv[1]
    week = json.loads((hub / "data" / "schedule_week.json").read_text(encoding="utf-8"))
    meta = json.loads((hub / "data" / "week_meta.json").read_text(encoding="utf-8"))
    ac = json.loads((hub / "aircraft.json").read_text(encoding="utf-8")) if (hub / "aircraft.json").exists() else {}
    seats = json.loads((hub / "data" / "seat_configs.json").read_text(encoding="utf-8")) if (hub / "data" / "seat_configs.json").exists() else []
    labels = {(s["airline_code"], s["aircraft_label"]) for s in seats}
    label = meta[0]["label"] if meta else ""

    rows, missing, unmatched = [], [], []
    for w in week:
        if w["dir"] != "OUT":
            continue
        a = ac.get(w["flight"], {})
        lab = a.get("aircraft", "")
        if not lab:
            missing.append(w["flight"])
        elif (w["flight"][:2], lab) not in labels:
            unmatched.append(f"{w['flight']}={lab}")
        rows.append({
            "id": w["flight"], "dest": w["ph_airport"], "dest_code": w["ph_code"], "origin": w["kr_airport"], "origin_code": w["kr_code"],
            "airline": w["airline"], "flight": w["flight"], "days": w["days"], "weekly": w["weekly"], "dep": w["kr_time"],
            "arr": "", "duration": "", "aircraft": lab or "확인 필요", "valid": f"{label} 확인", "dep_terminal": f"{w['kr_code']} {w['terminal']}".strip(),
            "arr_terminal": "", "note": a.get("note", ""),
        })
    (hub / "data" / "flights.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    lines = [f"flights {len(rows)}행 작성", f"기종 없음 {len(missing)}: {', '.join(missing)}", f"좌석표와 이름 불일치 {len(unmatched)}: {', '.join(unmatched)}"]
    (hub / "make_flights_last.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"flights {len(rows)} rows, missing {len(missing)}, unmatched {len(unmatched)} (details: make_flights_last.txt)")


if __name__ == "__main__":
    main()
