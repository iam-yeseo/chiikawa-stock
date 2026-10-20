import { positiveNumber } from './alert-engine.js';

export const REST_ORIGIN = 'https://openapi.tossinvest.com';
export const WS_URL = 'wss://openapi-ws.tossinvest.com/ws/v1';
const TERMINAL_CODES = new Set(['token-revoked', 'invalid-token', 'invalid_client', 'access_denied', 'ip-not-allowed', 'forbidden', 'edge-blocked']);
const SHARED_AUTH_CODES = new Set(['token-revoked', 'invalid-token', 'invalid_client', 'access_denied', 'ip-not-allowed', 'edge-blocked']);
const REQUEST_SPACING = Object.freeze({ auth: 220, accounts: 1100, assets: 220, catalog: 1100, stocks: 220, candles: 65, prices: 85 });
const PRICE_CHUNK = 20;
const MESSAGES = {
  'token-revoked': '다른 기기에서 새 토큰이 발급되어 연결을 멈췄어요. 그 기기를 확인한 뒤 다시 연결해 주세요.',
  'invalid-token': '인증 토큰을 확인할 수 없어요. API 키를 확인한 뒤 다시 연결해 주세요.',
  invalid_client: '클라이언트 ID와 시크릿을 확인해 주세요.',
  access_denied: '토스증권에서 인증을 거부했어요. API 키와 허용 IP 등록을 확인해 주세요.',
  'ip-not-allowed': '현재 공인 IP를 토스증권의 허용 IP 목록에 등록해 주세요.',
  forbidden: '시세 조회 권한을 확인해 주세요.',
  'edge-blocked': '토스증권 연결이 차단됐어요. 허용 IP와 API 설정을 확인해 주세요.',
  'stock-not-found': '시세를 제공하지 않는 종목이 있어요. 종목 검색에서 다시 선택해 주세요.',
  'expired-token': '인증 토큰이 만료됐어요. 다시 연결해 주세요.',
  'rate-limit-exceeded': '시세 요청 한도에 도달했어요. 잠시 후 다시 연결할게요.',
};

export class MarketError extends Error {
  constructor(code, status = 0, options = {}) {
    // Do not expose raw server payloads, request URLs, credentials, or token headers.
    super(MESSAGES[code] || (status === 403 ? '허용 IP와 API 이용 권한을 확인해 주세요.' : '시세 연결이 원활하지 않아요. 잠시 후 다시 시도할게요.'));
    this.name = 'MarketError';
    this.code = /^[a-zA-Z0-9_-]{1,64}$/.test(code || '') ? code : 'network-error';
    this.status = status;
    this.terminal = TERMINAL_CODES.has(code) || status === 401 || status === 403 || options.terminal === true;
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const dateFormatter = Object.fromEntries(['KR', 'US'].map(market => [market,
  new Intl.DateTimeFormat('en-CA', { timeZone: market === 'KR' ? 'Asia/Seoul' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }),
]));

/** Official US market day spans NY 20:00 on the preceding date through 20:00. */
export function marketDay(time, market, shiftSession = true) {
  const entries = Object.fromEntries(dateFormatter[market].formatToParts(new Date(time)).map(part => [part.type, part.value]));
  const value = `${entries.year}-${entries.month}-${entries.day}`;
  if (market !== 'US' || !shiftSession || Number(entries.hour) < 20) return value;
  return new Date(Date.parse(`${value}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

export function selectPreviousClose(candles, market, now = Date.now()) {
  const day = marketDay(now, market);
  return (Array.isArray(candles) ? candles : [])
    .filter(candle => Number.isFinite(Date.parse(candle.timestamp)) && marketDay(Date.parse(candle.timestamp), market, false) < day && positiveNumber(candle.closePrice) !== null)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .map(candle => positiveNumber(candle.closePrice))[0] ?? null;
}

export class TossClient {
  constructor({ credentialProvider, fetchImpl = globalThis.fetch, now = Date.now, sleepImpl = sleep }) {
    this.credentialProvider = credentialProvider;
    this.fetch = fetchImpl;
    this.now = now;
    this.sleep = sleepImpl;
    this.controller = new AbortController();
    this.token = null;
    this.expiresAt = 0;
    this.tokenPromise = null;
    this.blocked = null;
    this.lastRequest = new Map();
    this.queues = new Map();
  }

  abort() { this.controller.abort(); this.token = null; this.expiresAt = 0; }

  async getToken(force = false) {
    if (this.blocked) throw this.blocked;
    if (this.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!force && this.token && this.expiresAt - this.now() > 60_000) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const credentials = await this.credentialProvider();
      if (!credentials?.clientId || !credentials?.clientSecret) {
        const error = new MarketError('invalid_client', 401);
        error.message = '설정에서 본인의 토스증권 API 키를 먼저 저장해 주세요.';
        throw error;
      }
      const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret });
      await this._gate('auth');
      const payload = await this._fetch('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (typeof payload.access_token !== 'string' || !payload.access_token || !Number.isFinite(Number(payload.expires_in)) || Number(payload.expires_in) <= 0) throw new MarketError('invalid-token', 401);
      if (this.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      this.token = payload.access_token;
      this.expiresAt = this.now() + Number(payload.expires_in) * 1000;
      return this.token;
    })();
    try { return await this.tokenPromise; }
    finally { this.tokenPromise = null; }
  }

  async _fetch(path, init, attempt = 0, accountScoped = false) {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]);
    let response;
    try { response = await this.fetch(`${REST_ORIGIN}${path}`, { ...init, signal, redirect: 'error' }); }
    catch (error) {
      if (this.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new MarketError('network-error');
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new MarketError('invalid-response', response.status); }
    if (!response.ok) {
      const rawCode = typeof payload.error === 'string' ? payload.error : payload.error?.code;
      const code = typeof rawCode === 'string' ? rawCode : 'network-error';
      if (response.status === 429 && attempt < 2) {
        const headerSeconds = Number(response.headers.get('Retry-After'));
        const delay = Math.min(30_000, Math.max(1000 * (2 ** attempt), Number.isFinite(headerSeconds) ? headerSeconds * 1000 : 0));
        await this.sleep(delay, this.controller.signal);
        return this._fetch(path, init, attempt + 1, accountScoped);
      }
      const error = new MarketError(code, response.status);
      // A denied/missing account must not poison otherwise healthy market data.
      // Proven shared authentication failures still halt both consumers.
      if (error.terminal && code !== 'expired-token' && (!accountScoped || SHARED_AUTH_CODES.has(code) || response.status === 401)) this.blocked = error;
      throw error;
    }
    return payload;
  }

  async _gate(group) {
    const spacing = REQUEST_SPACING[group];
    const previous = this.queues.get(group) || Promise.resolve();
    const gate = previous.catch(() => {}).then(async () => {
      const remaining = spacing - (this.now() - (this.lastRequest.get(group) || 0));
      if (remaining > 0) await this.sleep(remaining, this.controller.signal);
      if (this.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      this.lastRequest.set(group, this.now());
    });
    this.queues.set(group, gate);
    await gate;
  }

  async request(path, params = {}, refreshed = false, { accountId } = {}) {
    const token = await this.getToken();
    const group = path === '/api/v1/accounts' ? 'accounts' : path === '/api/v1/holdings' ? 'assets' : path === '/api/v1/stocks/all' ? 'catalog' : path === '/api/v1/stocks' ? 'stocks' : path === '/api/v1/candles' ? 'candles' : 'prices';
    await this._gate(group);
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (accountId !== undefined) headers['X-Tossinvest-Account'] = String(accountId);
      const payload = await this._fetch(`${path}?${new URLSearchParams(params)}`, { headers }, 0, group === 'accounts' || group === 'assets');
      if (!payload || !Object.hasOwn(payload, 'result')) throw new MarketError('invalid-response');
      return payload.result;
    } catch (error) {
      if (error.code === 'expired-token' && !refreshed) {
        // Another in-flight request may already have renewed this exact token.
        // Issuing again would revoke that new token because only one may be active.
        if (this.token === token) await this.getToken(true);
        return this.request(path, params, true, { accountId });
      }
      throw error;
    }
  }

  async accounts() {
    const result = await this.request('/api/v1/accounts');
    if (!Array.isArray(result)) throw new MarketError('invalid-response');
    return result;
  }

  async holdings(accountId) {
    if (!Number.isSafeInteger(accountId) || accountId < 0) throw new TypeError('계좌를 다시 선택해 주세요.');
    const result = await this.request('/api/v1/holdings', {}, false, { accountId });
    if (!result || !Array.isArray(result.items)) throw new MarketError('invalid-response');
    return result;
  }

  async prices(stocks) {
    const items = [], unavailable = [];
    for (let index = 0; index < stocks.length; index += PRICE_CHUNK) {
      await this._pricesChunk(stocks.slice(index, index + PRICE_CHUNK), items, unavailable);
    }
    return { items, unavailable };
  }

  async _pricesChunk(stocks, items, unavailable) {
    try {
      const result = await this.request('/api/v1/prices', { symbols: stocks.map(stock => stock.symbol).join(',') });
      if (!Array.isArray(result)) throw new MarketError('invalid-response');
      items.push(...result);
    } catch (error) {
      // Only the documented unavailable-stock 404 is safe to isolate.
      // Authentication, rate limits and server failures retain their normal path.
      if (error.code !== 'stock-not-found' || error.status !== 404) throw error;
      if (stocks.length === 1) { unavailable.push(stocks[0]); return; }
      const middle = Math.ceil(stocks.length / 2);
      await this._pricesChunk(stocks.slice(0, middle), items, unavailable);
      await this._pricesChunk(stocks.slice(middle), items, unavailable);
    }
  }

  async previousClose(stock, at = this.now()) {
    const result = await this.request('/api/v1/candles', { symbol: stock.symbol, interval: '1d', count: '10', adjusted: 'true' });
    if (!Array.isArray(result?.candles)) throw new MarketError('invalid-response');
    return selectPreviousClose(result.candles, stock.market, at);
  }

  async listStocks(market) {
    const result = await this.request('/api/v1/stocks/all', { market, status: 'ACTIVE' });
    if (!Array.isArray(result)) throw new MarketError('invalid-response');
    return result;
  }
}
