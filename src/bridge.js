import {normalizeConfig} from '../lib/config.js';

/** The browser preview intentionally never receives or saves real credentials. */
export const isDesktop = Boolean(window.chii);

const demoStocks = [
  ['KR', '005930', '삼성전자', 71900, 70200],
  ['KR', '000660', 'SK하이닉스', 191500, 194000],
  ['KR', '373220', 'LG에너지솔루션', 371000, 365000],
  ['KR', '207940', '삼성바이오로직스', 982000, 970000],
  ['KR', '005380', '현대차', 246000, 250000],
  ['KR', '000270', '기아', 108500, 106000],
  ['KR', '068270', '셀트리온', 189500, 191000],
  ['KR', '005490', 'POSCO홀딩스', 368000, 374000],
  ['KR', '035420', 'NAVER', 184500, 181000],
  ['KR', '035720', '카카오', 41300, 42100],
  ['US', 'AAPL', '애플', 228.52, 225.77],
  ['US', 'MSFT', '마이크로소프트', 428.76, 431.05],
  ['US', 'NVDA', '엔비디아', 136.93, 132.65],
  ['US', 'AMZN', '아마존', 192.53, 190.12],
  ['US', 'GOOGL', '알파벳 A', 165.87, 167.23],
  ['US', 'META', '메타', 582.11, 575.20],
  ['US', 'TSLA', '테슬라', 248.50, 255.90],
  ['US', 'BRK.B', '버크셔 해서웨이 B', 464.71, 461.02],
  ['US', 'AVGO', '브로드컴', 181.48, 177.61],
  ['US', 'JPM', 'JP모건 체이스', 225.37, 223.98],
].map(([market, symbol, name, price, previousClose]) => ({ market, symbol, name, price, previousClose }));

const clone = (data) => structuredClone(data);
// Explicitly synthetic preview data. Real account data stays in the desktop main process.
function demoHoldings(empty = false) {
  const items = empty ? [] : [
    {symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', quantity: 10, price: 71900, purchasePrice: 68000, purchaseAmount: 680000, marketValue: 719000, marketValueAfterCost: null, profitLoss: 39000, profitLossAfterCost: null, profitLossPercent: 39000 / 680000 * 100, profitLossAfterCostPercent: null, dailyProfitLoss: 17000, dailyChangePercent: (71900 / 70200 - 1) * 100, commission: null, tax: null},
    {symbol: 'AAPL', name: '애플', market: 'US', currency: 'USD', quantity: 1.25, price: 228.52, purchasePrice: 250, purchaseAmount: 312.5, marketValue: 285.65, marketValueAfterCost: null, profitLoss: -26.85, profitLossAfterCost: null, profitLossPercent: -8.592, profitLossAfterCostPercent: null, dailyProfitLoss: 3.4375, dailyChangePercent: (228.52 / 225.77 - 1) * 100, commission: null, tax: null},
  ];
  const totals = (key) => ({krw: items.filter((item) => item.currency === 'KRW').reduce((sum, item) => sum + item[key], 0), usd: items.filter((item) => item.currency === 'USD').reduce((sum, item) => sum + item[key], 0)});
  return {items, purchaseAmount: totals('purchaseAmount'), marketValue: totals('marketValue'), marketValueAfterCost: {krw: null, usd: null}, profitLoss: totals('profitLoss'), profitLossAfterCost: {krw: null, usd: null}, dailyProfitLoss: totals('dailyProfitLoss'), profitLossPercent: empty ? null : (39000 - 26.85 * 1300) / (680000 + 312.5 * 1300) * 100, profitLossAfterCostPercent: null, dailyChangePercent: null, unsupportedCount: 0};
}
function createBrowserDemo() {
  const listeners = new Set();
  const motionListeners = new Set();
  const bulletinListeners = new Set();
  const state = {
    version: '0.5.1', mode: 'demo', credentialsConfigured: false,
    connection: {state: 'connected', message: '브라우저 미리보기 · 모든 가격은 가상 시세입니다.', updatedAt: Date.now()},
    config: normalizeConfig({watchlist: demoStocks.map(({market, symbol, name}) => ({market, symbol, name}))}),
    quotes: [], alerts: [],
    portfolio: {status: 'ready', message: '가상 계좌의 주식 자산이에요. 실제 내 자산이 아니에요.', accounts: [{id: 1001, label: '가상계좌 •••• 0301'}, {id: 1002, label: '가상계좌 •••• 0302'}], selectedAccountId: 1001, holdings: demoHoldings(), updatedAt: Date.now(), stale: false, omittedWatchCount: 0},
  };
  const mergeHeldStocks = () => {
    if (state.config.companionMode || !state.config.autoWatchHoldings) return;
    for (const holding of state.portfolio.holdings?.items || []) {
      if (holding.quantity > 0 && !state.config.watchlist.some((stock) => stock.market === holding.market && stock.symbol === holding.symbol)) state.config.watchlist.push({symbol: holding.symbol, name: holding.name, market: holding.market});
    }
  };
  const makeQuotes = () => {
    if (state.config.companionMode) {state.quotes = []; return;}
    state.quotes = state.config.watchlist.map((stock) => {
      const fixture = demoStocks.find((item) => item.market === stock.market && item.symbol === stock.symbol);
      const price = fixture?.price ?? null;
      const held = state.portfolio.holdings?.items.find((item) => item.quantity > 0 && item.market === stock.market && item.symbol === stock.symbol);
      const baselinePrice = ({previousClose: fixture?.previousClose, purchase: stock.purchasePrice ?? held?.purchasePrice, custom: stock.referencePrice, tracking: stock.trackingPrice || price})[state.config.baseline] ?? null;
      return {...stock, currency: stock.market === 'KR' ? 'KRW' : 'USD', price, previousClose: fixture?.previousClose ?? null, baselinePrice, changePercent: baselinePrice && price ? (price / baselinePrice - 1) * 100 : null, updatedAt: Date.now(), stale: false};
    });
  };
  makeQuotes();
  const publish = () => {listeners.forEach((fn) => fn(clone(state))); return clone(state);};
  let bulletinTimer;
  function scheduleBulletin() {
    clearInterval(bulletinTimer);
    if (state.config.companionMode) return;
    bulletinTimer = setInterval(() => bulletinListeners.forEach((fn) => fn({quotes: clone(state.quotes), at: Date.now()})), state.config.intervalMinutes * 60_000);
  }
  const applyCompanionMode = () => {
    if (state.config.companionMode) {
      state.mode = 'offline';
      state.connection = {state: 'idle', message: '산책 모드 · API 연결 없이 친구와 함께해요.', updatedAt: Date.now()};
      state.portfolio = {status: 'idle', message: '산책 모드에서는 계좌 조회를 쉬고 있어요.', accounts: [], selectedAccountId: null, holdings: null, updatedAt: null, stale: false, omittedWatchCount: 0};
    } else {
      state.mode = 'demo';
      state.connection = {state: 'connected', message: '브라우저 미리보기 · 모든 가격은 가상 시세입니다.', updatedAt: Date.now()};
      state.portfolio = {status: 'ready', message: '가상 계좌의 주식 자산이에요. 실제 내 자산이 아니에요.', accounts: [{id: 1001, label: '가상계좌 •••• 0301'}, {id: 1002, label: '가상계좌 •••• 0302'}], selectedAccountId: 1001, holdings: demoHoldings(), updatedAt: Date.now(), stale: false, omittedWatchCount: 0};
      mergeHeldStocks();
    }
    makeQuotes(); scheduleBulletin();
  };
  scheduleBulletin();
  const updateState = {status: 'disabled', mode: 'disabled', currentVersion: '0.5.1', latestVersion: null, message: '브라우저 미리보기에서는 업데이트를 사용할 수 없어요. 데스크톱 앱에서 확인해 주세요.', progress: null};
  return {
    async getState() {return clone(state);},
    async getUpdateState() {return clone(updateState);},
    onUpdateState() {return () => {};},
    async checkForUpdates() {return clone(updateState);},
    async downloadUpdate() {return clone(updateState);},
    async installUpdate() {return clone(updateState);},
    onState(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    async updateConfig(patch) {
      const intervalChanged = patch.intervalMinutes !== undefined && patch.intervalMinutes !== state.config.intervalMinutes;
      const previousCompanionMode = state.config.companionMode;
      state.config = normalizeConfig(clone(patch), state.config);
      if (previousCompanionMode !== state.config.companionMode) {applyCompanionMode(); return publish();}
      if (patch.watchlist !== undefined || patch.baseline !== undefined || patch.autoWatchHoldings !== undefined) {mergeHeldStocks(); makeQuotes();}
      if (intervalChanged) scheduleBulletin();
      return publish();
    },
    async setCredentials() {throw new Error('API 키는 데스크톱 앱에서만 안전하게 저장할 수 있어요. 지금은 브라우저 미리보기입니다.');},
    async clearCredentials() {return publish();},
    async connect() {throw new Error('실시간 시세 연결은 Windows 또는 macOS 데스크톱 앱에서 이용해 주세요.');},
    async demo() {state.config = normalizeConfig({companionMode: false}, state.config); applyCompanionMode(); return publish();},
    async refreshPortfolio() {
      if (state.config.companionMode) throw new Error('산책 모드를 끄면 가상 계좌를 다시 살펴볼 수 있어요.');
      state.portfolio.status = 'loading'; publish();
      await new Promise((resolve) => setTimeout(resolve, 260));
      if (state.config.companionMode) return clone(state);
      state.portfolio.holdings = demoHoldings(state.portfolio.selectedAccountId === 1002);
      state.portfolio.status = 'ready'; state.portfolio.updatedAt = Date.now(); state.portfolio.stale = false;
      mergeHeldStocks(); makeQuotes(); return publish();
    },
    async selectAccount(id) {
      if (!state.portfolio.accounts.some((account) => account.id === id)) throw new Error('조회할 가상 계좌를 선택해 주세요.');
      state.portfolio.selectedAccountId = id; state.portfolio.holdings = null;
      return this.refreshPortfolio();
    },
    async searchStocks(query) {
      const q = query.trim().toLocaleLowerCase();
      return demoStocks.filter(({symbol, name}) => !q || symbol.toLowerCase().includes(q) || name.toLowerCase().includes(q)).map(({symbol, name, market}) => ({symbol, name, market}));
    },
    previewMotion(action) {motionListeners.forEach((fn) => fn({action}));},
    onMotion(fn) {motionListeners.add(fn); return () => motionListeners.delete(fn);},
    onBulletin(fn) {bulletinListeners.add(fn); return () => bulletinListeners.delete(fn);},
    openDocs() {window.open('https://developers.tossinvest.com/docs', '_blank', 'noopener,noreferrer');},
    setInteractive() {}, showSettings() {}, hidePet() {}, quit() {},
  };
}

let instance;
export function getBridge() {return window.chii || (instance ||= createBrowserDemo());}
export const bridge = getBridge();
