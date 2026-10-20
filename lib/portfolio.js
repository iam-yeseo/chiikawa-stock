import { MAX_WATCHLIST, normalizeStock, stockKey } from './config.js';

// Decimal fields arrive as strings; null/empty/invalid is never coerced to zero.
export function assetNumber(value) {
  if (typeof value !== 'string' || value.length > 30 || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
const rate = value => { const number = assetNumber(value); return number === null ? null : Math.round(number * 1e10) / 1e8; };
const money = value => ({ krw: assetNumber(value?.krw), usd: assetNumber(value?.usd) });

export function emptyPortfolio() {
  return { status: 'idle', message: 'API를 연결하면 내 계좌와 보유 주식을 확인할 수 있어요.', accounts: [], selectedAccountId: null, holdings: null, updatedAt: null, stale: true, omittedWatchCount: 0 };
}

export function normalizeAccounts(rows) {
  if (!Array.isArray(rows)) throw new TypeError('계좌 목록 형식이 올바르지 않아요.');
  const accounts = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.accountSeq) || row.accountSeq < 0 || typeof row.accountNo !== 'string') continue;
    const suffix = row.accountNo.replace(/\D/g, '').slice(-4);
    const kind = row.accountType === 'BROKERAGE' ? '종합매매' : '계좌';
    accounts.set(row.accountSeq, { id: row.accountSeq, label: `${kind} · ****${suffix}` });
  }
  return [...accounts.values()];
}

export function normalizeHoldings(raw) {
  if (!raw || !Array.isArray(raw.items)) throw new TypeError('보유 주식 형식이 올바르지 않아요.');
  const items = [], keys = new Set();
  let unsupportedCount = 0;
  for (const row of raw.items) {
    let stock;
    try { stock = normalizeStock({ symbol: row?.symbol, name: row?.name, market: row?.marketCountry }); }
    catch { unsupportedCount++; continue; }
    const quantity = assetNumber(row.quantity);
    if (quantity === null || quantity < 0 || row.currency !== (stock.market === 'KR' ? 'KRW' : 'USD') || keys.has(stockKey(stock))) { unsupportedCount++; continue; }
    keys.add(stockKey(stock));
    items.push({ ...stock, currency: row.currency, quantity,
      price: assetNumber(row.lastPrice), purchasePrice: assetNumber(row.averagePurchasePrice),
      purchaseAmount: assetNumber(row.marketValue?.purchaseAmount), marketValue: assetNumber(row.marketValue?.amount), marketValueAfterCost: assetNumber(row.marketValue?.amountAfterCost),
      profitLoss: assetNumber(row.profitLoss?.amount), profitLossAfterCost: assetNumber(row.profitLoss?.amountAfterCost), profitLossPercent: rate(row.profitLoss?.rate), profitLossAfterCostPercent: rate(row.profitLoss?.rateAfterCost),
      dailyProfitLoss: assetNumber(row.dailyProfitLoss?.amount), dailyChangePercent: rate(row.dailyProfitLoss?.rate), commission: assetNumber(row.cost?.commission), tax: assetNumber(row.cost?.tax),
    });
  }
  return { purchaseAmount: money(raw.totalPurchaseAmount), marketValue: money(raw.marketValue?.amount), marketValueAfterCost: money(raw.marketValue?.amountAfterCost),
    profitLoss: money(raw.profitLoss?.amount), profitLossAfterCost: money(raw.profitLoss?.amountAfterCost), profitLossPercent: rate(raw.profitLoss?.rate), profitLossAfterCostPercent: rate(raw.profitLoss?.rateAfterCost),
    dailyProfitLoss: money(raw.dailyProfitLoss?.amount), dailyChangePercent: rate(raw.dailyProfitLoss?.rate), items, unsupportedCount };
}

export function mergeOwnedStocks(watchlist, holdings, enabled = true) {
  const next = [...watchlist], keys = new Set(next.map(stockKey)), added = [];
  let omittedCount = 0;
  if (enabled) for (const row of holdings?.items || []) {
    if (!(row.quantity > 0) || keys.has(stockKey(row))) continue;
    if (next.length >= MAX_WATCHLIST) { omittedCount++; continue; }
    const stock = normalizeStock({ symbol: row.symbol, name: row.name, market: row.market });
    keys.add(stockKey(stock)); next.push(stock); added.push(stockKey(stock));
  }
  return { watchlist: next, added, omittedCount };
}

export function portfolioMessage(portfolio, demo = false) {
  const prefix = demo ? '데모 · 가상 계좌예요. ' : '';
  if (!portfolio.accounts.length) return `${prefix}조회할 수 있는 계좌가 없어요.`;
  if (!portfolio.holdings?.items.some(item => item.quantity > 0)) return `${prefix}이 계좌에는 보유 주식이 없어요.`;
  const omitted = portfolio.omittedWatchCount ? ` 관심 주식 100개 한도로 보유 종목 ${portfolio.omittedWatchCount}개를 등록하지 못했어요. 관심 주식을 정리해 주세요.` : '';
  const unsupported = portfolio.holdings.unsupportedCount ? ` 표시할 수 없는 종목 ${portfolio.holdings.unsupportedCount}개가 있어요.` : '';
  return `${prefix}보유 주식 자산을 1분마다 확인해요.${omitted}${unsupported}`;
}

// Public, synthetic fixtures only. Never derived from a user's account or keys.
export function demoPortfolio(accountId = 1, now = Date.now()) {
  const rows = [
    { symbol: '005930', name: '삼성전자', marketCountry: 'KR', currency: 'KRW', quantity: '10', lastPrice: '72000', averagePurchasePrice: '65000', marketValue: { purchaseAmount: '650000', amount: '720000', amountAfterCost: '718000' }, profitLoss: { amount: '70000', amountAfterCost: '68000', rate: '0.10769231', rateAfterCost: '0.10461538' }, dailyProfitLoss: { amount: '10000', rate: '0.01408451' }, cost: { commission: '500', tax: '1500' } },
    { symbol: 'AAPL', name: '애플', marketCountry: 'US', currency: 'USD', quantity: '2.5', lastPrice: '178.5', averagePurchasePrice: '155.3', marketValue: { purchaseAmount: '388.25', amount: '446.25', amountAfterCost: '444.25' }, profitLoss: { amount: '58', amountAfterCost: '56', rate: '0.14938828', rateAfterCost: '0.14423696' }, dailyProfitLoss: { amount: '6.25', rate: '0.01420455' }, cost: { commission: '2', tax: null } },
  ];
  const empty = accountId === 2;
  const holdings = normalizeHoldings({ totalPurchaseAmount: { krw: empty ? '0' : '650000', usd: empty ? null : '388.25' }, marketValue: { amount: { krw: empty ? '0' : '720000', usd: empty ? null : '446.25' }, amountAfterCost: { krw: empty ? '0' : '718000', usd: empty ? null : '444.25' } }, profitLoss: { amount: { krw: empty ? '0' : '70000', usd: empty ? null : '58' }, amountAfterCost: { krw: empty ? '0' : '68000', usd: empty ? null : '56' }, rate: empty ? '0' : '0.1262', rateAfterCost: empty ? '0' : '0.1224' }, dailyProfitLoss: { amount: { krw: empty ? '0' : '10000', usd: empty ? null : '6.25' }, rate: empty ? '0' : '0.0141' }, items: empty ? [] : rows });
  return { ...emptyPortfolio(), status: 'ready', accounts: [{ id: 1, label: '데모 계좌 · ****1234' }, { id: 2, label: '데모 빈 계좌 · ****5678' }], selectedAccountId: accountId, holdings, updatedAt: now, stale: false };
}
