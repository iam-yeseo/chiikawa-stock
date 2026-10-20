import { EventEmitter } from 'node:events';

export const RELEASE_REPOSITORY = 'iam-yeseo/chiikawa-stock';
export const RELEASES_URL = `https://github.com/${RELEASE_REPOSITORY}/releases`;
const VERSION = /^\d+\.\d+\.\d+$/;
const SIX_HOURS = 6 * 60 * 60 * 1000;
function newer(candidate, current) {
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Only stable, architecture-matched artifacts in our own release may be opened. */
export function manualRelease(release, currentVersion, arch) {
  if (release?.draft || release?.prerelease) throw new Error('Invalid release');
  const version = String(release?.tag_name || '').replace(/^v/, '');
  if (!VERSION.test(version)) throw new Error('Invalid release version');
  if (!newer(version, currentVersion)) return { version, available: false };
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported architecture');
  const name = `Meonjakju-${version}-mac-${arch}.zip`;
  const expected = `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}/${name}`;
  const asset = release.assets?.find(item => item.name === name && item.browser_download_url === expected && item.size > 0);
  if (!asset) throw new Error('Release artifact unavailable');
  return { version, available: true, url: expected };
}

/** No account credentials, financial state or remote text enter this controller. */
export class UpdateController extends EventEmitter {
  constructor({ version, platform, arch, enabled, updater, fetchImpl = fetch, openExternal, beforeInstall = async () => {}, now = Date.now }) {
    super();
    this.platform = platform; this.arch = arch; this.updater = updater;
    this.fetch = fetchImpl; this.openExternal = openExternal; this.beforeInstall = beforeInstall; this.now = now;
    const mode = !enabled ? 'disabled' : platform === 'win32' ? 'automatic' : platform === 'darwin' ? 'manual' : 'disabled';
    this.state = { status: mode === 'disabled' ? 'disabled' : 'idle', mode, currentVersion: version, latestVersion: null, progress: 0,
      message: mode === 'disabled' ? '설치된 앱에서 업데이트를 확인할 수 있어요.' : '새 버전을 자동으로 확인해요.' };
    this.listeners = [];
    if (mode === 'automatic') this.bindUpdater();
  }
  getState() { return { ...this.state }; }
  set(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.getState()); }
  fail() { this.set({ status: 'error', message: '업데이트를 확인하거나 내려받지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
  bindUpdater() {
    const updater = this.updater;
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false; updater.allowDowngrade = false; updater.logger = null;
    const on = (name, handler) => { updater.on(name, handler); this.listeners.push([name, handler]); };
    on('checking-for-update', () => this.set({ status: 'checking', message: '새 버전을 확인하고 있어요.' }));
    on('update-available', info => {
      if (!VERSION.test(info.version) || !newer(info.version, this.state.currentVersion)) return this.fail();
      this.set({ status: 'available', latestVersion: info.version, progress: 0, message: `${info.version} 업데이트가 있어요.` });
    });
    on('update-not-available', () => this.set({ status: 'current', latestVersion: null, message: '최신 버전을 사용하고 있어요.' }));
    on('download-progress', info => this.set({ status: 'downloading', progress: Math.max(0, Math.min(100, Number(info.percent) || 0)), message: '업데이트를 내려받고 있어요.' }));
    on('update-downloaded', info => {
      if (info.version !== this.state.latestVersion) return this.fail();
      this.set({ status: 'downloaded', progress: 100, message: '다운로드가 끝났어요. 재시작하면 업데이트가 설치돼요.' });
    });
    on('error', () => { this.installing = false; this.fail(); });
  }
  check() {
    if (this.checkPromise) return this.checkPromise;
    if (['disabled', 'downloading', 'downloaded'].includes(this.state.status)) return Promise.resolve(this.getState());
    // Repeated clicks and native menu requests share one request and a short cooldown.
    if (this.lastCheck != null && this.now() - this.lastCheck < 30_000) return Promise.resolve(this.getState());
    this.lastCheck = this.now();
    this.checkPromise = this.performCheck().finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }
  async performCheck() {
    this.set({ status: 'checking', message: '새 버전을 확인하고 있어요.' });
    try {
      if (this.state.mode === 'automatic') await this.updater.checkForUpdates();
      else {
        const response = await this.fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Meonjakju-Updater' },
          redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 404) this.set({ status: 'current', latestVersion: null, message: '아직 새로운 정식 버전이 없어요.' });
        else {
          if (!response.ok) throw new Error('Update check failed');
          const release = manualRelease(await response.json(), this.state.currentVersion, this.arch);
          this.downloadURL = release.url;
          this.set({ status: release.available ? 'available' : 'current', latestVersion: release.available ? release.version : null,
            message: release.available ? `${release.version} 업데이트가 있어요. 다운로드 후 앱을 교체해 주세요.` : '최신 버전을 사용하고 있어요.' });
        }
      }
    } catch { this.fail(); }
    return this.getState();
  }
  async download() {
    if (this.state.status !== 'available') return this.getState();
    if (this.state.mode === 'manual') {
      try { await this.openExternal(this.downloadURL); }
      catch { this.fail(); }
    } else {
      this.set({ status: 'downloading', progress: 0, message: '업데이트를 내려받고 있어요.' });
      try { await this.updater.downloadUpdate(); } catch { this.fail(); }
    }
    return this.getState();
  }
  async install() {
    if (this.state.mode !== 'automatic' || this.state.status !== 'downloaded' || this.installing) return this.getState();
    this.installing = true;
    try { await this.beforeInstall(); this.updater.quitAndInstall(false, true); }
    catch { this.installing = false; this.fail(); }
    return this.getState();
  }
  start() {
    if (this.state.mode === 'disabled') return;
    this.initialTimer = setTimeout(() => this.check(), 15_000); this.initialTimer.unref?.();
    this.timer = setInterval(() => this.check(), SIX_HOURS); this.timer.unref?.();
  }
  dispose() {
    clearTimeout(this.initialTimer); clearInterval(this.timer);
    for (const [name, handler] of this.listeners) this.updater.removeListener(name, handler);
  }
}
