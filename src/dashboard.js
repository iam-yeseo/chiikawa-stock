import './fonts.css';
import './dashboard.css';
import brandLogo from '../assets/brand/meonjakju-logo-v1.png';
import {bridge, isDesktop} from './bridge.js';
import {mountCharacter} from './character.js';
import {CHARACTER_CATALOG, getCharacterProfile} from '../lib/characters.js';
import {PET_SIZE} from '../lib/config.js';
import {pickCompanionDialogue} from '../lib/companion-dialogue.js';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="m5 16 5-5 4 3 5-9m-6 0h6v6"/>',
  arrowRight: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  moon: '<path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5Z"/>',
  wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h15v11H6a3 3 0 0 1-3-3V6m18 7h-5v4h5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m-5 0a8 8 0 0 1 13.7-5.7L20 9M4 15l2.3 2.7A8 8 0 0 0 20 12"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const baselineLabels = {previousClose: '전일 종가 대비', purchase: '내 평균 매수가 대비', custom: '내가 정한 가격 대비', tracking: '관심종목 등록가 대비'};
const actionLabels = {idle: '가만히', walk: '총총 걷기', happy: '기뻐하기', cry: '엉엉 울기', sleep: '잠깐 휴식', talk: '말하기'};
const fallbackSpeech = {idle: '응…', happy: '와아…!', cry: '흐으…', walk: '으쌰…', sleep: '쿨…', talk: '아…!'};
const activeProfile = () => getCharacterProfile(currentCharacterId);
const speechFor = (action) => snapshot?.config.companionMode === true ? pickCompanionDialogue(currentCharacterId, {action, random: () => 0}).text : activeProfile().speech?.[action] || fallbackSpeech[action];
const characterPreviewLabels = {
  chiikawa: {walk: '조심조심 걷기', happy: '작게 폴짝', cry: '훌쩍 울기'},
  hachiware: {idle: '주변 구경', walk: '구경하며 걷기', happy: '두 번 폴짝', cry: '마음 추스르기'},
  usagi: {idle: '평소 얼굴', walk: '통통 산책', happy: '가볍게 폴짝', cry: '잠깐 멈칫'},
};
const labelFor = (action) => characterPreviewLabels[currentCharacterId]?.[action] || actionLabels[action];
let snapshot, market = 'ALL', page = 'watchlist', selectedAction = 'idle', searchSequence = 0, baselineStock = null, toastTimer, reactionTimer, apiBusy = false;
const settingsDirty = {notifications: false, character: false};
const lastPrices = new Map();
let currentCharacterId = 'chiikawa', characterSelectionBusy = false;
let portfolioBusy = false, autoWatchBusy = false, lastPortfolioRender = '', companionModeBusy = false;
let updateState = {status: 'idle', mode: 'disabled', currentVersion: '0.5.1', latestVersion: null, message: '', progress: null}, updateBusy = false;
document.documentElement.dataset.platform = /Mac/i.test(navigator.platform) ? 'mac' : 'windows';

$('#app').innerHTML = `
  <div class="app-titlebar"><span id="window-title">먼작주 0.5.1</span></div>
  <div class="app-shell">
    <header class="shop-header">
      <div class="masthead">
        <div class="header-greeting"><span class="greeting-bubble" id="friend-greeting">안녕! 오늘도 반가워요.</span><div id="header-character" aria-hidden="true"></div><span class="greeting-stars" aria-hidden="true">✧</span></div>
        <a class="brand" href="#" aria-label="먼작주 홈"><img class="brand-logo" src="${brandLogo}" alt="먼작주"></a>
        <div class="masthead-actions"><button class="connection-pill" id="connection-pill" data-open-api><span class="status-dot"></span><span id="connection-label">데모 모드</span>${icon('arrowRight')}</button><button class="update-notice" id="update-notice" hidden><span id="update-notice-label">새 버전이 있어요</span>${icon('arrowRight')}</button></div>
      </div>
      <nav class="navigation" aria-label="주 메뉴">
        <button class="nav-button active" data-page="watchlist">${icon('grid')}<span>관심종목</span><span class="nav-count" id="nav-count">20</span></button>
        <button class="nav-button" data-page="portfolio">${icon('wallet')}<span>계좌·자산</span></button>
        <button class="nav-button" data-page="preferences">${icon('sliders')}<span>친구와 알림 설정</span></button>
        <button class="nav-button api-nav" data-open-api>${icon('plug')}<span>API 연결</span><span class="connection-dot" id="sidebar-connection"></span></button>
      </nav>
    </header>
    <main class="main-content">
      <header class="page-header">
        <div><h1 id="page-title">관심종목</h1></div>
        <span class="page-decoration" aria-hidden="true"><i></i><b>✧</b><i></i></span>
      </header>

      <div class="mode-banner" id="mode-banner"><span class="banner-label">DEMO</span><p id="mode-message">지금은 가상 시세로 둘러보는 중이에요. 내 API 키를 연결하면 실제 시세를 알려드려요.</p><button class="text-button" data-open-api>연결하기 ${icon('arrowRight')}</button></div>
      <section id="watchlist-view" class="view">
        <div class="overview-strip">
          <div class="overview-item"><span class="metric-icon coral">${icon('heart')}</span><div><span class="metric-label">함께 보는 종목</span><strong><span id="total-count">20</span><small>개</small></strong></div><span class="metric-note" id="market-count">국내 10 · 미국 10</span></div>
          <div class="overview-item"><span class="metric-icon yellow">${icon('clock')}</span><div><span class="metric-label">말풍선으로 알려줘요</span><strong><span id="interval-metric">5</span><small>분마다</small></strong></div></div>
          <div class="overview-item"><span class="metric-icon mint">${icon('arrow')}</span><div><span class="metric-label">깜짝 반응하는 순간</span><strong>±5<small>% 단위</small></strong></div><span class="live-label"><span></span>즉시 알림</span></div>
        </div>
        <div class="dashboard-grid">
          <section class="panel stocks-panel">
            <div class="panel-heading"><div><h2>나의 관심종목 <span id="watchlist-count" class="muted-count">20</span></h2><p id="table-baseline-label">전일 종가 대비</p></div><button class="button button-dark button-small" id="add-stock">${icon('plus')}종목 추가</button></div>
            <div class="stock-tools"><div class="segmented" role="group" aria-label="시장 선택"><button data-market="ALL" class="selected">전체</button><button data-market="KR">국내 <span id="kr-count">10</span></button><button data-market="US">미국 <span id="us-count">10</span></button></div><span id="quote-update-time" class="update-time"></span></div>
            <div class="table-wrap"><table class="stocks-table"><thead><tr><th>종목</th><th>현재가</th><th>등락률</th><th><span class="sr-only">종목 설정</span></th></tr></thead><tbody id="stock-rows"></tbody></table><div class="empty-state" id="stock-empty" hidden><span>✧</span><h3>함께 볼 종목을 골라볼까요?</h3><p>종목 추가에서 이름이나 티커로 검색해 주세요.</p></div></div>
            <div class="table-footer"><span class="tiny-dot"></span><span id="table-footnote">가상 시세 · 투자 판단에 사용할 수 없어요</span><span class="currency-note">KRW / USD</span></div>
          </section>
          <aside class="companion-column">
            <section class="companion-card">

              <h2 id="companion-title">치이카와</h2>
              <div class="character-stage"><span class="stage-sparkle spark-one">✦</span><span class="stage-sparkle spark-two">✧</span><span class="stage-dot"></span><div class="preview-bubble" id="preview-bubble">주식, 같이 지켜볼까?</div><div id="character-preview"></div><span class="stage-floor"></span></div>
              <div class="motion-tabs" role="group" aria-label="캐릭터 모션 미리보기"><button data-motion="idle" class="selected">평소에는</button><button data-motion="happy">오르면 ↑</button><button data-motion="cry">내리면 ↓</button></div>
              <button class="companion-select-link" id="choose-friend">${icon('heart')}나의 친구 · <strong id="active-friend-name">치이카와</strong>${icon('arrowRight')}</button>
            </section>
            <section class="panel quick-settings"><div class="compact-heading"><h2>감시 설정</h2><button class="icon-button" id="all-settings" aria-label="모든 설정 열기">${icon('sliders')}</button></div><div class="setting-summary"><span>등락 기준</span><strong id="baseline-summary">전일 종가</strong></div><div class="setting-summary"><span>거래 시간</span><strong>시간외 거래 포함</strong></div><div class="setting-summary"><span>알림 소리</span><strong class="quiet-label">${icon('moon')}조용히, 모션으로만</strong></div><div class="quick-roaming"><div><strong>화면 자유롭게 산책</strong><p>다른 앱을 켜도 곁에 있어요</p></div><label class="switch"><input type="checkbox" id="quick-roaming" checked aria-label="화면 자유롭게 산책"><span></span></label></div></section>
          </aside>
        </div>
      </section>

      <section id="portfolio-view" class="view" hidden>
        <div class="portfolio-demo-note" id="portfolio-demo-note" hidden><span class="banner-label">DEMO</span><p>아래 계좌와 보유 주식은 기능을 둘러보기 위한 가상 데이터예요.</p></div>
        <section class="panel portfolio-account-panel" aria-labelledby="portfolio-account-heading">
          <div class="portfolio-account-heading"><div><h2 id="portfolio-account-heading">내 계좌, 함께 살펴봐요</h2><p>주식 자산 · 예수금·채권·옵션 제외</p></div><span class="portfolio-flower" aria-hidden="true">✿</span></div>
          <div class="portfolio-account-tools"><div class="portfolio-account-field"><label class="field-label" for="portfolio-account-select">조회할 계좌</label><select id="portfolio-account-select" aria-describedby="portfolio-account-help"><option value="">계좌 조회 대기</option></select></div><button class="button button-soft" id="refresh-portfolio">${icon('refresh')}새로고침</button><span class="update-time" id="portfolio-updated-time">아직 조회하지 않았어요</span></div>
          <p class="field-help" id="portfolio-account-help">선택한 계좌의 보유 주식을 조회해요. 계좌번호는 일부만 표시해요.</p>
          <div class="portfolio-status" id="portfolio-status" role="status" aria-live="polite"></div>
        </section>
        <section class="portfolio-summary" id="portfolio-summary" aria-label="통화별 주식 자산"></section>
        <div class="portfolio-total-return" id="portfolio-total-return" hidden><span>전체 주식 수익률 <small>KRW 환산 기준</small></span><strong id="portfolio-return-value">—</strong><p>토스증권 API의 원화 환산 수익률 · 세금·수수료 차감 전</p></div>
        <section class="panel holdings-panel" aria-labelledby="holdings-heading"><div class="panel-heading"><div><h2 id="holdings-heading">내가 가진 주식 <span class="muted-count" id="portfolio-holdings-count">0</span></h2><p>당일·누적 수익률은 계좌 조회 결과예요. 말풍선은 설정한 등락 기준을 사용해요.</p></div><span class="portfolio-readonly">조회 전용</span></div><div class="holdings-table-wrap"><table class="holdings-table"><thead><tr><th scope="col">종목</th><th scope="col">보유 수량</th><th scope="col">평균 매수가</th><th scope="col">현재가</th><th scope="col">평가금액</th><th scope="col">평가손익</th><th scope="col">당일 수익률</th><th scope="col">누적 수익률</th></tr></thead><tbody id="portfolio-holding-rows"></tbody></table></div><div class="empty-state portfolio-empty" id="portfolio-empty"><span aria-hidden="true">♡</span><h3 id="portfolio-empty-title">내 주식을 만나볼까요?</h3><p id="portfolio-empty-message">API를 연결하면 계좌와 보유 주식을 조회할 수 있어요.</p><button class="button button-soft" data-open-api id="portfolio-connect">API 연결하기 ${icon('arrowRight')}</button></div><div class="portfolio-table-note"><span id="portfolio-coverage-note">국내·미국 주식 · 금액은 각 거래 통화로 표시해요.</span><span>세금·수수료 차감 전</span></div></section>
        <section class="panel portfolio-watch-panel"><div class="portfolio-watch-copy"><span class="metric-icon coral">${icon('heart')}</span><div><label for="auto-watch-holdings">보유 주식도 함께 지켜보기</label><p id="portfolio-watch-help">보유 주식을 관심종목에 자동으로 넣고, 5분마다 말풍선으로 알려줘요.</p><p class="portfolio-watch-detail">설정한 등락 기준의 ±5% 단계도 즉시 알려줘요. 안내 간격은 친구와 알림 설정에서 바꿀 수 있어요.</p></div></div><label class="switch"><input type="checkbox" id="auto-watch-holdings" checked aria-describedby="portfolio-watch-help"><span></span></label></section>
        <button class="text-button portfolio-settings-link" id="portfolio-notification-settings">말풍선 간격·등락 기준 설정 ${icon('arrowRight')}</button>
      </section>

      <section id="preferences-view" class="view" hidden>
        <section class="panel companion-mode-panel" aria-labelledby="companion-mode-heading"><div class="companion-mode-copy"><span class="metric-icon coral" aria-hidden="true">${icon('heart')}</span><div><h2 id="companion-mode-heading"><label for="companion-mode-input">산책 모드</label><span id="companion-mode-status" class="companion-mode-status">꺼짐</span></h2><p id="companion-mode-help">주식을 하지 않아도 친구와 함께해요. API 연결 없이 화면을 돌아다니며, 각자의 말투로 랜덤 대사를 들려줘요.</p><p class="companion-mode-note">켜면 바로 시작하고 다음 실행에도 기억해요. 주식 시세와 등락 알림은 쉬어가고, 끄면 이전 모드로 돌아가요.</p></div></div><label class="switch"><input type="checkbox" id="companion-mode-input" aria-labelledby="companion-mode-heading" aria-describedby="companion-mode-help"><span></span></label></section>
        <section class="panel character-selection-panel" aria-labelledby="character-selection-heading"><div class="character-section-heading"><div><h2 id="character-selection-heading">어떤 친구와 함께할까요?</h2><p>마음에 드는 친구를 누르면 바로 바뀌어요. 산책과 기쁨, 속상한 표정도 저마다 달라요.</p></div></div><div id="character-choices" class="character-choices" role="radiogroup" aria-labelledby="character-selection-heading" aria-describedby="character-choice-help"></div><p id="character-choice-help" class="character-choice-help">선택한 친구는 바로 저장돼요. 방향키로 다른 친구를 선택할 수 있어요.</p></section>
        <div class="settings-grid">
          <section class="panel settings-panel"><div class="panel-heading"><div><h2>어떻게 알려줄까요?</h2></div><span class="metric-icon yellow">${icon('bell')}</span></div>
            <label class="field-label" for="interval-input">현재가 안내 간격</label><div class="input-with-unit"><input id="interval-input" type="number" min="0.1" max="1440" step="0.1" value="5"><span>분마다</span></div><p class="field-help">관심종목의 가격을 차례로 말풍선에 띄워요.</p>
            <label class="field-label" for="baseline-select">상승 · 하락의 기준</label><select id="baseline-select"><option value="previousClose">전일 종가 대비</option><option value="purchase">내 평균 매수가 대비</option><option value="custom">내가 정한 가격 대비</option><option value="tracking">관심종목 등록가 대비</option></select><p class="field-help">직접 입력한 매수가를 우선 사용해요. 비워둔 보유 종목은 선택한 계좌의 평균 매수가를 사용하고, 지정 가격은 관심종목 설정에서 입력해요. 기준 가격이 없으면 등락 알림을 보내지 않아요.</p>
            <div class="threshold-note"><strong>±5 · 10 · 15 · 20 · 25 · 30%</strong><p>새 단계를 넘으면 즉시 반응해요.<br>같은 단계를 벗어났다가 다시 넘으면 또 알려드려요.</p></div>
            <button class="button button-dark" id="save-notifications">${icon('check')}알림 설정 저장</button>
          </section>
          <section class="panel settings-panel"><div class="panel-heading"><div><h2>캐릭터 설정</h2></div><span class="metric-icon coral">${icon('heart')}</span></div>
            <div class="setting-toggle-row"><div><strong>자유롭게 돌아다니기</strong><p id="roaming-help">화면 가장자리와 이곳저곳을 산책해요.</p></div><label class="switch"><input type="checkbox" id="roaming-input" checked aria-label="자유롭게 돌아다니기" aria-describedby="roaming-help"><span></span></label></div>
            <div class="range-title"><label class="field-label" for="pet-size-input">캐릭터 크기</label><output id="pet-size-value">${PET_SIZE.default} px</output></div><input type="range" id="pet-size-input" min="${PET_SIZE.min}" max="${PET_SIZE.max}" step="${PET_SIZE.step}" value="${PET_SIZE.default}"><div class="range-labels"><span>작게</span><span>크게</span></div>
            <div class="range-title speech-scale-heading"><label class="field-label" for="speech-scale-input">말풍선 크기</label><output id="speech-scale-value" for="speech-scale-input">100%</output></div><input type="range" id="speech-scale-input" min="80" max="160" step="10" value="100" aria-describedby="speech-scale-help"><div class="range-labels"><span>80%</span><span>160%</span></div><p class="field-help" id="speech-scale-help">글자와 말풍선 크기를 함께 조절해요.</p><div class="speech-scale-preview" aria-label="말풍선 크기 미리보기"><div class="speech-scale-sample" id="speech-scale-sample"><span>말풍선 미리보기</span><strong>아…!</strong><p>삼성전자 70,000원 · +5.00%</p></div></div>
            <div class="all-motions" role="group" aria-label="모든 모션 미리보기">${Object.entries(actionLabels).map(([action,label]) => `<button class="motion-button" data-preview-action="${action}">${label}</button>`).join('')}</div>
            <p class="field-help">항상 다른 앱 위에 표시돼요. 캐릭터를 드래그해서 옮기고, 오른쪽 클릭으로 메뉴를 열 수 있어요.</p><button class="button button-dark" id="save-character">${icon('check')}캐릭터 설정 저장</button>
          </section>
        </div>
        <section class="panel update-panel" aria-labelledby="update-heading">
          <div class="update-heading"><div><h2 id="update-heading">앱 업데이트</h2><p>현재 버전 <strong id="update-current-version">0.5.1</strong><span id="update-latest-version"></span></p></div><span class="update-status-badge" id="update-status-badge">확인 대기</span></div>
          <p id="update-status" class="update-status" role="status" aria-live="polite">새 버전이 있는지 확인할 수 있어요.</p>
          <progress id="update-progress" max="100" value="0" aria-label="새 버전 다운로드 진행률" hidden></progress>
          <p class="update-help" id="update-help"></p>
          <div class="update-actions"><button class="button button-soft" id="check-updates">${icon('refresh')}업데이트 확인</button><button class="button button-dark" id="download-update" hidden>새 버전 다운로드</button><button class="button button-dark" id="install-update" hidden>재시작하고 설치</button></div>
        </section>
        <div class="operation-note">${icon('clock')}<p>국내·미국 정규장과 시간외 거래를 함께 지켜봐요. 컴퓨터가 켜져 있고 앱이 실행 중일 때 작동하며, 소리는 재생하지 않아요.</p></div>
      </section>

      <footer class="page-footer"><p>본 앱은 투자 권유나 투자 자문을 제공하지 않습니다. 시세는 지연되거나 오류가 있을 수 있으며, 투자 판단과 결과에 대한 책임은 이용자 본인에게 있습니다.</p></footer>
    </main>
  </div>
  <dialog id="search-dialog" class="modal"><div class="modal-heading"><div><h2>어떤 종목이 궁금해요?</h2></div><button class="icon-button" data-close-dialog aria-label="닫기">${icon('close')}</button></div><p class="modal-intro">국내 종목명·종목코드 또는 미국 티커로 찾아보세요.</p><label class="search-input">${icon('search')}<input id="stock-search" autocomplete="off" placeholder="삼성전자, AAPL, 엔비디아…" aria-label="종목 검색"></label><div class="search-status" id="search-status">종목을 검색해 주세요</div><div id="search-results" class="search-results"></div><p class="modal-bottom-note" id="search-footnote">데모에서는 기본 관심종목 20개를 검색할 수 있어요.</p></dialog>
  <dialog id="api-dialog" class="modal api-modal"><div class="modal-heading"><div><h2>진짜 시세를 만나볼까요?</h2></div><button class="icon-button" data-close-dialog aria-label="닫기">${icon('close')}</button></div><p class="modal-intro">본인의 토스증권 Open API 키로 직접 연결해요.</p>
    <div class="api-steps"><div><span>1</span><p>토스증권에서 <strong>본인 API 키</strong> 발급</p></div><div><span>2</span><p>현재 컴퓨터의 <strong>공인 IP를 허용 IP로 등록</strong></p></div><div><span>3</span><p>아래에 키를 입력하고 <strong>연결하기</strong></p></div></div>
    <form id="api-form" autocomplete="off"><label class="field-label" for="client-id">Client ID</label><input id="client-id" name="client-id" type="password" autocomplete="off" spellcheck="false" required placeholder="발급받은 Client ID"><label class="field-label" for="client-secret">Client Secret</label><input id="client-secret" name="client-secret" type="password" autocomplete="new-password" spellcheck="false" required placeholder="발급받은 Client Secret"><div class="secret-note">${icon('check')}<p id="secret-storage-note">키는 이 컴퓨터의 운영체제 암호화 저장소를 사용해 보관해요. 앱에 포함하거나 별도 서버로 보내지 않아요.</p></div><p id="api-error" class="inline-error" role="alert" hidden></p><button class="button button-dark full-width" id="api-submit" type="submit">${icon('plug')}키 저장하고 연결하기</button></form>
    <div class="saved-credentials" id="saved-credentials" hidden><span>이 컴퓨터에 API 키가 저장되어 있어요.</span><button class="text-button" id="connect-saved">저장한 키로 연결</button><button class="text-button danger-text" id="clear-credentials">저장한 키 삭제</button></div><div class="api-bottom"><button class="text-button" id="use-demo">가상 시세로 둘러보기</button><a href="https://developers.tossinvest.com/docs" target="_blank" rel="noreferrer">API 발급 안내 ${icon('external')}</a></div><p class="modal-bottom-note">같은 키를 여러 기기에서 동시에 연결하면 기존 연결이 해제될 수 있어요. 집·회사 등 접속 장소가 바뀌면 허용 IP를 확인해 주세요.</p>
  </dialog>
  <dialog id="baseline-dialog" class="modal baseline-modal"><div class="modal-heading"><div><h2 id="baseline-stock-name">종목 설정</h2></div><button class="icon-button" data-close-dialog aria-label="닫기">${icon('close')}</button></div><p class="modal-intro" id="baseline-stock-symbol"></p><form id="baseline-form"><label class="field-label" for="purchase-price">내 평균 매수가</label><input id="purchase-price" type="number" min="0.000001" step="any" placeholder="가격 입력"><label class="field-label" for="reference-price">내가 정한 기준 가격</label><input id="reference-price" type="number" min="0.000001" step="any" placeholder="가격 입력"><p class="field-help" id="tracking-price-note"></p><p class="field-help" id="stock-baseline-help">전체 등락 기준은 친구와 알림 설정에서 변경할 수 있어요.</p><button type="submit" class="button button-dark full-width">${icon('check')}저장하기</button></form><button class="button button-remove full-width" id="remove-stock">관심종목에서 삭제</button></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;

const character = mountCharacter($('#character-preview'), {size: 178, action: 'idle', characterId: 'chiikawa'});
const headerCharacter = mountCharacter($('#header-character'), {size: 76, action: 'idle', characterId: 'chiikawa'});
const friendPreviews = [];
async function selectCharacter(profile) {
  if (!profile.available || characterSelectionBusy || snapshot?.config.characterId === profile.id) return;
  characterSelectionBusy = true;
  $('#character-choices').setAttribute('aria-busy', 'true');
  try {await perform(() => bridge.updateConfig({characterId: profile.id}), `${profile.name}와 함께할게요.`);}
  finally {characterSelectionBusy = false; $('#character-choices').removeAttribute('aria-busy');}
}
function buildCharacterChoices() {
  $('#character-choices').replaceChildren(...CHARACTER_CATALOG.map((profile) => {
    const selected = profile.id === currentCharacterId;
    const card = document.createElement('button'); card.type = 'button'; card.className = `character-choice character-choice-${profile.id}`; card.dataset.characterId = profile.id; card.disabled = !profile.available;
    card.setAttribute('role', 'radio'); card.setAttribute('aria-checked', String(selected)); card.setAttribute('aria-label', profile.name); card.setAttribute('aria-describedby', `friend-description-${profile.id}`); card.tabIndex = selected ? 0 : -1; card.style.setProperty('--friend-accent', profile.accent);
    const visual = textNode('span', `friend-visual ${profile.available ? '' : 'friend-planned'}`, ''); visual.setAttribute('aria-hidden', 'true');
    if (profile.available) friendPreviews.push(mountCharacter(visual, {size: 85, action: 'idle', characterId: profile.id}));
    else {visual.append(textNode('span', 'planned-dots', '• • •'), textNode('span', 'planned-lettering', 'COMING SOON'));}
    const description = textNode('span', '', profile.description); description.id = `friend-description-${profile.id}`;
    const details = textNode('span', 'friend-details', ''); details.append(textNode('strong', '', profile.name), description);
    card.append(visual, details, textNode('span', 'friend-status', !profile.available ? '준비 중' : selected ? '✓ 함께하는 중' : '선택하기'));
    if (profile.available) {
      card.addEventListener('click', () => selectCharacter(profile));
      card.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (characterSelectionBusy) return;
        const choices = $$('.character-choice:not(:disabled)');
        const index = choices.indexOf(card);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + choices.length) % choices.length;
        choices[next].focus(); choices[next].click();
      });
    }
    return card;
  }));
}
buildCharacterChoices();
$('#preview-bubble').textContent = speechFor('idle');
$$('.stocks-table th').forEach((header) => header.setAttribute('scope', 'col'));
$$('dialog').forEach((dialog) => {const heading = $('h2', dialog); if (!heading.id) heading.id = `${dialog.id}-title`; dialog.setAttribute('aria-labelledby', heading.id);});
$('.nav-button.active').setAttribute('aria-current', 'page');
$$('[data-motion]').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('selected'))));

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $('#toast'); element.textContent = message; element.classList.toggle('error', error); element.hidden = false;
  toastTimer = setTimeout(() => {element.hidden = true;}, error ? 6000 : 3300);
}
function messageOf(error) {return error?.message || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';}
function showSpeechScale(value) {$('#speech-scale-value').textContent = `${value}%`; $('#speech-scale-sample').style.setProperty('--speech-preview-scale', String(value / 100));}
async function perform(task, success) {try {const result = await task(); if (result?.config) render(result); if (success) toast(success); return result;} catch (error) {toast(messageOf(error), true); return null;}}
function formatPrice(price, marketName) {
  if (price === null || price === undefined || !Number.isFinite(Number(price))) return '—';
  return marketName === 'KR' ? `${Number(price).toLocaleString('ko-KR', {maximumFractionDigits: 0})}원` : `$${Number(price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}
function formatPercent(percent) {return percent === null || percent === undefined || !Number.isFinite(Number(percent)) ? '—' : `${percent > 0 ? '+' : ''}${Number(percent).toFixed(2)}%`;}
function formatTime(time) {return time ? new Date(time).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', hour12: false}) : '—';}
function textNode(tag, className, text) {const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node;}
function holdingKey(stock) {return `${stock.market}:${stock.symbol}`;}
function ownedStocks() {return new Set((snapshot?.portfolio?.holdings?.items || []).filter((item) => item.quantity > 0).map(holdingKey));}
function financialTone(value) {return Number.isFinite(value) ? value > 0 ? 'up' : value < 0 ? 'down' : 'neutral' : 'neutral';}
function formatAmount(value, currency, signed = false) {return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${signed && value > 0 ? '+' : ''}${formatPrice(value, currency === 'KRW' ? 'KR' : 'US')}`;}
function formatQuantity(value) {return Number.isFinite(value) ? `${value.toLocaleString('ko-KR', {maximumFractionDigits: 8})}주` : '—';}
function setPage(next) {
  page = next;
  const titles = {watchlist: '관심종목', portfolio: '계좌·자산', preferences: '친구와 알림 설정'};
  $('#page-title').textContent = titles[next] || titles.watchlist;
  $$('.view').forEach((view) => {view.hidden = view.id !== `${next}-view`;});
  $$('[data-page]').forEach((button) => {button.classList.toggle('active', button.dataset.page === next); if (button.dataset.page === next) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');});
  window.scrollTo({top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
}
function renderUpdate(next) {
  updateState = {...updateState, ...next};
  const {status, mode, currentVersion, latestVersion, message, progress} = updateState;
  const labels = {idle: '확인 대기', checking: '확인 중', available: '새 버전', current: '최신 버전', downloading: '다운로드 중', downloaded: '설치 준비 완료', error: '확인 필요', disabled: '사용 불가'};
  const messages = {idle: '새 버전이 있는지 확인할 수 있어요.', checking: '새 버전을 확인하고 있어요.', available: '새 버전을 사용할 수 있어요.', current: '최신 버전을 사용 중이에요.', downloading: '새 버전을 다운로드하고 있어요.', downloaded: '새 버전 다운로드가 끝났어요. 준비되면 재시작해 주세요.', error: '업데이트를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.', disabled: '데스크톱 앱에서 업데이트를 확인할 수 있어요.'};
  const disabled = mode === 'disabled' || status === 'disabled';
  const busy = updateBusy || ['checking', 'downloading'].includes(status);
  $('#update-current-version').textContent = currentVersion || snapshot?.version || '0.5.1';
  $('#update-latest-version').textContent = latestVersion && latestVersion !== currentVersion ? ` · 새 버전 ${latestVersion}` : '';
  $('#update-status-badge').textContent = labels[status] || labels.idle;
  $('#update-status-badge').dataset.status = status;
  $('#update-status').textContent = message || messages[status] || messages.idle;
  $('#update-help').textContent = disabled ? '' : mode === 'manual' ? '새 버전을 다운로드한 뒤 앱을 교체해 주세요.' : '다운로드 후 원하는 때 재시작해서 업데이트할 수 있어요.';
  $('#update-help').hidden = disabled;
  $('#check-updates').disabled = disabled || busy;
  $('#download-update').hidden = status !== 'available';
  $('#download-update').disabled = disabled || busy;
  $('#install-update').hidden = status !== 'downloaded' || mode !== 'automatic';
  $('#install-update').disabled = busy;
  const percent = typeof progress === 'number' ? progress : progress?.percent;
  $('#update-progress').hidden = status !== 'downloading';
  if (Number.isFinite(percent)) $('#update-progress').value = Math.min(100, Math.max(0, percent));
  else $('#update-progress').removeAttribute('value');
  const showNotice = !disabled && ['available', 'downloading', 'downloaded'].includes(status);
  $('#update-notice').hidden = !showNotice;
  $('#update-notice-label').textContent = status === 'downloading' ? '업데이트 다운로드 중' : status === 'downloaded' ? '업데이트 설치 준비 완료' : latestVersion ? `${latestVersion} 업데이트` : '새 버전이 있어요';
}
async function performUpdate(method) {
  if (updateBusy || typeof bridge[method] !== 'function') return;
  updateBusy = true; renderUpdate(updateState);
  try {
    const result = await bridge[method]();
    renderUpdate(result?.status ? result : await bridge.getUpdateState());
  } catch (error) {
    renderUpdate({status: 'error', message: messageOf(error)});
  } finally {updateBusy = false; renderUpdate(updateState);}
}
function preview(action) {
  clearTimeout(reactionTimer);
  selectedAction = action; character.setAction(action, {restart: true}); bridge.previewMotion(action);
  $$('[data-motion]').forEach((button) => {button.classList.toggle('selected', button.dataset.motion === action); button.setAttribute('aria-pressed', String(button.dataset.motion === action));});
  $('#preview-bubble').textContent = speechFor(action);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) $('#preview-bubble').animate([{opacity: .45, translate: '0 5px'}, {opacity: 1, translate: '0 0'}], {duration: 240, easing: 'ease-out'});
}
function renderRows() {
  if (!snapshot) return;
  const stocks = snapshot.config.watchlist.filter((stock) => market === 'ALL' || stock.market === market);
  const owned = ownedStocks();
  const rows = stocks.map((stock) => {
    const quote = snapshot.quotes.find((item) => item.symbol === stock.symbol && item.market === stock.market);
    const percent = quote?.changePercent;
    const tr = document.createElement('tr');
    const stockCell = document.createElement('td'); const stockInfo = textNode('div', 'stock-info', '');
    const badge = textNode('span', `stock-avatar avatar-${stock.symbol.charCodeAt(0) % 6}`, stock.market === 'US' ? stock.symbol.slice(0, 2) : stock.name.slice(0, 1));
    const title = textNode('div', 'stock-title', ''); title.append(textNode('strong', '', stock.name), textNode('span', '', stock.symbol)); stockInfo.append(badge, title); stockCell.append(stockInfo);
    if (owned.has(holdingKey(stock))) {const tag = textNode('span', 'owned-badge', '보유'); tag.title = '선택한 계좌에서 조회한 보유 종목'; title.firstChild.append(tag);}
    const priceCell = textNode('td', 'price-cell', formatPrice(quote?.price, stock.market));
    const key = `${stock.market}:${stock.symbol}`, oldPrice = lastPrices.get(key);
    if (Number.isFinite(oldPrice) && Number.isFinite(quote?.price) && oldPrice !== quote.price) priceCell.classList.add(quote.price > oldPrice ? 'price-rising' : 'price-falling');
    if (Number.isFinite(quote?.price)) lastPrices.set(key, quote.price);
    if (quote?.unavailable) {
      priceCell.replaceChildren(textNode('span', 'unavailable-badge', '시세 미제공'));
      priceCell.title = '시세를 제공하지 않아요 · 종목을 확인해 주세요';
    } else if (quote?.stale) priceCell.append(textNode('small', 'stale-note', '마지막 수신가'));
    const changeCell = document.createElement('td'); changeCell.append(textNode('span', `change-badge ${percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral'}`, formatPercent(percent)));
    const actionCell = document.createElement('td'); const button = textNode('button', 'row-action', '···'); button.setAttribute('aria-label', `${stock.name} 가격 설정 및 삭제`); button.title = '가격 설정 및 삭제'; button.addEventListener('click', () => openStockSettings(stock)); actionCell.append(button);
    tr.append(stockCell, priceCell, changeCell, actionCell); return tr;
  });
  $('#stock-rows').replaceChildren(...rows); $('#stock-empty').hidden = Boolean(stocks.length);
}
function renderPortfolio() {
  const portfolio = snapshot.portfolio || {status: 'idle', accounts: [], holdings: null};
  const signature = JSON.stringify([portfolio, snapshot.mode, snapshot.config.autoWatchHoldings, snapshot.config.intervalMinutes, portfolioBusy, autoWatchBusy]);
  if (signature === lastPortfolioRender) return;
  lastPortfolioRender = signature;
  const {holdings, accounts = []} = portfolio, loading = portfolio.status === 'loading' || portfolioBusy, demo = snapshot.mode === 'demo';
  const items = (holdings?.items || []).filter((item) => item.quantity > 0);
  $('#portfolio-demo-note').hidden = !demo;
  $('#portfolio-account-select').replaceChildren(...(accounts.length ? accounts.map((account) => {const option = textNode('option', '', account.label); option.value = String(account.id); return option;}) : [textNode('option', '', loading ? '계좌를 조회하고 있어요…' : '조회된 계좌가 없어요')]));
  $('#portfolio-account-select').value = portfolio.selectedAccountId == null ? '' : String(portfolio.selectedAccountId);
  $('#portfolio-account-select').disabled = loading || !accounts.length;
  $('#refresh-portfolio').disabled = loading;
  $('#refresh-portfolio').classList.toggle('is-loading', loading);
  $('#portfolio-view').setAttribute('aria-busy', String(loading));
  $('#portfolio-updated-time').textContent = portfolio.updatedAt ? `${new Date(portfolio.updatedAt).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false})} 조회${portfolio.stale ? ' · 이전 조회 결과' : ''}` : '아직 조회하지 않았어요';
  const status = $('#portfolio-status');
  status.classList.toggle('is-error', portfolio.status === 'error'); status.classList.toggle('is-stale', Boolean(portfolio.stale));
  status.textContent = loading ? '계좌와 주식 자산을 조회하고 있어요…' : portfolio.message || (portfolio.status === 'ready' ? '선택한 계좌의 주식 자산을 불러왔어요.' : 'API 연결 후 새로고침을 눌러 내 계좌를 살펴보세요.');
  if (portfolio.stale && holdings) status.textContent += ' 이전 조회 결과를 표시하고 있어요. 새로고침해 주세요.';
  if (portfolio.omittedWatchCount > 0) status.textContent += ` 관심종목 한도로 보유 종목 ${portfolio.omittedWatchCount}개를 자동 추가하지 못했어요.`;
  const cards = ['KRW', 'USD'].map((currency) => {
    const key = currency.toLowerCase(), card = textNode('section', `panel portfolio-currency-card currency-${key}`, '');
    card.dataset.currency = currency;
    const heading = textNode('div', 'portfolio-currency-heading', ''); heading.append(textNode('h3', '', currency === 'KRW' ? '원화 주식 자산' : '달러 주식 자산'), textNode('span', '', currency));
    const value = textNode('strong', 'portfolio-market-value', formatAmount(holdings?.marketValue?.[key], currency)); value.dataset.portfolioValue = currency;
    card.append(heading, textNode('span', 'portfolio-value-label', '평가금액'), value);
    const detail = document.createElement('dl'); detail.className = 'portfolio-currency-detail';
    for (const [label, amount, signed] of [['매입금액', holdings?.purchaseAmount?.[key], false], ['평가손익', holdings?.profitLoss?.[key], true], ['오늘 손익', holdings?.dailyProfitLoss?.[key], true]]) {const line = document.createElement('div'); line.append(textNode('dt', '', label), textNode('dd', signed ? financialTone(amount) : '', formatAmount(amount, currency, signed))); detail.append(line);}
    card.append(detail); return card;
  });
  $('#portfolio-summary').replaceChildren(...cards);
  $('#portfolio-total-return').hidden = !holdings;
  $('#portfolio-return-value').textContent = formatPercent(holdings?.profitLossPercent); $('#portfolio-return-value').className = financialTone(holdings?.profitLossPercent);
  $('#portfolio-holdings-count').textContent = String(items.length);
  $('#portfolio-holding-rows').replaceChildren(...items.map((item) => {
    const row = document.createElement('tr'); row.dataset.holding = holdingKey(item);
    const name = document.createElement('td'), title = textNode('div', 'holding-title', ''); title.append(textNode('strong', '', item.name), textNode('span', '', `${item.symbol} · ${item.currency}`)); name.append(title);
    row.append(name, textNode('td', 'holding-quantity', formatQuantity(item.quantity)), textNode('td', '', formatAmount(item.purchasePrice, item.currency)), textNode('td', '', formatAmount(item.price, item.currency)), textNode('td', 'holding-value', formatAmount(item.marketValue, item.currency)), textNode('td', financialTone(item.profitLoss), formatAmount(item.profitLoss, item.currency, true)), textNode('td', financialTone(item.dailyChangePercent), formatPercent(item.dailyChangePercent)), textNode('td', financialTone(item.profitLossPercent), formatPercent(item.profitLossPercent))); return row;
  }));
  $('#portfolio-empty').hidden = Boolean(items.length);
  const emptyReady = portfolio.status === 'ready' && holdings;
  $('#portfolio-empty-title').textContent = loading ? '내 주식을 찾고 있어요…' : emptyReady ? '조회된 보유 주식이 없어요' : portfolio.status === 'error' ? '계좌 조회를 확인해 주세요' : '내 주식을 만나볼까요?';
  $('#portfolio-empty-message').textContent = emptyReady ? '이 계좌에는 표시할 국내·미국 주식이 없어요. 다른 계좌도 선택해 보세요.' : portfolio.status === 'error' ? '위 안내를 확인한 뒤 새로고침해 주세요.' : loading ? '잠시만 기다려 주세요.' : 'API를 연결하면 계좌와 보유 주식을 조회할 수 있어요.';
  $('#portfolio-connect').hidden = loading || demo || accounts.length > 0 || snapshot.mode === 'live';
  $('#portfolio-coverage-note').textContent = `국내·미국 주식 · 금액은 각 거래 통화로 표시해요.${holdings?.unsupportedCount > 0 ? ` 표시 대상 외 ${holdings.unsupportedCount}개는 제외했어요.` : ''}`;
  $('#auto-watch-holdings').checked = snapshot.config.autoWatchHoldings !== false; $('#auto-watch-holdings').disabled = autoWatchBusy;
  $('#portfolio-watch-help').textContent = `선택한 계좌의 보유 주식을 관심종목에 자동으로 넣고, ${snapshot.config.intervalMinutes}분마다 현재가와 등락을 말풍선으로 알려줘요.`;
  $('.portfolio-watch-detail').textContent = `설정한 등락 기준의 ±5% 단계도 즉시 알려줘요. ${snapshot.config.autoWatchHoldings === false ? '자동 추가를 꺼도 이미 추가한 관심종목은 유지돼요.' : '보유 종목을 관심종목에서 빼려면 자동 추가를 먼저 꺼 주세요.'}`;
}
function render(next) {
  const wasCompanionMode = snapshot?.config.companionMode === true;
  snapshot = next; const {config, connection} = next;
  const companionMode = config.companionMode === true;
  const activeFriend = getCharacterProfile(config.characterId || 'chiikawa');
  $('#active-friend-name').textContent = activeFriend.name;
  $$('.character-choice').forEach((button) => {const selected = button.dataset.characterId === activeFriend.id; button.classList.toggle('selected', selected); button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1; if (!button.disabled) $('.friend-status', button).textContent = selected ? '✓ 함께하는 중' : '선택하기';});
  if (currentCharacterId !== activeFriend.id) {
    clearTimeout(reactionTimer); currentCharacterId = activeFriend.id;
    character.setCharacter(activeFriend.id); headerCharacter.setCharacter(activeFriend.id);
    character.setAction(selectedAction, {restart: true}); $('#preview-bubble').textContent = speechFor(selectedAction);
  }
  $('#friend-greeting').textContent = activeFriend.speech?.greeting || '안녕! 오늘도 반가워요.';
  $('#companion-title').textContent = activeFriend.name;
  $('.companion-card').dataset.character = activeFriend.id;
  if (companionMode !== wasCompanionMode) {clearTimeout(reactionTimer); character.setAction(selectedAction); $('#preview-bubble').textContent = speechFor(selectedAction);}
  $('.companion-mode-panel').classList.toggle('enabled', companionMode);
  $('#companion-mode-input').checked = companionMode;
  $('#companion-mode-input').disabled = companionModeBusy;
  $('#companion-mode-status').textContent = companionModeBusy ? '저장 중' : companionMode ? '함께 산책 중' : '꺼짐';
  $('#speech-scale-sample > span').textContent = companionMode ? activeFriend.name : '말풍선 미리보기';
  $('#speech-scale-sample > strong').textContent = speechFor('talk');
  $('#speech-scale-sample > p').hidden = companionMode;
  $('#roaming-help').textContent = companionMode ? '산책 모드를 끄면 이 설정을 다시 사용해요. 시스템의 모션 줄이기가 켜져 있으면 제자리에서 함께해요.' : '화면 가장자리와 이곳저곳을 산책해요.';
  $('.quick-roaming p').textContent = companionMode ? '산책 모드에서 친구와 함께해요' : '다른 앱을 켜도 곁에 있어요';
  $$('[data-preview-action]').forEach((button) => {button.textContent = labelFor(button.dataset.previewAction);});
  const krCount = config.watchlist.filter((stock) => stock.market === 'KR').length; const usCount = config.watchlist.filter((stock) => stock.market === 'US').length;
  ['total-count', 'watchlist-count', 'nav-count'].forEach((id) => {$(`#${id}`).textContent = String(config.watchlist.length);});
  $('#kr-count').textContent = String(krCount); $('#us-count').textContent = String(usCount); $('#market-count').textContent = `국내 ${krCount} · 미국 ${usCount}`;
  $('#interval-metric').textContent = String(config.intervalMinutes); $('#table-baseline-label').textContent = baselineLabels[config.baseline] || baselineLabels.previousClose; $('#baseline-summary').textContent = (baselineLabels[config.baseline] || '').replace(' 대비', '');
  if (!settingsDirty.notifications) {$('#interval-input').value = config.intervalMinutes; $('#baseline-select').value = config.baseline;}
  $('#quick-roaming').checked = config.roaming;
  if (!settingsDirty.character) {$('#roaming-input').checked = config.roaming; $('#pet-size-input').value = config.petSize; $('#pet-size-value').textContent = `${config.petSize} px`; $('#speech-scale-input').value = config.speechScale ?? 100; showSpeechScale(config.speechScale ?? 100);}
  const connected = next.mode === 'live' && connection.state === 'connected'; const demo = next.mode === 'demo';
  const connecting = connection.state === 'connecting'; const connectionLabel = companionMode ? '산책 모드' : connected ? '실시간 연결됨' : demo ? '데모 모드' : connecting ? '연결하는 중' : '연결을 확인해 주세요';
  $('#connection-label').textContent = connectionLabel; $('#connection-pill').classList.toggle('connected', connected); $('#sidebar-connection').classList.toggle('connected', connected);
  $('#connection-pill').classList.toggle('companion-active', companionMode);
  $('#mode-banner').classList.toggle('companion-active', companionMode); $('#mode-banner').classList.toggle('live', connected && !companionMode); $('#mode-banner').classList.toggle('warning', !companionMode && !connected && !demo); $('#mode-banner .banner-label').textContent = companionMode ? '산책' : demo ? 'DEMO' : connected ? 'LIVE' : 'STATUS';
  $('#mode-message').textContent = companionMode ? `${activeFriend.name}와 산책 중이에요. API 연결 없이 돌아다니며 랜덤 대사를 들려줘요. 주식 안내는 잠시 쉬어가요.` : demo ? '지금은 가상 시세로 둘러보는 중이에요. 내 API 키를 연결하면 실제 시세를 알려드려요.' : connected ? '내 API 키로 직접 연결했어요. 국내·미국, 시간외 거래까지 함께 지켜봐요.' : connection.message || 'API 키를 연결하면 실제 시세를 받아볼 수 있어요.';
  $('#mode-banner .text-button').textContent = companionMode ? '산책 설정 →' : connected ? '연결 관리 →' : '연결하기 →';
  $('#table-footnote').textContent = companionMode ? '산책 모드 · 주식 시세와 등락 알림을 쉬고 있어요' : demo ? '가상 시세 · 투자 판단에 사용할 수 없어요' : connected ? '토스증권 Open API · 마지막 수신 시세' : '연결 대기 · 수신된 가격만 표시해요';
  const latest = Math.max(0, ...next.quotes.map((quote) => quote.updatedAt || 0)); $('#quote-update-time').textContent = latest ? `${formatTime(latest)} 기준` : '시세 수신 대기';
  $('#saved-credentials').hidden = !next.credentialsConfigured;
  const version = next.version || '0.5.1';
  $('#window-title').textContent = `먼작주 ${version}`;
  document.title = `먼작주 ${version}`;
  $('#update-current-version').textContent = version;
  $('#secret-storage-note').textContent = isDesktop ? '키는 이 컴퓨터에서 운영체제 암호화를 사용해 보관해요. 앱에 포함하거나 별도 서버로 보내지 않아요.' : '브라우저 미리보기에서는 API 키를 입력하거나 저장하지 않아요. 실제 연결은 데스크톱 앱에서 이용해 주세요.';
  $('#api-submit').disabled = !isDesktop || apiBusy; $('#client-id').disabled = !isDesktop || apiBusy; $('#client-secret').disabled = !isDesktop || apiBusy;
  $('#api-submit').innerHTML = `${icon('plug')}${companionMode ? '키 저장하고 주식 모드 연결하기' : '키 저장하고 연결하기'}`;
  $('#connect-saved').textContent = companionMode ? '저장한 키로 주식 모드 연결' : '저장한 키로 연결';
  $('#use-demo').textContent = companionMode ? '산책을 멈추고 가상 시세 둘러보기' : '가상 시세로 둘러보기';
  $('#search-footnote').textContent = demo ? '데모에서는 기본 관심종목 20개를 검색할 수 있어요.' : next.catalogStatus?.message || '토스증권 종목 목록에서 검색해요. 목록을 가져오려면 API 연결이 필요해요.';
  if ($('#search-dialog').open && next.catalogStatus?.state === 'loading') $('#search-status').textContent = `종목 목록을 처음 불러오고 있어요 (${next.catalogStatus.completed}/${next.catalogStatus.total} 거래소)`;
  renderRows(); renderPortfolio();
}

function openDialog(id) {const dialog = $(id); if (!dialog.open) dialog.showModal();}
function openStockSettings(stock) {
  baselineStock = stock; $('#baseline-stock-name').textContent = stock.name; $('#baseline-stock-symbol').textContent = `${stock.market === 'KR' ? '국내' : '미국'} · ${stock.symbol} · ${stock.market === 'KR' ? '원(KRW)' : '달러(USD)'} 기준`;
  $('#purchase-price').value = stock.purchasePrice || ''; $('#reference-price').value = stock.referencePrice || '';
  const accountHolding = snapshot.portfolio?.holdings?.items?.find((item) => holdingKey(item) === holdingKey(stock) && item.quantity > 0);
  const usesAccountAverage = Number.isFinite(accountHolding?.purchasePrice) && accountHolding.purchasePrice > 0;
  $('#purchase-price').placeholder = usesAccountAverage ? '비워두면 계좌 평균가 사용' : '가격 입력';
  $('#stock-baseline-help').textContent = `직접 입력한 매수가를 우선 사용해요. ${usesAccountAverage ? '매수가를 비워두면 선택한 계좌의 평균 매수가를 사용해요.' : '보유 종목은 선택한 계좌의 평균 매수가를 자동으로 사용할 수 있어요.'} 기준 가격이 없는 종목은 해당 기준의 알림이 꺼져요. 전체 등락 기준은 친구와 알림 설정에서 바꿔요.`;
  $('#tracking-price-note').textContent = `관심종목 등록가: ${formatPrice(stock.trackingPrice, stock.market)}${stock.trackingPrice ? '' : ' · 최초 시세 수신 시 설정돼요'}`; openDialog('#baseline-dialog');
  const autoOwned = snapshot.config.autoWatchHoldings !== false && ownedStocks().has(holdingKey(stock));
  $('#remove-stock').disabled = autoOwned;
  $('#remove-stock').textContent = autoOwned ? '보유 종목 · 계좌·자산에서 자동 추가를 먼저 꺼 주세요' : '관심종목에서 삭제';
}
async function searchStocks() {
  const sequence = ++searchSequence; const query = $('#stock-search').value.trim(); $('#search-status').textContent = snapshot?.mode === 'live' && snapshot?.catalogStatus?.state !== 'ready' ? '종목 목록을 처음 불러오고 있어요 (몇 초 걸려요)' : '종목을 찾고 있어요…';
  try {
    const results = await bridge.searchStocks(query); if (sequence !== searchSequence) return;
    $('#search-status').textContent = results.length ? `${results.length}개 종목` : query ? '검색 결과가 없어요. 종목명이나 티커를 확인해 주세요.' : '종목 이름이나 티커를 입력해 주세요.';
    const nodes = results.slice(0, 60).map((stock) => {
      const added = snapshot.config.watchlist.some((item) => item.symbol === stock.symbol && item.market === stock.market);
      const row = textNode('div', 'search-result', ''); const info = textNode('div', '', ''); info.append(textNode('strong', '', stock.name), textNode('span', '', `${stock.market === 'KR' ? '국내' : '미국'} · ${stock.symbol}`));
      const add = textNode('button', `button button-small ${added ? 'button-added' : 'button-soft'}`, added ? '추가됨' : '+ 추가'); add.disabled = added;
      add.addEventListener('click', async () => {add.disabled = true; const result = await perform(() => bridge.updateConfig({watchlist: [...snapshot.config.watchlist, {symbol: stock.symbol, name: stock.name, market: stock.market}]}), `${stock.name}, 함께 지켜볼게요.`); if (result) searchStocks(); else add.disabled = false;});
      row.append(info, add); return row;
    }); $('#search-results').replaceChildren(...nodes);
  } catch (error) {if (sequence === searchSequence) {$('#search-status').textContent = messageOf(error); $('#search-results').replaceChildren();}}
}

$$('[data-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
$('.brand').addEventListener('click', (event) => {event.preventDefault(); setPage('watchlist');});
$('#all-settings').addEventListener('click', () => setPage('preferences'));
$('#choose-friend').addEventListener('click', () => setPage('preferences'));
$('#update-notice').addEventListener('click', () => {
  setPage('preferences');
  $('#update-heading').scrollIntoView({block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
});
$('#check-updates').addEventListener('click', () => performUpdate('checkForUpdates'));
$('#download-update').addEventListener('click', () => performUpdate('downloadUpdate'));
$('#install-update').addEventListener('click', () => performUpdate('installUpdate'));
$('#portfolio-notification-settings').addEventListener('click', () => {setPage('preferences'); $('#interval-input').focus({preventScroll: true});});
async function performPortfolio(task) {
  if (portfolioBusy) return;
  portfolioBusy = true; renderPortfolio();
  try {await perform(task);} finally {portfolioBusy = false; renderPortfolio();}
}
$('#refresh-portfolio').addEventListener('click', () => performPortfolio(() => bridge.refreshPortfolio()));
$('#portfolio-account-select').addEventListener('change', (event) => {
  const id = Number(event.target.value);
  if (event.target.value && Number.isSafeInteger(id)) performPortfolio(() => bridge.selectAccount(id));
});
$('#auto-watch-holdings').addEventListener('change', async (event) => {
  if (autoWatchBusy) return;
  const enabled = event.target.checked; autoWatchBusy = true; event.target.disabled = true;
  try {await perform(() => bridge.updateConfig({autoWatchHoldings: enabled}), enabled ? '보유 주식도 함께 지켜볼게요.' : '자동 추가를 껐어요. 이미 추가한 관심종목은 유지돼요.');}
  finally {autoWatchBusy = false; renderPortfolio();}
});
$$('[data-market]').forEach((button) => {button.setAttribute('aria-pressed', String(button.classList.contains('selected'))); button.addEventListener('click', () => {market = button.dataset.market; $$('[data-market]').forEach((item) => {item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button));}); renderRows();});});
$$('[data-open-api]').forEach((button) => button.addEventListener('click', () => {
  if (snapshot?.config.companionMode && (button.id === 'connection-pill' || button.closest('#mode-banner'))) {setPage('preferences'); $('#companion-mode-input').focus({preventScroll: true});}
  else openDialog('#api-dialog');
}));
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach((dialog) => {dialog.addEventListener('click', (event) => {if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();}); dialog.addEventListener('close', () => {if (dialog.id === 'api-dialog') {$('#client-id').value = ''; $('#client-secret').value = ''; $('#api-error').hidden = true;}});});
$('#add-stock').addEventListener('click', () => {openDialog('#search-dialog'); $('#stock-search').value = ''; searchStocks(); $('#stock-search').focus();});
let searchTimer; $('#stock-search').addEventListener('input', () => {clearTimeout(searchTimer); searchSequence++; searchTimer = setTimeout(searchStocks, 220);});
$$('[data-motion]').forEach((button) => button.addEventListener('click', () => preview(button.dataset.motion)));
$$('[data-preview-action]').forEach((button) => button.addEventListener('click', () => {preview(button.dataset.previewAction); toast(`${labelFor(button.dataset.previewAction)} 모션을 보여줄게요.`);}));
$('#quick-roaming').addEventListener('change', async (event) => {const result = await perform(() => bridge.updateConfig({roaming: event.target.checked})); if (!result) event.target.checked = snapshot.config.roaming;});
$('#companion-mode-input').addEventListener('change', async (event) => {
  if (companionModeBusy) return;
  const enabled = event.target.checked; companionModeBusy = true; event.target.disabled = true; $('#companion-mode-status').textContent = '저장 중';
  try {await perform(() => bridge.updateConfig({companionMode: enabled}), enabled ? '산책을 시작해요. 친구의 이야기를 들어보세요.' : '산책 모드를 끄고 이전 모드로 돌아왔어요.');}
  finally {companionModeBusy = false; if (snapshot) render(snapshot);}
});
['#interval-input', '#baseline-select'].forEach((selector) => {$(selector).addEventListener('input', () => {settingsDirty.notifications = true;}); $(selector).addEventListener('change', () => {settingsDirty.notifications = true;});});
$('#roaming-input').addEventListener('change', () => {settingsDirty.character = true;});
$('#pet-size-input').addEventListener('input', (event) => {settingsDirty.character = true; $('#pet-size-value').textContent = `${event.target.value} px`;});
$('#speech-scale-input').addEventListener('input', (event) => {settingsDirty.character = true; showSpeechScale(Number(event.target.value));});
$('#save-notifications').addEventListener('click', async () => {
  const intervalMinutes = Number($('#interval-input').value); if (!Number.isFinite(intervalMinutes) || intervalMinutes < 0.1 || intervalMinutes > 1440) return toast('안내 간격은 0.1~1440분 사이로 입력해 주세요.', true);
  await perform(async () => {const result = await bridge.updateConfig({intervalMinutes, baseline: $('#baseline-select').value}); settingsDirty.notifications = false; return result;}, '알려주는 방식을 기억했어요.');
});
$('#save-character').addEventListener('click', () => perform(async () => {const result = await bridge.updateConfig({roaming: $('#roaming-input').checked, petSize: Number($('#pet-size-input').value), speechScale: Number($('#speech-scale-input').value)}); settingsDirty.character = false; return result;}, '친구의 설정을 저장했어요.'));
$('#baseline-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!baselineStock) return;
  const purchasePrice = $('#purchase-price').value ? Number($('#purchase-price').value) : undefined;
  const referencePrice = $('#reference-price').value ? Number($('#reference-price').value) : undefined;
  if ([purchasePrice, referencePrice].some((value) => value !== undefined && (!Number.isFinite(value) || value <= 0))) return toast('가격은 0보다 큰 숫자로 입력해 주세요.', true);
  const watchlist = snapshot.config.watchlist.map((stock) => stock.symbol === baselineStock.symbol && stock.market === baselineStock.market ? {...stock, purchasePrice, referencePrice} : stock);
  const result = await perform(() => bridge.updateConfig({watchlist}), '기준 가격을 저장했어요.'); if (result) $('#baseline-dialog').close();
});
$('#remove-stock').addEventListener('click', async () => {if (!baselineStock) return; const result = await perform(() => bridge.updateConfig({watchlist: snapshot.config.watchlist.filter((stock) => !(stock.symbol === baselineStock.symbol && stock.market === baselineStock.market))}), '관심종목에서 삭제했어요.'); if (result) $('#baseline-dialog').close();});
$('#api-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!isDesktop) return;
  const button = $('#api-submit'); apiBusy = true; button.disabled = true; $('#api-error').hidden = true;
  try {render(await bridge.setCredentials({clientId: $('#client-id').value.trim(), clientSecret: $('#client-secret').value.trim()})); $('#client-id').value = ''; $('#client-secret').value = ''; render(await bridge.connect()); if (snapshot.connection.state === 'error') throw new Error(snapshot.connection.message); $('#api-dialog').close(); toast('API 연결을 시작했어요.');}
  catch (error) {$('#api-error').textContent = messageOf(error); $('#api-error').hidden = false;}
  finally {$('#client-id').value = ''; $('#client-secret').value = ''; apiBusy = false; button.disabled = false; $('#client-id').disabled = false; $('#client-secret').disabled = false;}
});
$('#connect-saved').addEventListener('click', async () => {const result = await perform(() => bridge.connect()); if (result && result.connection.state !== 'error') $('#api-dialog').close(); else if (result) toast(result.connection.message, true);});
$('#clear-credentials').addEventListener('click', () => perform(() => bridge.clearCredentials(), '이 컴퓨터에 저장한 API 키를 삭제했어요.'));
$('#use-demo').addEventListener('click', async () => {const result = await perform(() => bridge.demo(), '가상 시세로 둘러보는 중이에요.'); if (result) $('#api-dialog').close();});
$('.api-bottom a').addEventListener('click', (event) => {if (isDesktop && bridge.openDocs) {event.preventDefault(); bridge.openDocs();}});
bridge.onState(render);
bridge.onUpdateState?.(renderUpdate);
bridge.getUpdateState?.().then(renderUpdate).catch(() => renderUpdate({status: 'error', message: '업데이트 상태를 불러오지 못했어요. 다시 확인해 주세요.'}));
bridge.onMotion((event) => {if (event.alert && !snapshot?.config.companionMode) {clearTimeout(reactionTimer); character.setAction(event.action, {restart: true}); $('#preview-bubble').textContent = `${speechFor(event.action)} ${event.alert.name} ${formatPercent(event.alert.percent)}`; reactionTimer = setTimeout(() => {character.setAction(selectedAction); $('#preview-bubble').textContent = speechFor(selectedAction);}, 6500);}});
bridge.getState().then(render).catch((error) => toast(messageOf(error), true));
window.addEventListener('beforeunload', () => {clearTimeout(reactionTimer); character.destroy(); headerCharacter.destroy(); friendPreviews.forEach((preview) => preview.destroy());}, {once: true});
