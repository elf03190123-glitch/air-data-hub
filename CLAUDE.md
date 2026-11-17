# 항공 데이터 허브 — 작업 규칙

이 폴더에서 작업하는 Claude 세션은 이 문서를 먼저 읽고 따른다. 진행 상황(상태·다음 할 일)은 [README.md](README.md)에 있다.

## 한눈에
- **목적**: 관심 나라마다 한국과 오가는 직항을 같은 형식의 데이터 허브로 정리한다. 형식은 필리핀(세부·보홀) 허브를 따르고, 그 허브는 사용자가 claude.ai에서 직접 정리해 만든 것이다.
- **배포**: GitHub 공개 저장소 `elf03190123-glitch/air-data-hub`. `main` 브랜치의 `docs/`를 GitHub Pages로 배포한다. 주소는 https://elf03190123-glitch.github.io/air-data-hub/
- **허브**: `philippines`, `central-asia`, `americas`
- **공개 저장소**: 개인 메일·전화번호를 넣지 않는다. 작성자 표기는 "AVIAREPS Korea"로 한다. 커밋 작성자는 GitHub noreply 주소를 쓴다(저장소 로컬 git config에 설정됨).

## 나라 허브 기본 규칙 (2026-11-15 사용자 결정)
- **중점 공항은 나라별 수도 공항이다.** hub.json의 `focus`에 넣는다. 예: 아스타나 NQZ, 비슈케크 FRU, 아시가바트 ASB.
  - 수도가 아닌 공항도 지우지 않고 함께 둔다. 강조만 수도 공항에 한다.
  - `dest`에서는 나라 안에서 수도를 맨 앞에 둔다.
  - 필리핀 허브는 예외다. Aboitiz 제안용이라 세부·보홀이 중점이다.
- **스케줄은 공항 공식 시간표만으로 만든다.** 대상 필드는 요일·횟수·시각·운항일이다.
  - 예약시스템 원문이나 조사로 얻은 현지 도착 시각·비행시간은 넣지 않는다.
  - `flights`에는 기종만 조사해 붙이고 `arr`·`duration`은 비운다. hub.json에 `detail_hide_cols: ["ph_arr", "duration"]`을 넣는다.
  - `supply` 탭은 켜되, 공식 시간표로 만든 `flights`로 그리고 이름은 `supply_tab_label: "항공 공급"`으로 한다(2026-11-18 사용자 요청: 필리핀과 같은 탭 구성). 현지 도착 시각이 없으므로 `schedule_timeline`은 비워 두고, 그러면 '출발→도착 운항 시간대' 카드가 자동으로 숨는다.
  - 기종·좌석(조사)과 신규·추진 노선(뉴스) 표는 스케줄이 아니므로 출처를 붙여 둔다.

## 파일 구조
| 경로 | 내용 | 직접 수정 |
|---|---|---|
| `template/hub.html` | 공통 화면. `{{키}}`는 hub.json 값, `{{> 이름}}`은 text/ 조각으로 채움 | 직접 |
| `template/hub.js` | 공통 스크립트(집계·차트). 나라 값은 `window.HUB`에서만 읽음 — 공항 코드·나라 이름을 직접 쓰지 않는다 | 직접 |
| `template/hub.css`, `tokens.css`, `dash-shim.js` | 화면 스타일, 색·글꼴 변수(라이트/다크), claude.ai `dash` 런타임 대체 | 직접 |
| `hubs/<slug>/hub.json` | 나라별 설정(아래 표) | 직접 |
| `hubs/<slug>/text/*.html` | 나라별 문구 조각(데이터 목록, 읽는 법, 탭 설명) | 직접 |
| `hubs/<slug>/datasets.json` | 데이터셋 제목·설명·갱신일(내려받기 목록에 나옴) | 직접 |
| `hubs/<slug>/data/schedule_week.json`, `week_meta.json` | 주간 스케줄 | **`collect_week.py`로만** |
| `hubs/<slug>/aircraft.json` | 편명 → 기종(조사). `aircraft` 값은 seat_configs의 `aircraft_label`과 글자까지 같아야 함 | 직접(출처 확인 후) |
| `hubs/<slug>/data/flights.json` | 한국 출발편 기종표 | **`make_flights.py`로만** (aircraft.json이 있는 허브: americas). central-asia는 아직 직접 작성본 |
| `hubs/<slug>/data/` 나머지(seat_configs, winter_planned, glossary, schedule_timeline) | 조사·원문 데이터 | 직접(출처 확인 후) |
| `scripts/build.py` | hubs + template → `docs/` | 직접 |
| `scripts/collect_week.py` | 공항 공식 시간표 수집 | 직접 |
| `scripts/make_flights.py` | schedule_week + aircraft.json → flights.json | 직접 |
| `docs/` | 빌드 결과(배포됨) | **직접 고치지 않음** |

### hub.json 주요 키
| 키 | 뜻 |
|---|---|
| `R` | 라벨에 쓰는 지역 이름(예: 필리핀, 중앙아시아) |
| `dest` | 현지 공항 `[{code, name, group}]`. 표시 순서. `group`은 나라 이름(여러 나라 허브일 때) |
| `kr` | 표에 열로 나오는 한국 공항 `[{code, name}]` |
| `focus`, `focus_label`, `focus_short`, `focus_names` | 중점 공항(예: 세부·보홀). 없으면 `[]` |
| `tabs` | 보일 탭과 순서. 기본: overview·week·days(요일별 운항)·routes(신규·추진 노선)·detail·(supply)·seats·seatmap·glossary. 원문 스케줄이 없으면 `supply`를 뺀다 |
| `overview_kpis` | 개요 카드 `{label, source, field, row, sub, tag}`. `source`는 `headline`(원문), `week_headline`, `week_groups` 중 하나 |
| `week_groups`, `day_segments` | 주간 탭의 묶음 카드와 요일별 차트 묶음(중점 공항 또는 나라). `week_card: false`인 묶음은 개요 카드에만 쓰고 주간 탭에는 안 나온다 |
| `supply_tab_label`, `supply_issues_title`, `supply_moved_note` | 항공 공급 탭 이름, 편별 참고 사항 제목, 안내 문구(없으면 필리핀 원래 문구) |
| `detail_hide_cols` | 항공편 상세에서 숨길 열(공식 시간표에 없는 `ph_arr`·`duration`) |
| `pair_plus1` | 귀국편 짝을 편명+1로 먼저 찾는 항공사(필리핀항공 `PR`). 나머지는 편명−1 우선 |
| `basis_label` | 기종 근거 이름(`원문` 또는 `조사`) |
| `collect.kac` | 수집 때 같이 조회할 지방공항. `collect.airline_names`는 공항 사이트 표기를 바꿀 이름. `collect.season_note`는 주간 탭 설명 문구 |

## 실행
```bash
python -I scripts/collect_week.py <slug>            # 오늘(KST)부터 7일. --start YYYY-MM-DD, --dry-run
python -I scripts/make_flights.py <slug>           # aircraft.json 이 있는 허브: 기종표 다시 만들기 (수집 뒤 매번)
python -I scripts/build.py                          # docs/ 다시 만들기 + 금지 문자열 검사
python -I -m http.server 8766 --directory docs      # 로컬 확인
git add -A && git commit && git push                # 1분쯤 뒤 Pages 반영
```
- 같은 편이 날에 따라 시각만 다르면 `collect_week.py`가 한 줄로 합치고 다른 시각은 비고에 적는다. 같은 날 같은 편명이 두 번 나오면 따로 둔다.
- `make_flights.py`는 `hubs/<slug>/make_flights_last.txt`에 기종 없는 편·좌석표와 이름이 안 맞는 편을 적는다. 둘 다 0이어야 한다.
- `collect_week.py`는 요약을 `hubs/<slug>/collect_last.txt`에 쓴다. 이 파일은 git에 올리지 않는다. 터미널이 cp949라 한글 출력은 이 파일로 확인한다.
- **수집 출처**
  - 인천: 인천국제공항공사 여객 출·도착 시간표 API. 오늘 기준 −13일~+6일만 조회된다. 실제 운항편은 `fnumber == masterflight`인 것이다.
  - 지방공항: 한국공항공사 `getFilghtSchInternational.do`(요일·적용 기간). 자세한 내용은 스크립트 머리말에 있다.
  - 수집 결과에 `kr`에 없는 한국 공항이 나오면 요약에 경고가 뜬다. 그러면 `kr`에 추가한다.

## 검증 기준 (배포 전)
1. `build.py`가 금지 문자열 0건으로 통과해야 한다. 막는 것은 메일 주소 형식 문자열 전부, 트리거 ID, 개인 이니셜 표기 등이다. 특정 개인 주소를 검사 목록에 적지 않는다. 적으면 그 목록이 공개된다.
2. 로컬 서버로 허브마다 모든 탭을 1200px·360px 폭에서 연다. 확인할 것:
   - "불러오지 못했습니다"가 없다.
   - 숫자 칸에 "—"가 남지 않는다.
   - 페이지 가로 넘침이 없다.
3. 공통 틀(template/)을 고쳤으면 필리핀 허브의 숫자를 다시 비교한다. 기준값은 아래와 같다.
   - 개요 39·122
   - 주간 160·158·46·10 (표 5행)
   - 요일별 운항 차트 1개, 신규·추진 노선 표 2행
   - 상세 160·27,935·7
   - 원문 25·14·54·22·7
   - 표 행 수: 좌석 11, 코드 29, 상세 28
4. 좌석 데이터 필드: `premium`·`premium_layout`·`premium_name`(프리미엄 이코노미, 없는 허브는 열이 자동으로 숨음), `first_name`(일등석을 다른 이름으로 팔 때, 예: 아시아나 A380 비즈니스 스위트). 다리 공간만 넓은 일반석은 economy에 넣는다.

## 새 나라 추가 순서
1. `hubs/<slug>/`를 만든다. `central-asia`를 복사해 `hub.json`의 dest·kr·라벨을 고친다. `focus`는 수도 공항으로 둔다(위 기본 규칙).
2. `collect_week.py <slug>`를 실행한다. 공항 코드가 인천 시간표 공항 목록에 없으면 그 주 직항이 없다는 뜻이다.
3. 기종·좌석·신규 노선을 조사해 `flights`·`seat_configs`·`winter_planned`·`glossary`에 넣는다. 출처 URL이 열리는지 확인한다.
4. `text/` 조각을 쓰고 `datasets.json`을 채운다. 그다음 빌드·검증·배포한다.

## 결정 기록
- 2026-11-15 사용자 결정: 필리핀 허브와 같은 형식으로 나라별 항공정보를 정리한다. 첫 대상은 키르기스스탄·카자흐스탄·투르크메니스탄이다. 공개 배포 허용(고객사 자료 아님).
- 2026-11-15 세 나라는 직항이 적어 나라별 3개 페이지 대신 `central-asia` 허브 하나로 묶었다. 공항 행에 나라를 같이 표시한다.
- 2026-11-15 원문(예약시스템) 스케줄이 없는 허브는 `supply` 탭을 숨긴다. 기종은 운항기록 조사(`basis_label: 조사`)로 채운다.
- 2026-11-15 사용자 결정: 중점 공항은 나라별 수도 공항, 스케줄은 공항 공식 시간표만. 중앙아시아 허브의 조사 기반 현지 도착 시각·비행시간을 지웠다.
- 2026-11-17 사용자 요청으로 `americas`(미국·캐나다·멕시코) 추가. 직항이 있는 나라만 다룬다(괌·사이판은 대양주로 보고 제외). 수도 공항: 워싱턴 덜레스 IAD, 오타와 YOW(직항 없음), 멕시코시티 MEX. 계절편 공항(캘거리 YYC, 몬트리올 YUL)은 0회여도 목록에 둔다. 아에로멕시코 귀국편은 몬테레이 경유라 시간표에 MTY 출발로 나온다.
- 2026-11-17 에어프레미아 B787-9은 309~344석 버전이 섞여 편별 배정이 공개되지 않아 309석(대표 버전)으로 계산한다. 델타 A350은 주력 275석(35H), 아에로멕시코는 B787-9로 계산하고 비고에 적는다.
- 2026-11-17 사용자 요청: '요일별 운항'과 '신규·추진 노선'을 주간 운항 스케줄 탭에서 빼 각각 별도 탭(`days`, `routes`)으로 만들었다(세 허브 공통).
- 2026-11-18 사용자 요청: 필리핀에만 있던 항공 공급 탭을 중앙아시아·미주에도 넣었다(공식 시간표 기준, 시간대 차트 없음). 목적지 카드는 실제 운항 공항만 만든다.
- 필리핀 허브의 기존 단독 사이트(`aboitiz-data-hub` 저장소)는 그대로 둔다. 앞으로 고치는 것은 이 저장소의 `philippines`이다.
