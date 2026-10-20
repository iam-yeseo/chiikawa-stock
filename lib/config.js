import { DEFAULT_CHARACTER_ID, isAvailableCharacter } from './characters.js';

export const BASELINES = ['previousClose', 'purchase', 'custom', 'tracking'];
export const MAX_WATCHLIST = 100;
export const PET_SIZE = Object.freeze({ min: 80, max: 300, step: 10, default: 150 });

// A small starter selection, not a ranking or investment recommendation.
export const STARTER_STOCKS = Object.freeze([
  ['005930', '삼성전자', 'KR'], ['000660', 'SK하이닉스', 'KR'],
  ['005380', '현대차', 'KR'], ['000270', '기아', 'KR'],
  ['035420', 'NAVER', 'KR'], ['035720', '카카오', 'KR'],
  ['373220', 'LG에너지솔루션', 'KR'], ['207940', '삼성바이오로직스', 'KR'],
  ['068270', '셀트리온', 'KR'], ['005490', 'POSCO홀딩스', 'KR'],
  ['AAPL', '애플', 'US'], ['MSFT', '마이크로소프트', 'US'],
  ['NVDA', '엔비디아', 'US'], ['AMZN', '아마존', 'US'],
  ['GOOGL', '알파벳 A', 'US'], ['META', '메타', 'US'],
  ['TSLA', '테슬라', 'US'], ['BRK.B', '버크셔 해서웨이 B', 'US'],
  ['JPM', 'JP모건 체이스', 'US'], ['AVGO', '브로드컴', 'US'],
].map(([symbol, name, market]) => Object.freeze({ symbol, name, market })));

export function defaultConfig() {
  return {
    intervalMinutes: 5, baseline: 'previousClose', roaming: true, companionMode: false, petSize: PET_SIZE.default, speechScale: 100, characterId: DEFAULT_CHARACTER_ID, autoWatchHoldings: true,
    watchlist: STARTER_STOCKS.map(stock => ({ ...stock })),
  };
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 형식이 올바르지 않아요.`);
}

export function stockKey(stock) { return `${stock.market}:${stock.symbol}`; }

export function normalizeStock(stock) {
  object(stock, '종목');
  if (stock.market !== 'KR' && stock.market !== 'US') throw new TypeError('국내 또는 미국 종목만 지원해요.');
  if (typeof stock.symbol !== 'string') throw new TypeError('종목코드를 입력해 주세요.');
  const symbol = stock.symbol.trim().toUpperCase();
  const valid = stock.market === 'KR' ? /^[A-Z0-9]{6}$/ : /^[A-Z][A-Z0-9.-]{0,19}$/;
  if (!valid.test(symbol)) throw new TypeError('종목코드 형식이 올바르지 않아요.');
  const name = typeof stock.name === 'string' ? stock.name.trim() : symbol;
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new TypeError('종목명은 1~100자로 입력해 주세요.');
  const normalized = { symbol, name, market: stock.market };
  for (const key of ['purchasePrice', 'referencePrice', 'trackingPrice']) {
    if (stock[key] === undefined || stock[key] === null || stock[key] === '') continue;
    if (typeof stock[key] !== 'number' || !Number.isFinite(stock[key]) || stock[key] <= 0 || stock[key] > 1e12) {
      throw new TypeError('기준 가격은 0보다 큰 숫자로 입력해 주세요.');
    }
    normalized[key] = stock[key];
  }
  return normalized;
}

/** Validate the whole configuration or merge a partial patch into a prior one. */
export function normalizeConfig(input = {}, previous = defaultConfig()) {
  object(input, '설정');
  const permitted = new Set(['intervalMinutes', 'baseline', 'roaming', 'companionMode', 'petSize', 'speechScale', 'watchlist', 'characterId', 'autoWatchHoldings']);
  for (const key of Object.keys(input)) if (!permitted.has(key)) throw new TypeError('알 수 없는 설정 항목이에요.');
  const config = { characterId: DEFAULT_CHARACTER_ID, speechScale: 100, autoWatchHoldings: true, companionMode: false, ...previous, ...input };
  if (!isAvailableCharacter(config.characterId)) throw new TypeError('아직 함께할 수 없는 캐릭터예요. 준비된 친구를 선택해 주세요.');
  if (typeof config.intervalMinutes !== 'number' || !Number.isFinite(config.intervalMinutes) || config.intervalMinutes < 0.1 || config.intervalMinutes > 1440) {
    throw new TypeError('알림 간격은 0.1~1440분으로 입력해 주세요.');
  }
  if (!BASELINES.includes(config.baseline)) throw new TypeError('등락 기준을 다시 선택해 주세요.');
  if (typeof config.roaming !== 'boolean') throw new TypeError('돌아다니기 설정이 올바르지 않아요.');
  if (typeof config.companionMode !== 'boolean') throw new TypeError('산책 모드 설정이 올바르지 않아요.');
  if (typeof config.autoWatchHoldings !== 'boolean') throw new TypeError('보유 주식 자동 등록 설정이 올바르지 않아요.');
  if (!Number.isInteger(config.petSize) || config.petSize < PET_SIZE.min || config.petSize > PET_SIZE.max) throw new TypeError(`캐릭터 크기는 ${PET_SIZE.min}~${PET_SIZE.max}으로 설정해 주세요.`);
  if (!Number.isInteger(config.speechScale) || config.speechScale < 80 || config.speechScale > 160 || config.speechScale % 10 !== 0) throw new TypeError('말풍선 크기는 80~160%에서 10% 단위로 설정해 주세요.');
  if (!Array.isArray(config.watchlist) || config.watchlist.length > MAX_WATCHLIST) throw new TypeError('관심종목은 최대 100개까지 등록할 수 있어요.');
  config.watchlist = config.watchlist.map(normalizeStock);
  const keys = new Set(config.watchlist.map(stockKey));
  if (keys.size !== config.watchlist.length) throw new TypeError('이미 등록한 관심종목이에요.');
  return config;
}
