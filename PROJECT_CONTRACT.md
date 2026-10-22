# 먼작주 implementation contract

Independent Electron application for Windows and macOS. Korean UI. Read-only quote monitoring and account/stock-asset lookup; no orders. Renderer uses Vite vanilla JavaScript ES modules. Node ESM main process. Original char/ files are read-only references.

## Release completion and retention

Follow `AGENTS.md` after every update: finish validation and release, upload the final source backup to the user's designated Google Drive folder and verify the downloaded bytes, then remove obsolete local installers and task-specific temporary files. Retain the latest packages and running app, source/Git history, original images/fonts, production assets, unique verification records, and user settings/credentials. Do not delete cloud backups or historical GitHub releases as part of local cleanup.

## Ownership
- Root: package.json, Vite/build configuration, electron/, scripts/, integration and packaging.
- market agent: lib/ (service, defaults, validation, alert engine), tests/market*.test.js.
- dashboard agent: index.html, src/dashboard.js, src/dashboard.css, src/bridge.js (browser demo adapter).
- pet agent: pet.html, src/pet.js, src/pet.css, src/character.js and assets/character/; generated assets and motion provenance.

## Bridge: window.chii
- getState() -> Promise<Snapshot>
- onState(callback) -> unsubscribe function
- updateConfig(patch) -> Promise<Snapshot>
- setCredentials({clientId,clientSecret}) -> Promise<Snapshot>; never returns secrets
- clearCredentials() -> Promise<Snapshot>
- connect() -> Promise<Snapshot>; activates live monitoring
- demo() -> Promise<Snapshot>; explicitly simulated data
- refreshPortfolio() -> Promise<Snapshot>; read-only refresh of accounts and selected holdings
- selectAccount(id) -> Promise<Snapshot>; validate against fetched account IDs
- searchStocks(query) -> Promise<Array<{symbol,name,market}>>
- previewMotion(action) -> void; action idle, walk, happy, cry, sleep, talk
- onMotion(callback) -> unsubscribe; callback({action,alert?})
- setInteractive(boolean) -> void; pet overlay click-through toggle
- showSettings() -> void
- hidePet() -> void (can restore from tray)
- quit() -> void

## Snapshot
{mode:'demo'|'live'|'offline', connection:{state:'idle'|'connecting'|'connected'|'error',message,updatedAt}, config, quotes:[], alerts:[], credentialsConfigured:boolean, version:'0.5.2'}

Config: {intervalMinutes:5, baseline:'previousClose'|'purchase'|'custom'|'tracking', roaming:true, companionMode:false, petSize:150, speechScale:100, autoWatchHoldings:true, characterId:'chiikawa', watchlist:[{symbol,name,market:'KR'|'US',purchasePrice?:number,referencePrice?:number,trackingPrice?:number}]}. lib/characters.js is the shared catalog and motion profile registry. Planned characters cannot be selected until available. Missing legacy characterId defaults to chiikawa without resetting other preferences.

Quote: {symbol,name,market:'KR'|'US',currency:'KRW'|'USD',price,previousClose,changePercent,baselinePrice,updatedAt,stale:boolean}. Missing prices are null, never made-up. updatedAt epoch milliseconds. Alert: {id,symbol,name,price,percent,level,direction:'up'|'down',at}.

## Market service (lib/market-service.js)
Export MarketService extends EventEmitter. Constructor({config,credentialProvider}) where credentialProvider is async () => ({clientId,clientSecret}|null). Methods getState(), async start(mode='demo'), stop(), async updateConfig(patch), async searchStocks(query), async refresh(). Emits state(snapshot), alert(alert), bulletin({quotes,at}), config(config) if tracking baseline set. Root enriches snapshot with credentialsConfigured/version. Export defaultConfig(), normalizeConfig() from lib/config.js. No secrets in snapshots/logs. Network is main process only. REST initial snapshot + websocket trades; reconnect bounded, token-revoked never retry issuance loop, data freshness explicit. Baseline tracking persists through config event. REST prices authoritative initial + reconcile reconnect. All request parsing based on official API schemas.

## Character module
src/character.js exports mountCharacter(container,{characterId='chiikawa',size=150,action='idle'}={}) -> {setCharacter(id),setAction(action,options?),setSize(px),destroy()}. Can be used in settings preview and independent pet. Assets use Vite imports/URL handling. Real transparent raster art from supplied reference. No emoji/SVG stand-in for character. Smooth locomotion separate from expression frame animation. Parent controls position. Pet renderer uses bridge snapshots, onMotion and itself handles 5-minute speech tick only if no separate bulletin bridge. Threshold alerts come via onMotion({action:'happy'|'cry',alert}). Dashboard fallback bridge is browser demo only with explicit simulated labels.

## Behavior
Default watchlist KR10/US10, user search/edit. n=5 minutes configurable. +/- 5,10,15,20,25,30 threshold entering triggers, falling below then reentering triggers again. Large jumps show highest reached tier once. Live startup/reconnect uses first price to initialize, no fake historical crossing. PreviousClose is default; purchase/custom/tracking optional. Around-the-clock monitoring while device awake; no audio. Pet free roaming and always on top, no app dependency. Keys encrypted via OS safeStorage in local userData, never bundled. All inputs validated at main boundary. Original reference images unchanged.

## Portfolio (0.3.0)

Snapshot adds `portfolio:{status,message,accounts:[{id,label}],selectedAccountId,holdings,updatedAt,stale,omittedWatchCount}`. Account labels are masked; full account numbers never reach renderer snapshots. Holdings summary carries separate `{krw,usd}` amounts for purchase, market value, costs, total and daily P&L. API decimal ratio rates are normalized once to percentage numbers; missing values stay null. Item fields include symbol/name/market/currency/quantity/price/purchasePrice/marketValue/profitLoss/dailyChangePercent. See `lib/portfolio.js` for the exact mapping.

Live account and holdings requests share the quote client's existing token and use only GET `/api/v1/accounts` and GET `/api/v1/holdings` with `X-Tossinvest-Account`. Refresh on connection and every60seconds; manual refresh and account selection are settings-window-only IPC. No trade/order API. Account details are runtime-only; full portfolio data is cleared across mode and account changes. Failed refreshes clearly mark retained same-account data stale. Positive-quantity supported holdings are added to watchlist by default, preserving user entries and the100-stock limit. Held quotes lead periodic bulletins using the existing configured interval and baseline. Purchase baseline uses a manually entered price first, otherwise the current selected holding average; account-derived cost is not persisted. The pet advances pending reports every5.7seconds even during repeated threshold alerts, retaining unread order if a new bulletin arrives early. Synthetic demo-only additions must never persist into live configuration; main uses `getPersistedConfig()`.

## 0.5.0 update and search contracts

`searchStocks()` retains its array result. Snapshot adds `catalogStatus:{state,completed,total,retryAt,message}` and quote `unavailable:boolean`. REST 404 stock-not-found is isolated with 20-symbol chunks and bisection. Tracking registration-price semantics remain unchanged; persistence is batched.

Settings-only updater IPC: `getUpdateState`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `onUpdateState`. Update state contains status, mode, currentVersion, latestVersion, progress and a locally-authored message. Windows NSIS uses electron-updater; unsigned macOS uses architecture-matched download from the fixed public GitHub repository. No forced install or restart; no credentials in the feed. Native notification is silent.

Visible brand is 먼작주; internal app name/userData remain Chiikawa Stocks to preserve Keychain encryption identity. App ID and icon stay unchanged.

## 0.5.1 companion mode

`companionMode` is a persisted, strictly boolean setting, default false for existing users. Enabling it stops quote/account monitoring and shows the pet, even if hidden. Startup with the setting enabled never starts market traffic. Prior demo/live/offline session preference and dormant `roaming` preference remain unchanged; disabling resumes the prior session. Explicit connect/demo actions leave companion mode before starting monitoring.

The pet roams while companion mode is enabled even if ordinary roaming is off, while respecting OS reduced motion, dragging, hidden windows and context menus. It shows the selected character name above a brief random everyday line, immediately on entry/character change and then every 18–32 seconds. Dialogue avoids consecutive repeats, uses short hesitant sounds for Chiikawa, friendly Korean sentences for Hachiware and exclamations for Usagi. No stock, portfolio, threshold, connection or demo-price text appears in companion bubbles, including queued reports and in-flight events. Update notices remain available. Mode changes clear pending speech/reactions/reports. Preferences apply immediately and survive restart without API credentials.

## 0.5.2 macOS ad-hoc distribution

Mac bundles use explicit ad-hoc signing with hardened runtime and only allow-jit / disable-library-validation entitlements. No Apple Developer ID or notarization is claimed. Both architecture ZIPs must pass strict deep signature verification after extraction. A Gatekeeper rejection for an unnotarized ad-hoc app is expected and recorded separately from signature integrity; internal signing errors block release. First-launch user approval must be tested on an actual browser download, without disabling Gatekeeper globally. Tags publish a prerelease candidate; promote to stable only after download/launch verification. Include the Korean Mac installation guide. Keep the existing manual Mac update flow and internal app/userData identities.
