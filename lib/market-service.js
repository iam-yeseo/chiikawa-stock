import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { defaultConfig, normalizeConfig, normalizeStock, STARTER_STOCKS, stockKey } from './config.js';
import { AlertEngine, baselinePrice, percentChange, positiveNumber } from './alert-engine.js';
import { TossClient, MarketError, WS_URL, marketDay } from './toss-client.js';
import { emptyPortfolio, normalizeAccounts, normalizeHoldings, mergeOwnedStocks, portfolioMessage, demoPortfolio } from './portfolio.js';

const STALE_AFTER_MS = 120_000;
const EXCHANGES = ['KOSPI', 'KOSDAQ', 'NYSE', 'NASDAQ', 'AMEX', 'KR_ETC', 'US_ETC'];
const copy = value => structuredClone(value);
const topicFor = stock => `trade:${stock.market.toLowerCase()}:${stock.symbol}`;
const quietTimer = timer => { timer.unref?.(); return timer; };

export class MarketService extends EventEmitter {
  constructor({ config = defaultConfig(), credentialProvider = async () => null, fetchImpl, WebSocketImpl = WebSocket, now = Date.now, random = Math.random, sleepImpl } = {}) {
    super();
    this.config = normalizeConfig(config);
    this.credentialProvider = credentialProvider;
    this.clientOptions = { credentialProvider, fetchImpl, now, sleepImpl };
    this.WebSocket = WebSocketImpl;
    this.now = now;
    this.random = random;
    this.mode = 'offline';
    this.connection = { state: 'idle', message: 'API를 연결하거나 데모를 시작해 주세요.', updatedAt: now() };
    this.quotes = new Map();
    this.alerts = [];
    this.engine = new AlertEngine();
    this.epoch = 0;
    this.configRevision = 0;
    this.running = false;
    this.previousCloses = new Map();
    this.demoTracking = new Map();
    this.demoBases = new Map();
    this.catalog = STARTER_STOCKS.map(stock => ({ ...stock }));
    this.catalogAt = 0;
    this.catalogPromise = null;
    this.catalogFailedAt = null;
    this.catalogExchanges = new Map();
    this.catalogStatus = { state: 'idle', completed: 0, total: EXCHANGES.length, retryAt: null, message: '' };
    this.rejected = new Set();
    this.unavailable = new Set();
    this.redeclarationFailures = 0;
    this._trackingDirty = false;
    this.reconnectAttempt = 0;
    this.demoTick = 0;
    this.portfolio = emptyPortfolio();
    this.portfolioMode = null;
    this.portfolioRevision = 0;
    this.demoAddedKeys = new Set();
  }

  getState() {
    const now = this.now();
    return copy({
      mode: this.mode, connection: this.connection, config: this.config,
      quotes: this.config.watchlist.map(stock => {
        const quote = this.quotes.get(stockKey(stock)) || this._emptyQuote(stock);
        const unavailable = this.mode === 'live' && this.unavailable.has(stockKey(stock));
        return { ...quote, unavailable, stale: unavailable || quote.stale || (this.mode === 'live' && (this.connection.state !== 'connected' || !quote.updatedAt || now - quote.updatedAt > STALE_AFTER_MS || this.rejected.has(topicFor(stock)))) };
      }),
      catalogStatus: this.catalogStatus,
      alerts: this.alerts, portfolio: { ...this.portfolio, stale: this.portfolio.stale || (this.mode === 'live' && (!this.running || !this.portfolio.updatedAt || now - this.portfolio.updatedAt > STALE_AFTER_MS)) },
    });
  }

  getPersistedConfig() {
    return copy({ ...this.config, watchlist: this.config.watchlist.filter(stock => !this.demoAddedKeys.has(stockKey(stock))) });
  }

  _emptyQuote(stock) {
    return { symbol: stock.symbol, name: stock.name, market: stock.market, currency: stock.market === 'KR' ? 'KRW' : 'USD', price: null, previousClose: null, baselinePrice: null, changePercent: null, updatedAt: null, stale: true };
  }

  _emitState() { this.emit('state', this.getState()); }

  _flushTrackingConfig() {
    if (!this._trackingDirty) return;
    this._trackingDirty = false;
    this.emit('config', this.getPersistedConfig());
  }

  _setConnection(state, message) {
    this.connection = { state, message, updatedAt: this.now() };
    this._emitState();
  }

  _clearTimers() {
    for (const key of ['pollTimer', 'portfolioTimer', 'bulletinTimer', 'demoTimer', 'staleTimer', 'reconnectTimer', 'pingTimer', 'ackTimer', 'emitTimer', 'subscriptionTimer', 'redeclareTimer']) {
      clearTimeout(this[key]); clearInterval(this[key]); this[key] = null;
    }
  }

  _closeSocket() {
    clearInterval(this.pingTimer); clearTimeout(this.ackTimer);
    clearTimeout(this.subscriptionTimer); clearTimeout(this.redeclareTimer);
    this.pingTimer = this.ackTimer = null;
    this.subscriptionTimer = this.redeclareTimer = null;
    this.redeclarationFailures = 0;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      // ws may emit an error when a connecting socket is terminated.
      socket.on('error', () => {});
      socket.terminate();
    }
  }

  stop() {
    this._flushTrackingConfig();
    this.running = false;
    this.epoch += 1;
    this._clearTimers();
    this._closeSocket();
    this.client?.abort();
    this.client = null;
    this.catalogPromise = null;
    this.refreshPromise = null;
    this.portfolioPromise = null;
    this.portfolioRevision += 1;
    this.portfolio = { ...emptyPortfolio(), selectedAccountId: this.portfolio.selectedAccountId };
    if (this.catalogStatus.state === 'loading') this.catalogStatus = { ...this.catalogStatus, state: 'partial', message: '부분 목록으로 검색 중이에요.' };
    this.config.watchlist = this.config.watchlist.filter(stock => !this.demoAddedKeys.has(stockKey(stock)));
    this.demoAddedKeys.clear();
    this.engine.reset();
    this.mode = 'offline';
    this._rebasePortfolioQuotes();
    for (const quote of this.quotes.values()) quote.stale = true;
    this._setConnection('idle', '감시가 멈춰 있어요.');
    return this.getState();
  }

  async start(mode = 'demo') {
    if (!['live', 'demo'].includes(mode)) throw new TypeError('실시간 또는 데모 모드를 선택해 주세요.');
    this.stop();
    if (this.portfolioMode !== mode) this.portfolio.selectedAccountId = null;
    this.portfolioMode = mode;
    const epoch = this.epoch;
    this.running = true;
    this.mode = mode;
    this.quotes.clear();
    this.alerts = [];
    this.previousCloses.clear();
    this.demoTracking.clear();
    this.demoBases.clear();
    this.rejected.clear();
    this.unavailable.clear();
    this.reconnectAttempt = 0;
    this.demoTick = 0;
    this._scheduleBulletin();
    if (mode === 'demo') {
      await this.refreshPortfolio();
      if (!this.running || this.mode !== mode || this.epoch !== epoch) return this.getState();
      this._setConnection('connected', '데모 · 모든 가격과 등락은 가상 데이터예요.');
      this._refreshDemo(true);
      this._emitBulletin();
      this.demoTimer = quietTimer(setInterval(() => this._refreshDemo(), 3000));
      this.portfolioTimer = quietTimer(setInterval(() => this.refreshPortfolio(), 60_000));
      return this.getState();
    }
    this.client = new TossClient(this.clientOptions);
    this._setConnection('connecting', '토스증권에서 현재가와 전일 종가를 확인하고 있어요.');
    this.staleTimer = quietTimer(setInterval(() => this._emitState(), 15_000));
    this.pollTimer = quietTimer(setInterval(() => this.refresh(), 60_000));
    this.portfolioTimer = quietTimer(setInterval(() => this.refreshPortfolio(), 60_000));
    try {
      await this.refreshPortfolio();
      if (!this._active(epoch)) return this.getState();
      await this._refreshLive(true, epoch);
      if (!this._active(epoch)) return this.getState();
      await this._openSocket(epoch);
    } catch (error) { if (this._active(epoch)) this._handleFailure(error); }
    return this.getState();
  }

  _active(epoch) { return this.running && this.mode === 'live' && this.epoch === epoch; }

  _scheduleBulletin() {
    clearInterval(this.bulletinTimer);
    this.bulletinTimer = quietTimer(setInterval(() => {
      this._emitBulletin();
    }, this.config.intervalMinutes * 60_000));
  }

  _emitBulletin() {
    if (!this.running) return;
    const quotes = this.getState().quotes.filter(quote => quote.price !== null);
    const owned = new Set((this.portfolio.holdings?.items || []).filter(item => item.quantity > 0).map(stockKey));
    quotes.sort((a, b) => Number(owned.has(stockKey(b))) - Number(owned.has(stockKey(a))));
    if (quotes.length) this.emit('bulletin', { quotes, at: this.now() });
  }

  async refreshPortfolio() {
    if (!this.running || this.mode === 'offline') return this.getState();
    if (this.portfolioPromise) return this.portfolioPromise;
    const epoch = this.epoch, revision = this.portfolioRevision, mode = this.mode, client = this.client;
    const current = () => this.running && this.epoch === epoch && this.mode === mode && this.portfolioRevision === revision;
    const task = (async () => {
      this.portfolio = { ...this.portfolio, status: 'loading', message: '계좌와 보유 주식을 확인하고 있어요.' };
      this._emitState();
      try {
        if (mode === 'demo') this.portfolio = demoPortfolio(this.portfolio.selectedAccountId ?? 1, this.now());
        else {
          const accounts = normalizeAccounts(await client.accounts());
          if (!current()) return this.getState();
          const selectedAccountId = accounts.some(account => account.id === this.portfolio.selectedAccountId) ? this.portfolio.selectedAccountId : accounts[0]?.id ?? null;
          if (selectedAccountId !== this.portfolio.selectedAccountId) {
            this.portfolio = { ...emptyPortfolio(), status: 'loading', accounts, selectedAccountId };
            this._rebasePortfolioQuotes();
            this._emitState();
          }
          else this.portfolio.accounts = accounts;
          const holdings = selectedAccountId === null ? null : normalizeHoldings(await client.holdings(selectedAccountId));
          if (!current()) return this.getState();
          this.portfolio = { ...this.portfolio, status: 'ready', accounts, selectedAccountId, holdings, updatedAt: this.now(), stale: false };
        }
        if (!current()) return this.getState();
        this._rebasePortfolioQuotes();
        const merged = mergeOwnedStocks(this.config.watchlist, this.portfolio.holdings, this.config.autoWatchHoldings);
        this.portfolio.omittedWatchCount = merged.omittedCount;
        if (merged.added.length) await this.updateConfig({});
        if (!current()) return this.getState();
        this.portfolio.message = portfolioMessage(this.portfolio, mode === 'demo');
        this._emitState();
      } catch (error) {
        if (!current() || error?.name === 'AbortError') return this.getState();
        this.portfolio = { ...this.portfolio, status: 'error', stale: true,
          message: error?.status === 429 ? '계좌 조회 요청 한도에 도달했어요. 잠시 후 다시 조회해 주세요.' : '계좌·자산을 조회하지 못했어요. 잠시 후 새로고침해 주세요.' };
        // Only actual shared authentication failure can take down live quotes.
        if (client?.blocked) this._handleFailure(client.blocked);
        this._emitState();
      }
      return this.getState();
    })();
    this.portfolioPromise = task;
    try { return await task; }
    finally { if (this.portfolioPromise === task) this.portfolioPromise = null; }
  }

  async selectAccount(id) {
    if (!Number.isSafeInteger(id) || !this.portfolio.accounts.some(account => account.id === id)) throw new TypeError('조회할 수 있는 계좌를 선택해 주세요.');
    if (this.portfolio.selectedAccountId === id) return this.refreshPortfolio();
    this.portfolioRevision += 1;
    this.portfolioPromise = null;
    this.portfolio = { ...emptyPortfolio(), accounts: this.portfolio.accounts, selectedAccountId: id };
    this._rebasePortfolioQuotes();
    this._emitState();
    return this.refreshPortfolio();
  }

  _rebasePortfolioQuotes() {
    if (this.config.baseline !== 'purchase') return;
    for (const stock of this.config.watchlist) {
      const quote = this.quotes.get(stockKey(stock));
      if (!quote) continue;
      if (!this.running) {
        // Clearing account-derived percentages on stop must not turn demo
        // prices into persisted live tracking baselines or rearm alerts.
        const baseline = baselinePrice(stock, 'purchase', quote.previousClose);
        this.quotes.set(stockKey(stock), { ...quote, baselinePrice: baseline, changePercent: percentChange(quote.price, baseline) });
      } else this._apply(stock, quote.price, quote.previousClose, quote.updatedAt, { initialize: true });
    }
    this._flushTrackingConfig();
  }

  _previousClose(stock) {
    const item = this.previousCloses.get(stockKey(stock));
    return item?.day === marketDay(this.now(), stock.market) ? item.price : null;
  }

  _apply(stock, price, previousClose, updatedAt, { initialize = false } = {}) {
    const key = stockKey(stock);
    const prior = this.quotes.get(key);
    // REST reconciliation can arrive after a more recent streamed tick.
    if (prior?.updatedAt && updatedAt && updatedAt < prior.updatedAt) return;
    const stale = !updatedAt || this.now() - updatedAt > STALE_AFTER_MS || updatedAt > this.now() + 60_000;
    let referenceStock = stock;
    if (this.config.baseline === 'purchase' && !positiveNumber(stock.purchasePrice)) {
      const owned = this.portfolio.holdings?.items.find(item => item.quantity > 0 && stockKey(item) === key);
      if (owned) referenceStock = { ...stock, purchasePrice: owned.purchasePrice };
    }
    if (price !== null && !stale) {
      if (this.mode === 'demo') {
        if (!this.demoTracking.has(key)) this.demoTracking.set(key, price);
        referenceStock = { ...referenceStock, trackingPrice: this.demoTracking.get(key) };
      } else if (!positiveNumber(stock.trackingPrice)) {
        stock.trackingPrice = price;
        this._trackingDirty = true;
      }
    }
    const baseline = baselinePrice(referenceStock, this.config.baseline, previousClose);
    const quote = {
      symbol: stock.symbol, name: stock.name, market: stock.market,
      currency: stock.market === 'KR' ? 'KRW' : 'USD', price, previousClose,
      baselinePrice: baseline, changePercent: percentChange(price, baseline), updatedAt, stale,
    };
    this.quotes.set(key, quote);
    const day = this.config.baseline === 'previousClose' ? marketDay(this.now(), stock.market) : '';
    const alert = this.engine.ingest(quote, `${this.config.baseline}:${baseline}:${day}`, { initialize });
    if (alert) {
      this.alerts.unshift(alert);
      this.alerts = this.alerts.slice(0, 100);
      this.emit('alert', copy(alert));
    }
  }

  _refreshDemo(initialize = false) {
    if (!this.running || this.mode !== 'demo') return;
    this.config.watchlist.forEach((stock, index) => {
      const seed = stock.market === 'KR' ? 25_000 + index * 7300 : 80 + index * 16;
      const supplied = this.config.baseline === 'purchase' ? stock.purchasePrice : this.config.baseline === 'custom' ? stock.referencePrice : null;
      const key = stockKey(stock);
      if (!this.demoBases.has(key)) this.demoBases.set(key, positiveNumber(supplied) ?? seed);
      const base = this.demoBases.get(key);
      const percent = Math.sin(this.demoTick * 0.13 + index * 0.9) * (index % 4 === 0 ? 12 : 4.8);
      const precision = stock.market === 'KR' ? 1 : 100;
      const price = Math.round(base * (1 + percent / 100) * precision) / precision;
      this._apply(stock, price, base, this.now(), { initialize });
    });
    this.demoTick += 1;
    this._flushTrackingConfig();
    this._emitState();
  }

  async _refreshLive(initialize = false, epoch = this.epoch, { flushTracking = true } = {}) {
    const client = this.client;
    const stocks = this.config.watchlist;
    const revision = this.configRevision;
    if (!client || !this._active(epoch)) return;
    if (!stocks.length) { this._emitState(); return; }
    const response = await client.prices(stocks.filter(stock => !this.unavailable.has(stockKey(stock))));
    if (!this._active(epoch) || revision !== this.configRevision) return;
    for (const stock of response.unavailable) this.unavailable.add(stockKey(stock));
    // The API does not expose previousClose in /prices. Official daily candle closes
    // are regular-session closes in the US; adjusted=true handles supported actions.
    const missing = stocks.filter(stock => {
      if (this.unavailable.has(stockKey(stock))) return false;
      const cached = this.previousCloses.get(stockKey(stock));
      return !cached || cached.price === null || cached.day !== marketDay(this.now(), stock.market);
    });
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
      while (next < missing.length && this._active(epoch)) {
        const stock = missing[next++];
        const day = marketDay(this.now(), stock.market);
        try {
          const price = await client.previousClose(stock, this.now());
          if (this._active(epoch)) this.previousCloses.set(stockKey(stock), { day, price });
        } catch (error) {
          if (error.terminal) throw error;
          // Price remains usable; a missing baseline never becomes a fabricated 0%.
        }
      }
    }));
    if (!this._active(epoch) || revision !== this.configRevision) return;
    const bySymbol = new Map(response.items.filter(item => item && typeof item.symbol === 'string').map(item => [item.symbol.toUpperCase(), item]));
    for (const stock of stocks) {
      const item = bySymbol.get(stock.symbol);
      const expectedCurrency = stock.market === 'KR' ? 'KRW' : 'USD';
      if (this.unavailable.has(stockKey(stock)) || !item || item.currency !== expectedCurrency || positiveNumber(item.lastPrice) === null) {
        this.quotes.set(stockKey(stock), this._emptyQuote(stock));
        this.engine.reset(stockKey(stock));
        continue;
      }
      const timestamp = typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : NaN;
      this._apply(stock, positiveNumber(item.lastPrice), this._previousClose(stock), Number.isFinite(timestamp) ? timestamp : null, { initialize });
    }
    if (flushTracking) this._flushTrackingConfig();
    if (this.connection.state === 'connected') this.connection = { ...this.connection, message: this._connectedMessage() };
    this._emitState();
  }

  async refresh() {
    if (!this.running) return this.getState();
    if (this.mode === 'demo') { this._refreshDemo(); return this.getState(); }
    if (this.refreshPromise) return this.refreshPromise;
    const epoch = this.epoch;
    const task = (async () => {
      try { await this._refreshLive(this.connection.state !== 'connected', epoch); }
      catch (error) { if (this._active(epoch)) this._handleFailure(error); }
      return this.getState();
    })();
    this.refreshPromise = task;
    try { return await task; }
    finally { if (this.refreshPromise === task) this.refreshPromise = null; }
  }

  _subscription() {
    return ['KR', 'US'].map(market => ({ type: `trade:${market.toLowerCase()}`, codes: this.config.watchlist.filter(stock => stock.market === market && !this.rejected.has(topicFor(stock)) && !this.unavailable.has(stockKey(stock))).map(stock => stock.symbol) })).filter(group => group.codes.length);
  }

  _connectedMessage() {
    const excluded = this.config.watchlist.filter(stock => this.rejected.has(topicFor(stock)) || this.unavailable.has(stockKey(stock)));
    if (!excluded.length) return '실시간 연결됨 · 국내·미국 시간외 체결도 받고 있어요.';
    const names = excluded.slice(0, 3).map(stock => stock.name).join(', ');
    return `연결됨 · ${names}${excluded.length > 3 ? ` 외 ${excluded.length - 3}개` : ''}: ${excluded.length}개 종목의 시세 또는 실시간 구독을 제공하지 않아요. 종목을 확인해 주세요.`;
  }

  _scheduleSubscription() {
    clearTimeout(this.subscriptionTimer);
    // A scheduled rate-limit recovery will send the latest complete declaration.
    if (this.redeclareTimer) return;
    const socket = this.socket, epoch = this.epoch;
    this.subscriptionTimer = quietTimer(setTimeout(() => {
      this.subscriptionTimer = null;
      if (!this._active(epoch) || this.socket !== socket || socket?.readyState !== 1) return;
      try { socket.send(JSON.stringify(this._subscription())); }
      catch { this._handleFailure(new MarketError('network-error')); }
    }, 300));
  }

  async _openSocket(epoch) {
    const token = await this.client.getToken();
    if (!this._active(epoch)) return;
    this._closeSocket();
    const socket = new this.WebSocket(WS_URL, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 15_000, maxPayload: 1_048_576 });
    this.socket = socket;
    this.lastPongAt = this.now();
    const current = () => this._active(epoch) && this.socket === socket;
    socket.on('open', () => {
      if (!current()) return;
      socket.send(JSON.stringify(this._subscription()));
      this.ackTimer = quietTimer(setTimeout(() => {
        if (current() && this.connection.state !== 'connected') this._handleFailure(new MarketError('subscription-timeout'));
      }, 15_000));
      this.pingTimer = quietTimer(setInterval(() => {
        if (!current()) return;
        if (this.now() - this.lastPongAt > 150_000) return this._handleFailure(new MarketError('heartbeat-timeout'));
        if (this.now() - this.connectedAt >= 60_000) this.reconnectAttempt = 0;
        if (socket.readyState === 1) socket.send('PING');
      }, 60_000));
    });
    socket.on('message', data => {
      if (!current()) return;
      let frame;
      try { frame = JSON.parse(data.toString()); } catch { return; }
      if (frame.type === 'pong') { this.lastPongAt = this.now(); return; }
      if (frame.type === 'subscriptions') {
        clearTimeout(this.ackTimer);
        if (!Array.isArray(frame.subscribed) || !Array.isArray(frame.rejected)) return this._handleFailure(new MarketError('invalid-response'));
        clearTimeout(this.redeclareTimer); this.redeclareTimer = null;
        this.redeclarationFailures = 0;
        for (const rejected of frame.rejected) if (typeof rejected.target === 'string') this.rejected.add(rejected.target);
        this.connectedAt = this.now();
        this._setConnection('connected', this._connectedMessage());
        this._emitBulletin();
        return;
      }
      if (frame.type === 'error') {
        const code = frame.error?.code;
        if (code === 'rate-limit-exceeded') {
          if (++this.redeclarationFailures > 3) return this._handleFailure(new MarketError(code));
          clearTimeout(this.subscriptionTimer); this.subscriptionTimer = null;
          clearTimeout(this.redeclareTimer);
          this.redeclareTimer = quietTimer(setTimeout(() => {
            this.redeclareTimer = null;
            if (!current() || socket.readyState !== 1) return;
            try { socket.send(JSON.stringify(this._subscription())); }
            catch { this._handleFailure(new MarketError('network-error')); }
          }, 1000));
          return;
        }
        const terminal = ['wrong-format', 'no-type', 'invalid-type', 'no-codes', 'too-many-topics', 'too-many'].includes(code);
        return this._handleFailure(new MarketError(code, 0, { terminal }));
      }
      if (frame.type !== 'message' || this.connection.state !== 'connected' || typeof frame.topic !== 'string') return;
      const stock = this.config.watchlist.find(item => topicFor(item) === frame.topic);
      if (!stock || this.rejected.has(frame.topic) || this.unavailable.has(stockKey(stock))) return;
      const dataQuote = frame.data;
      const currency = stock.market === 'KR' ? 'KRW' : 'USD';
      if (dataQuote?.currency !== currency || positiveNumber(dataQuote?.price) === null) return;
      const timestamp = typeof dataQuote.timestamp === 'string' ? Date.parse(dataQuote.timestamp) : NaN;
      if (!Number.isFinite(timestamp)) return;
      this._apply(stock, positiveNumber(dataQuote.price), this._previousClose(stock), timestamp);
      // Every trade is evaluated; rendering snapshots are coalesced to avoid UI pressure.
      if (!this.emitTimer) this.emitTimer = quietTimer(setTimeout(() => { this.emitTimer = null; if (current()) { this._flushTrackingConfig(); this._emitState(); } }, 120));
    });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      if (!current()) return;
      const code = response.statusCode === 403 ? 'ip-not-allowed' : response.statusCode === 401 ? 'invalid-token' : 'network-error';
      this._handleFailure(new MarketError(code, response.statusCode));
    });
    socket.on('error', () => { if (current()) this._handleFailure(new MarketError('network-error')); });
    socket.on('close', () => { if (current()) this._handleFailure(new MarketError('disconnected')); });
  }

  _handleFailure(error) {
    if (!this.running || this.mode !== 'live' || error?.name === 'AbortError') return;
    this._closeSocket();
    this.engine.reset();
    const safe = error instanceof MarketError ? error : new MarketError('network-error');
    this._setConnection('error', safe.message);
    if (safe.terminal) {
      this.running = false;
      this._clearTimers();
      this.client?.abort();
      this.emit('halt', { code: safe.code });
      return;
    }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || !this.running) return;
    if (this.reconnectAttempt >= 8) {
      this.running = false;
      this._clearTimers();
      this._setConnection('error', '연결을 여러 번 시도했지만 응답이 없어요. 네트워크를 확인한 뒤 다시 연결해 주세요.');
      this.emit('halt', { code: 'retry-exhausted' });
      return;
    }
    const delay = Math.min(60_000, 1000 * (2 ** this.reconnectAttempt++)) + Math.round(this.random() * 500);
    const epoch = this.epoch;
    this.reconnectTimer = quietTimer(setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this._active(epoch)) return;
      this._setConnection('connecting', '연결을 복구하고 최신 시세를 다시 확인하고 있어요.');
      try {
        await this._refreshLive(true, epoch);
        if (this._active(epoch)) await this._openSocket(epoch);
      } catch (error) { if (this._active(epoch)) this._handleFailure(error); }
    }, delay));
  }

  async updateConfig(patch) {
    const next = normalizeConfig(patch, this.config);
    const merged = mergeOwnedStocks(next.watchlist, this.portfolio.holdings, next.autoWatchHoldings);
    next.watchlist = merged.watchlist;
    this.portfolio.omittedWatchCount = merged.omittedCount;
    if (this.mode === 'demo') for (const key of merged.added) this.demoAddedKeys.add(key);
    if (this.portfolio.status === 'ready') this.portfolio.message = portfolioMessage(this.portfolio, this.mode === 'demo');
    const marketChanged = JSON.stringify(next.watchlist) !== JSON.stringify(this.config.watchlist) || next.baseline !== this.config.baseline;
    const bulletinChanged = marketChanged || next.intervalMinutes !== this.config.intervalMinutes;
    this.config = next;
    if (marketChanged) this.configRevision += 1;
    const revision = this.configRevision;
    const epoch = this.epoch;
    // Appearance changes keep the user's next scheduled price bulletin on time.
    if (bulletinChanged) this._scheduleBulletin();
    if (marketChanged) {
      this.engine.reset();
      this.rejected.clear();
      this.unavailable.clear();
      const valid = new Set(next.watchlist.map(stockKey));
      for (const key of this.quotes.keys()) if (!valid.has(key)) this.quotes.delete(key);
      for (const key of this.demoTracking.keys()) if (!valid.has(key)) { this.demoTracking.delete(key); this.demoBases.delete(key); }
      if (this.mode === 'demo' && this.running) this._refreshDemo(true);
      else {
        for (const stock of next.watchlist) {
          const quote = this.quotes.get(stockKey(stock));
          if (quote) this._apply(stock, quote.price, this._previousClose(stock), quote.updatedAt, { initialize: true });
        }
        if (this.mode === 'live' && this.running) {
          try {
            await this._refreshLive(true, epoch, { flushTracking: false });
            if (this._active(epoch) && revision === this.configRevision && this.socket?.readyState === 1) this._scheduleSubscription();
          } catch (error) { if (this._active(epoch) && revision === this.configRevision) this._handleFailure(error); }
        }
      }
    }
    this._trackingDirty = false;
    this.emit('config', this.getPersistedConfig());
    this._emitState();
    return this.getState();
  }

  async searchStocks(query) {
    if (typeof query !== 'string' || query.length > 100) throw new TypeError('검색어는 100자 이내로 입력해 주세요.');
    const search = query.trim().toLocaleLowerCase('ko-KR');
    if (!search) return [];
    const coolingDown = this.catalogFailedAt !== null && this.now() - this.catalogFailedAt < 60_000;
    if (this.mode === 'live' && this.client && (!this.catalogAt || this.now() - this.catalogAt > 86400000) && !coolingDown) {
      if (!this.catalogPromise) {
        const epoch = this.epoch;
        const client = this.client;
        if (this.catalogExchanges.size === EXCHANGES.length) this.catalogExchanges.clear();
        const current = () => this._active(epoch) && this.client === client;
        this.catalogPromise = (async () => {
          this.catalogStatus = { state: 'loading', completed: this.catalogExchanges.size, total: EXCHANGES.length, retryAt: null, message: '종목 목록을 불러오고 있어요. 처음에는 몇 초 걸려요.' };
          this._emitState();
          try {
            for (const exchange of EXCHANGES) {
              if (this.catalogExchanges.has(exchange)) continue;
              const market = ['KOSPI', 'KOSDAQ', 'KR_ETC'].includes(exchange) ? 'KR' : 'US';
              const rows = await client.listStocks(exchange);
              if (!current()) return;
              const stocks = [];
              for (const row of rows) {
                try { stocks.push(normalizeStock({ symbol: row.symbol, name: row.name, market })); }
                catch { /* Ignore incompatible records, never reflect raw remote text as HTML. */ }
              }
              this.catalogExchanges.set(exchange, stocks);
              const catalog = new Map(this.catalog.map(stock => [stockKey(stock), stock]));
              for (const stock of stocks) catalog.set(stockKey(stock), stock);
              this.catalog = [...catalog.values()];
              this.catalogStatus = { ...this.catalogStatus, completed: this.catalogExchanges.size };
              this._emitState();
            }
            if (!current()) return;
            // Full success replaces stale entries; partial success keeps known results.
            this.catalog = [...new Map([...this.catalogExchanges.values()].flat().map(stock => [stockKey(stock), stock])).values()];
            this.catalogAt = this.now();
            this.catalogFailedAt = null;
            this.catalogStatus = { state: 'ready', completed: EXCHANGES.length, total: EXCHANGES.length, retryAt: null, message: '' };
          } catch (error) {
            if (!current() || error?.name === 'AbortError') return;
            this.catalogFailedAt = this.now();
            this.catalogStatus = { state: 'partial', completed: this.catalogExchanges.size, total: EXCHANGES.length, retryAt: this.catalogFailedAt + 60_000, message: '부분 목록으로 검색 중이에요. 잠시 후 나머지 종목을 다시 불러올게요.' };
            if (error.terminal) { this._handleFailure(error); throw error; }
          } finally {
            if (current()) this._emitState();
          }
        })();
      }
      const promise = this.catalogPromise;
      try { await promise; }
      finally { if (this.catalogPromise === promise) this.catalogPromise = null; }
    }
    return copy(this.catalog.filter(stock => stock.symbol.toLowerCase().includes(search) || stock.name.toLocaleLowerCase('ko-KR').includes(search)).sort((a, b) => (a.symbol.toLowerCase() === search ? -1 : b.symbol.toLowerCase() === search ? 1 : a.name.localeCompare(b.name, 'ko-KR'))).slice(0, 50));
  }
}
