# 0.4.2 수정 지시서

0.4.1 코드 리뷰(2026-10-20) 결과를 작업 단위로 정리한 문서입니다. 토스증권 공식 스펙([openapi.json](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json), [asyncapi.json](https://openapi.tossinvest.com/openapi-docs/latest/asyncapi.json), [overview.md](https://openapi.tossinvest.com/openapi-docs/overview.md))과 대조해 확인했고, P0~P3의 버그는 실행으로 재현했습니다.

기준 커밋 상태: 버전 `0.4.1`, `npm test` 93개 통과.

## 작업 순서

| # | 우선순위 | 제목 | 주요 파일 |
|---|---|---|---|
| 1 | **P0** | `/prices` 배치 404로 전체 시세가 멈추고 영구 정지됨 | `lib/toss-client.js`, `lib/market-service.js` |
| 2 | P1 | 재연결마다 선택한 계좌가 첫 번째로 리셋 | `lib/market-service.js` |
| 3 | P1 | 캐릭터 크기 80·290·300이 설정값대로 표시되지 않음 | `src/pet.js` |
| 4 | P1 | 첫 라이브 연결에서 settings.json을 종목 수만큼 연쇄 저장 | `lib/market-service.js` |
| 5 | P2 | state 1회당 전체 스냅샷을 두 번 복제 | `electron/main.js` |
| 6 | P2 | 종목 목록 로드 실패 시 요청 폭주 + 진행 표시 없음 | `lib/market-service.js`, `src/dashboard.js` |
| 7 | P3 | 스펙에 없는 `account-not-found` 분기 / 테스트 픽스처 | `lib/market-service.js`, `tests/portfolio.test.js` |
| 8 | P3 | WS `rate-limit-exceeded`를 연결 장애로 처리 | `lib/market-service.js` |
| 9 | P3 | 토큰 발급만 레이트 리밋 큐 밖 | `lib/toss-client.js` |
| 10 | P3 | 자잘한 정리 2건 | `src/pet.js` |

1~4번은 독립적이라 병렬로 작업해도 되지만, 1·2·4번이 모두 `lib/market-service.js`를 건드리므로 **한 사람이 순서대로** 처리하는 편이 충돌이 없습니다. 3·5·6(UI)·10번은 따로 진행 가능합니다.

---

## 1. (P0) `/prices` 배치 404로 전체 시세가 멈추고 영구 정지됨

### 현상

관심종목 중 **단 하나**라도 상장폐지·거래중단 등으로 시세를 제공하지 않으면, 멀쩡한 나머지 종목의 가격까지 전부 표시되지 않습니다. 재연결을 8회 시도한 뒤 영구 정지되고, 앱을 다시 켜도 자동 연결되지 않습니다. 사용자는 **어떤 종목이 원인인지 알 방법이 없어** 스스로 복구할 수 없습니다.

### 재현

```js
// 관심종목 2개: 005930(정상), DEADCO(US, 조회 불가)
// GET /api/v1/prices → 404 {"error":{"code":"stock-not-found", ...}}
await service.start('live');
// connection.state : error
// connection.msg   : 시세를 제공하지 않는 종목이 있어요. 종목 검색에서 다시 선택해 주세요.
// quotes w/ price  : 0 / 2      ← 삼성전자까지 같이 죽음
```

### 원인

`lib/toss-client.js:172-177`의 `prices()`가 관심종목 전체를 쉼표로 이어 **한 번에** 요청합니다.

```js
const result = await this.request('/api/v1/prices', { symbols: stocks.map(s => s.symbol).join(',') });
```

공식 스펙의 `/api/v1/prices` 응답 정의에는 `404: {"$ref": "#/components/responses/NotFound"}`가 있고, 그 본문은 `{"error":{"code":"stock-not-found", ...}}`입니다. 즉 **부분 성공이 없고 배치 전체가 실패**합니다.

이후 전파 경로:

1. `lib/market-service.js:306` `await client.prices(stocks)` 에서 throw
2. `refresh()` / `start()` 의 catch → `_handleFailure(error)` (`:426`)
3. `stock-not-found`는 `TERMINAL_CODES`에 없고 상태코드도 401/403이 아니므로 `terminal === false` → `_scheduleReconnect()` (`:442`)
4. 재연결은 다시 `_refreshLive(true, epoch)`를 호출 → 같은 404 → 2번으로 복귀
5. `reconnectAttempt >= 8`이 되면 `emit('halt', {code:'retry-exhausted'})` (`:448`)
6. `electron/main.js:224-228`의 halt 핸들러가 `preferredMode='offline'`로 `session.json`에 기록 → **다음 실행에서도 자동 연결 안 됨**

`lib/toss-client.js:15`의 `MESSAGES['stock-not-found']` 문구가 이미 존재하는 걸 보면 상황 자체는 예상했으나, 격리·복구 경로가 구현되어 있지 않습니다.

### 수정 방침

WebSocket 쪽의 `rejected` 처리(`market-service.js:392`)와 **같은 모델**을 REST에도 적용합니다. 즉 "문제 종목을 찾아서 제외하고 나머지는 계속 받는다".

**(a) `TossClient.prices()`를 청크 + 이분 탐색으로 변경**

```js
const PRICE_CHUNK = 20;   // 스펙 상한은 200이지만, 404 시 재탐색 비용을 줄이려면 작게

async prices(stocks) {
  if (!stocks.length) return { items: [], unavailable: [] };
  const items = [], unavailable = [];
  for (let i = 0; i < stocks.length; i += PRICE_CHUNK) {
    const chunk = stocks.slice(i, i + PRICE_CHUNK);
    const result = await this._pricesChunk(chunk, items, unavailable);
  }
  return { items, unavailable };   // unavailable: stockKey 배열
}

// 404(stock-not-found)면 청크를 반으로 쪼개 재귀. 길이 1이면 그 종목이 원인.
async _pricesChunk(chunk, items, unavailable) {
  try {
    const result = await this.request('/api/v1/prices', { symbols: chunk.map(s => s.symbol).join(',') });
    if (!Array.isArray(result)) throw new MarketError('invalid-response');
    items.push(...result);
  } catch (error) {
    if (error.code !== 'stock-not-found' || error.status !== 404) throw error;
    if (chunk.length === 1) { unavailable.push(chunk[0]); return; }
    const mid = Math.ceil(chunk.length / 2);
    await this._pricesChunk(chunk.slice(0, mid), items, unavailable);
    await this._pricesChunk(chunk.slice(mid), items, unavailable);
  }
}
```

주의:
- 반환 타입이 배열 → 객체로 바뀝니다. 호출부는 `_refreshLive` 한 곳(`market-service.js:306`)뿐이니 같이 고치면 됩니다.
- 요청 수가 늘어나므로 `request()`의 `prices` 그룹 간격 85ms가 그대로 적용되는지 확인하세요. 100종목 = 5청크 = 약 0.4초로 MARKET_DATA 15/s 안쪽입니다. 이분 탐색이 최악으로 돌아도(한 청크에 1개 불량) 추가 요청은 청크당 약 2·log₂20 ≈ 9회이고, 아래 (c)의 캐싱으로 매 폴링마다 반복되지 않습니다.

**(b) `_refreshLive`에서 제외 종목을 `rejected`와 같은 방식으로 표시**

`market-service.js`에 `this.unavailable = new Set()`(stockKey 기준)을 추가하고:

- `prices()`가 돌려준 `unavailable`을 `this.unavailable`에 합칩니다.
- 다음 호출부터는 `stocks.filter(s => !this.unavailable.has(stockKey(s)))`만 요청합니다 (매번 재탐색하지 않음).
- 제외된 종목은 `_emptyQuote(stock)`로 두고 `engine.reset(key)` — 이미 `:334`에 있는 처리와 동일합니다.
- `previousClose` 조회(`:320`)도 제외 종목은 건너뜁니다.
- `updateConfig`의 `marketChanged` 블록(`:481`)에서 `this.rejected.clear()`와 나란히 `this.unavailable.clear()`를 호출해, 관심종목을 수정하면 다시 시도하게 합니다. `start()`(`:124`)에서도 초기화합니다.

**(c) 사용자에게 어떤 종목인지 알립니다**

`_setConnection`의 connected 메시지가 이미 거부 종목 수를 안내하고 있습니다(`:395`). 같은 자리에 `unavailable`도 합산하세요. 추가로 **종목명을 보여줘야** 사용자가 조치할 수 있습니다:

- `getState()`의 quote에 `unavailable: true` 플래그를 내려보내고,
- `src/dashboard.js`의 `renderRows()`(`:232` 부근)에서 해당 행의 가격 칸에 `시세 미제공` 배지를 붙입니다. `stale-note` 처리(`:248`)와 같은 패턴을 쓰면 됩니다.
- 문구 예: `시세를 제공하지 않아요 · 종목을 확인해 주세요`

### 수용 기준

- [ ] 100종목 중 1종목이 404여도 나머지 99종목의 가격이 정상 표시된다.
- [ ] `connection.state`가 `error`로 떨어지지 않고 `connected`를 유지한다.
- [ ] 재연결 루프와 `halt{code:'retry-exhausted'}`가 발생하지 않는다 (→ `session.json`의 `preferredMode`가 `offline`으로 바뀌지 않는다).
- [ ] 문제 종목이 관심종목 화면에서 식별 가능하다.
- [ ] 해당 종목을 삭제하면 다음 갱신에서 `unavailable`이 비워진다.
- [ ] 404가 **아닌** 오류(401/403/429/500)의 기존 동작은 그대로다 — 특히 401/403은 여전히 terminal.

### 추가할 테스트 (`tests/market-service.test.js`)

1. 2종목 중 1종목만 404 → 정상 종목 가격이 있고 `connection.state === 'connected'`
2. 청크 경계(21종목, 20번째가 불량)에서도 격리된다
3. 404가 반복돼도 `/prices` 호출 횟수가 폴링 주기당 선형으로 유지된다 (재탐색이 캐시된다)
4. 500 응답은 기존대로 `_handleFailure` → 재연결 경로를 탄다 (회귀 방지)

---

## 2. (P1) 재연결마다 선택한 계좌가 첫 번째로 리셋

### 현상

계좌를 2번으로 바꿔 놓아도, 재연결·절전 복귀·API 키 저장·데모↔라이브 전환 뒤에 1번 계좌로 되돌아갑니다.

### 재현

```
사용자가 고른 계좌    : 22
(stop → start)
재연결 후 선택된 계좌 : 11
```

### 원인

`lib/market-service.js:102`의 `stop()`이 `this.portfolio = emptyPortfolio()`로 전체를 밀어버려 `selectedAccountId`가 `null`이 됩니다. 이후 `refreshPortfolio()`(`:183`)가

```js
const selectedAccountId = accounts.some(a => a.id === this.portfolio.selectedAccountId)
  ? this.portfolio.selectedAccountId : accounts[0]?.id ?? null;
```

에서 `accounts[0]`로 되돌립니다.

stop/start를 거치는 경로: `start()` 선두(`:115`), `electron/main.js:149`(키 저장), `:157`(키 삭제), `:238`(절전), `:243`(복귀), 그리고 모든 재연결.

### 수정 방침

계좌 **데이터**(holdings, 금액)는 계속 지우되 **선택 상태**만 보존합니다. `PROJECT_CONTRACT.md`의 "full portfolio data is cleared across mode and account changes"와 충돌하지 않습니다 — 보존하는 건 ID 하나뿐입니다.

```js
// market-service.js stop() 안
const keepAccountId = this.portfolio.selectedAccountId;
this.portfolio = { ...emptyPortfolio(), selectedAccountId: keepAccountId };
```

주의할 점:

- **데모 모드의 계좌 ID가 라이브로 새지 않아야 합니다.** 데모 계좌는 1·2, 라이브는 서버가 준 `accountSeq`입니다. `refreshPortfolio`의 `accounts.some(...)` 검증이 이미 막아 주지만, 모드가 바뀔 때는 명시적으로 버리는 편이 안전합니다. `start(mode)`에서 `mode !== 이전 mode`면 `selectedAccountId = null`로 두세요.
- 보존한 ID는 **렌더러 스냅샷에 그대로 나가는 값**이라 새로 추가되는 노출은 없습니다(계좌번호가 아니라 `accountSeq`).

### 수용 기준

- [ ] 2번 계좌 선택 → 재연결 → 여전히 2번
- [ ] 절전 → 복귀 후에도 2번
- [ ] 데모에서 2번 선택 → 라이브 연결 시 데모 ID를 재사용하지 않는다
- [ ] 선택했던 계좌가 서버 목록에서 사라지면 기존대로 `accounts[0]`로 폴백

### 추가할 테스트 (`tests/portfolio.test.js`)

- `selectAccount(2)` → `stop()` → `start('live')` → `selectedAccountId === 2`
- 데모에서 선택 → 라이브 전환 시 계좌 ID 누수 없음

---

## 3. (P1) 캐릭터 크기 80·290·300이 설정값대로 표시되지 않음

### 현상

설정에서 캐릭터 크기를 80px 또는 290/300px로 저장하면, 설정 화면 미리보기와 실제 데스크톱 펫의 크기가 서로 다릅니다. 저장은 되는데 적용이 안 되는 것처럼 보입니다.

### 원인

범위가 네 곳에 흩어져 있고 한 곳만 다릅니다.

| 위치 | 범위 |
|---|---|
| `src/dashboard.js:123` 슬라이더 | `min=80 max=300 step=10` |
| `lib/config.js:66` `normalizeConfig` | 80 ~ 300 |
| `electron/pet-drag.js:19` 검증 | 80 ~ 300 |
| `src/character.js:42` `setSize` | 64 ~ 400 |
| **`src/pet.js:108`** | **90 ~ 280** ← 혼자 다름 |

```js
const nextSize = Math.min(280, Math.max(90, Number(state.config.petSize) || 150));
```

### 수정 방침

`src/pet.js:108`을 80~300으로 맞춥니다. 더 좋은 방법은 **범위를 한 곳에서 정의**하는 것입니다:

```js
// lib/config.js
export const PET_SIZE = Object.freeze({ min: 80, max: 300, step: 10, default: 150 });
```

를 추가하고 `config.js`의 검증, `pet.js`의 클램프, `pet-drag.js`의 검증이 모두 이 상수를 쓰게 합니다. 슬라이더의 `min`/`max`/`step` 속성도 하드코딩 대신 이 값으로 설정하면 다시 어긋나지 않습니다.

`src/character.js`의 64~400은 그대로 두세요 — 거긴 방어적 하한/상한이라 더 넓어야 정상입니다.

`lib/speech-layout.js`와 `lib/pet-geometry.js`가 300px 캐릭터에서도 말풍선을 화면 안에 두는지 확인이 필요합니다(`petBounds`의 `top = Math.min(Math.max(12, size*0.4), ...)` → 300px이면 top이 120px). 작은 노트북 화면에서 눈으로 한 번 확인해 주세요.

### 수용 기준

- [ ] 슬라이더를 80으로 두고 저장 → 펫이 80px로 표시
- [ ] 300으로 저장 → 펫이 300px로 표시, 설정 미리보기와 동일
- [ ] 300px 상태에서 말풍선이 화면 밖으로 나가지 않는다
- [ ] 300px 상태에서 드래그가 정상 동작한다 (`pet-drag.js`가 거부하지 않음)

---

## 4. (P1) 첫 라이브 연결에서 settings.json을 종목 수만큼 연쇄 저장

### 현상

라이브로 처음 연결할 때 관심종목 개수만큼 설정 파일 쓰기가 연쇄적으로 일어납니다. 기본 20종목으로 20회, 100종목이면 100회입니다. 등락 기준이 `previousClose`여서 `trackingPrice`를 **쓰지도 않는 상황**에서도 발생합니다.

### 재현

```
관심종목 수: 20
기준: 전일 종가 (tracking 미사용)인데 발생한 config 저장 이벤트: 20
```

각 이벤트가 `electron/main.js:131`의 `persistConfig`를 타고, `electron/storage.js:5`의 `atomicWrite`는 호출마다 mkdir + write + rename + rm을 수행합니다.

### 원인

`lib/market-service.js:262-265`:

```js
} else if (!positiveNumber(stock.trackingPrice)) {
  stock.trackingPrice = price;
  this.emit('config', this.getPersistedConfig());
}
```

`_apply()`는 종목 하나마다 호출되므로, `_refreshLive`의 루프(`:330`)가 종목 수만큼 emit합니다. 그리고 `this.config.baseline === 'tracking'` 여부를 전혀 보지 않습니다.

### 수정 방침

두 가지를 같이 적용합니다.

**(a) 배치 emit** — `_apply`에서는 플래그만 세우고, 루프가 끝난 뒤 한 번만 emit합니다.

```js
// _apply 안
} else if (!positiveNumber(stock.trackingPrice)) {
  stock.trackingPrice = price;
  this._trackingDirty = true;        // emit 하지 않음
}

// _refreshLive 끝 / _refreshDemo 끝 / updateConfig 의 재적용 블록 끝
if (this._trackingDirty) { this._trackingDirty = false; this.emit('config', this.getPersistedConfig()); }
```

WebSocket 메시지 핸들러(`:412`)에서도 `_apply`가 불리므로, 거기선 기존 `emitTimer` 코얼레싱(`:414`)에 묻어 같이 flush하면 됩니다.

**(b) 필요할 때만 기록** — `trackingPrice`는 `baseline === 'tracking'`에서만 쓰입니다(`lib/alert-engine.js:16`). 기준이 다른데도 영구 기록을 남기는 건 과합니다.

다만 이건 **동작 변경**입니다. 현재는 "관심종목 등록가"를 미리 확보해 두었다가 나중에 기준을 `tracking`으로 바꾸면 그 시점이 아니라 최초 수신 시점이 기준이 됩니다. `src/dashboard.js:357`의 안내문(`최초 시세 수신 시 설정돼요`)도 이 전제입니다. 제품 의도를 확인한 뒤 결정하세요.

- 현 동작 유지를 택하면 (a)만 적용 — 그래도 쓰기 횟수는 N회 → 1회로 줄어듭니다.
- 기준 전환 시점을 기준가로 삼기로 하면 (b)도 적용하고, `updateConfig`에서 `baseline`이 `tracking`으로 바뀔 때 채우도록 옮긴 뒤 위 안내 문구도 함께 수정하세요.

### 수용 기준

- [ ] 20종목 첫 라이브 연결 시 `config` 이벤트가 1회 이하
- [ ] `trackingPrice` 값 자체는 기존과 동일하게 저장된다((a)만 적용한 경우)
- [ ] WS 체결이 쏟아져도 `config` 이벤트가 체결마다 발생하지 않는다

---

## 5. (P2) state 1회당 전체 스냅샷을 두 번 복제

### 원인

`electron/main.js:39-40`:

```js
function publish() { broadcast('chii:state', snapshot()); }
...
service.on('state', publish);          // :220
```

`service.getState()`는 내부에서 quotes + portfolio 전체를 `structuredClone`합니다(`market-service.js:47`). `'state'` 이벤트는 이미 복제된 스냅샷을 payload로 넘겨주는데, `publish()`가 그걸 **버리고** `snapshot()` → `service.getState()`를 다시 호출해 두 번째 복제를 만듭니다.

WS 체결은 120ms로 코얼레싱되므로(`:414`) 초당 최대 약 8회 × 2복제입니다. 100종목이면 체감됩니다.

### 수정 방침

```js
function decorate(state) {
  return { ...state, ...(suspended ? { /* 기존 suspended 치환 */ } : {}),
    credentialsConfigured: credentialReady, version: app.getVersion() };
}
function snapshot() { return decorate(service.getState()); }           // IPC 요청용
function publish(state) { broadcast('chii:state', decorate(state ?? service.getState())); }
service.on('state', publish);
```

`publish()`를 인자 없이 부르는 기존 호출부(`:60`, `:95`, `:142` 등)는 그대로 동작합니다.

### 수용 기준

- [ ] 100종목 라이브에서 `structuredClone` 호출이 emit당 1회
- [ ] 두 창(설정·펫)의 상태 갱신이 기존과 동일하게 동작
- [ ] 절전 중 스냅샷의 `stale: true` 치환이 그대로 유지된다

---

## 6. (P2) 종목 목록 로드 실패 시 요청 폭주 + 진행 표시 없음

### 현상

- 라이브 모드에서 종목 검색을 처음 할 때 7개 거래소 목록을 순차 조회합니다. STOCK_ALL은 1 req/s라 **최소 7.7초**가 걸리는데, 화면에는 `종목을 찾고 있어요…`만 떠 있습니다.
- 그 조회가 실패하면 다음 키 입력마다 7개 요청 세트가 **처음부터 다시** 큐에 쌓입니다.

### 원인

`lib/market-service.js:508-529`:

```js
if (this.mode === 'live' && this.client && this.now() - this.catalogAt > 86400000) {
  if (!this.catalogPromise) { this.catalogPromise = (async () => { /* 7회 조회 */ })(); }
  const promise = this.catalogPromise;
  try { await promise; }
  catch (error) { if (error.terminal) this._handleFailure(error); throw error; }
  finally { if (this.catalogPromise === promise) this.catalogPromise = null; }
}
```

- 실패 시 `this.catalogAt`은 0으로 남고 `catalogPromise`도 null로 되돌아갑니다 → 쿨다운이 없습니다.
- `src/dashboard.js:385`의 입력 디바운스는 220ms이므로, 타이핑을 이어가면 세트가 계속 쌓입니다.
- 부분 성공(예: KOSPI·KOSDAQ까지 받고 NYSE에서 실패)도 전부 버려집니다 — `this.catalog` 대입이 루프 뒤에 한 번뿐이기 때문입니다(`:522`).

### 수정 방침

- `catalogFailedAt`을 두고 실패 후 60초 안에는 재시도하지 않고, 그동안은 기존 `this.catalog`(기본 20종목)로 검색하면서 `부분 목록으로 검색 중이에요` 같은 안내를 `searchStocks` 결과와 함께 내려보냅니다.
- 거래소 단위로 성공분을 누적합니다. 7개 전부 성공했을 때만 `catalogAt`을 갱신하고, 일부만 성공했으면 받은 것만 `this.catalog`에 반영한 뒤 다음 기회에 나머지를 채웁니다.
- 로딩 UI: `src/dashboard.js`의 `searchStocks`(`:362`)에서 `종목 목록을 처음 불러오고 있어요 (몇 초 걸려요)`로 문구를 바꾸고, 가능하면 `3/7 거래소` 형태의 진행률을 `bridge`를 통해 내려보냅니다.

### 수용 기준

- [ ] 목록 조회 실패 후 연속 타이핑해도 60초 안에는 요청 세트가 1회만 나간다
- [ ] 부분 성공한 거래소의 종목이 검색된다
- [ ] 최초 로딩 중 사용자가 무슨 일이 벌어지는지 알 수 있다

---

## 7. (P3) 스펙에 없는 `account-not-found` 분기 / 테스트 픽스처

`lib/market-service.js:205`:

```js
error?.code === 'account-not-found' ? '선택한 계좌를 조회할 수 없어요. 계좌 목록을 새로고침해 주세요.' : ...
```

공식 스펙상 `/api/v1/holdings`의 응답은 `400 AccountHeaderRequired`, `401 Unauthorized`, `404 NotFound(code: stock-not-found)`, `429`, `500 InternalErrorAsset`입니다. `account-not-found`는 주문 조회 API 쪽(`components/responses/OrderInfoAccountNotFound`)이라 이 경로로는 오지 않습니다.

`tests/portfolio.test.js:147`도 같은 가짜 코드로 픽스처를 만들고 있어, 테스트가 실제 서버 동작을 검증하지 못합니다.

### 수정 방침

- 분기를 제거하거나, 실제로 올 수 있는 코드로 교체합니다. "계좌가 사라진 경우"는 `/api/v1/accounts` 재조회로 자연스럽게 처리되므로(`:183`) 별도 분기가 꼭 필요하지는 않습니다.
- 테스트 픽스처를 `400 {"code":"invalid-request"}`와 `404 {"code":"stock-not-found"}`로 바꾸고, **민감 정보 미노출 검증**(현재 테스트가 보고 있는 `12345678901 secret`이 메시지에 새지 않는지)은 그대로 유지하세요. 이 검증 자체는 좋습니다.

---

## 8. (P3) WS `rate-limit-exceeded`를 연결 장애로 처리

`lib/market-service.js:399-402`가 `error` 프레임을 받으면 terminal 여부만 보고 전부 `_handleFailure`로 보냅니다. `_handleFailure`는 소켓을 끊고 지수 백오프 재접속을 겁니다.

공식 AsyncAPI는 `rate-limit-exceeded`에 대해 **"약 1초 후 재선언(redeclare)"** 을 권하고, `Retry-After` 헤더는 없다고 명시합니다. 선언(declaration) 한도는 5/s입니다. 현재 `updateConfig`는 관심종목이 바뀔 때마다 구독 배열을 다시 보내므로(`:494`), 사용자가 종목을 빠르게 추가/삭제하면 이 한도에 닿을 수 있습니다.

### 수정 방침

- `rate-limit-exceeded`는 연결을 끊지 말고, 1초 뒤 `this.socket.send(JSON.stringify(this._subscription()))`로 재선언만 합니다. 재선언 실패가 3회 이상 반복될 때만 기존 경로로 넘깁니다.
- `updateConfig`의 구독 재전송에 짧은 디바운스(예: 300ms)를 넣어 연속 편집이 한 번으로 합쳐지게 합니다.
- `server-shutdown`은 스펙상 서버가 곧 연결을 닫는다는 신호이므로 지금처럼 재접속이 맞습니다 — 그대로 두세요.

---

## 9. (P3) 토큰 발급만 레이트 리밋 큐 밖

`lib/toss-client.js:90`의 `getToken()`이 `this._fetch('/oauth2/token', ...)`를 직접 호출합니다. `request()`가 구현한 그룹별 간격 큐(`:132-141`)를 타지 않는 유일한 경로입니다.

AUTH는 5/s라 여유가 있고 `tokenPromise`가 동시 발급을 막고 있어 당장 문제는 아니지만, 재연결이 몰릴 때 유일하게 보호가 없습니다. `spacing` 맵에 `auth: 220`을 추가하고 `getToken`도 같은 게이트를 쓰도록 정리하면 일관성이 생깁니다. 리스크가 낮으니 여유 있을 때 처리하세요.

---

## 10. (P3) 자잘한 정리

**(a) `src/pet.js:113-114`**

```js
if (!state.config.roaming && oldRoaming !== false) stopWalking();
else if (oldRoaming === false) stopWalking();
```

산책이 꺼져 있는 동안에는 상태 브로드캐스트가 올 때마다 두 번째 분기가 계속 `stopWalking()`을 호출합니다. 동작상 해롭진 않지만(어차피 `walkingEnabled()`가 false) 의도가 읽히지 않습니다. "roaming 값이 바뀐 경우에만 호출"로 단순화하세요.

```js
if (oldRoaming !== undefined && oldRoaming !== state.config.roaming) stopWalking();
```

**(b) `src/pet.js:91`**

```js
Math.max(1, Number(snapshot?.config.intervalMinutes) || 5) * 60000
```

`intervalMinutes`의 하한은 0.1인데 여기서 1분으로 올려버립니다. 현재는 `bridge.onBulletin`이 항상 존재해 `scheduleFallback`이 조기 return하므로(`:90`) 실행되지 않는 경로입니다. 하한을 0.1로 맞추거나, 죽은 경로라면 제거하세요.

---

## 전체 검증

모든 작업이 끝나면:

```bash
npm test
npm run build
npm run test:desktop
npm run test:roaming
npm run test:portfolio
npm run test:characters
```

추가로 수동 확인:

- [ ] 상장폐지 종목을 관심종목에 넣고 라이브 연결 → 나머지 종목 시세 정상
- [ ] 계좌 2번 선택 후 절전 → 복귀 → 2번 유지
- [ ] 캐릭터 크기 80 / 300 각각 저장 후 실제 펫 크기 확인
- [ ] 100종목 관심종목으로 라이브 연결 → `settings.json` 수정 시각이 한 번만 바뀌는지 확인
- [ ] `QA.md`에 0.4.2 항목 추가

버전은 `package.json`과 `build.directories.output`(`release/0.4.2`)을 함께 올리세요. `src/bridge.js:42`의 하드코딩된 `version: '0.4.1'`과 `src/dashboard.js:341`의 폴백 문자열도 같이 갱신해야 합니다.

## 손대지 않아도 되는 부분

리뷰에서 공식 스펙과 대조해 **문제없음을 확인**한 영역입니다. 리팩터링 중 건드리지 마세요.

- `marketDay()` / `selectPreviousClose()` — `1d` 캔들의 "현지 자정 고정" 전제와 미국 20:00 거래일 경계가 스펙과 정확히 일치합니다.
- 레이트 리밋 간격 테이블(`toss-client.js:133`) — ACCOUNT 1/s, ASSET 5/s, STOCK_ALL 1/s, MARKET_DATA 15/s, MARKET_DATA_CHART 20/s 전부 안쪽입니다.
- WebSocket 프로토콜 처리 — 텍스트 `PING` / `{"type":"pong"}`, `rejected[].target`, `trade:us:AAPL` 토픽 형식, 전체 치환 구독 모두 정확합니다.
- `lib/portfolio.js`의 필드 매핑 — `marketCountry`, `averagePurchasePrice`, `profitLoss.rate`(소수비율) 등 스펙과 일치하고, 통화를 섞어 더하지 않는 처리도 올바릅니다.
- 보안 구성 — contextIsolation + sandbox, `senderFrame` 검증, 빌드 CSP의 `connect-src 'none'`, safeStorage 암호화, 렌더러의 `textContent` 일관 사용(innerHTML은 정적 셸 1곳), 에러에 서버 페이로드·URL·토큰 미노출, `redirect: 'error'`.
- `epoch` / `configRevision` / `portfolioRevision` 가드 — 비동기 경합 처리가 꼼꼼합니다.
