import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'qa');
await fs.mkdir(output, {recursive: true});
const profile = await fs.mkdtemp(path.join(output, 'brand-updates-profile-'));
const env = {...process.env, CHII_USER_DATA: profile};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? '-packaged' : '';
const executableName = manifest.build.executableName || manifest.productName;
const executable = process.platform === 'darwin'
  ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/${executableName}.app/Contents/MacOS/${executableName}`
  : `win-unpacked/${executableName}.exe`;
const options = packaged
  ? {executablePath: path.resolve(manifest.build.directories.output, executable), args: ['--demo-preview']}
  : {args: [root, '--demo-preview']};
const report = {passed: false, version: manifest.version, packaged, platform: process.platform, arch: process.arch, mode: 'isolated demo; no live account or update downloads', checks: [], errors: []};
let app, failure;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const transitions = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.all(transitions.map(animation => animation.finished.catch(() => {})));
  });
}
async function capture(page, filename) {
  await settle(page);
  await page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const startedAt = performance.now();
    let lastX = scrollX, lastY = scrollY, stableSince = startedAt;
    // Native smooth scrolling is not a Web Animation. Let the update-heading
    // navigation finish before resetting the screenshot position.
    while (performance.now() - stableSince < 180) {
      await frame();
      const now = performance.now();
      if (Math.abs(scrollX - lastX) > 0.1 || Math.abs(scrollY - lastY) > 0.1) stableSince = now;
      lastX = scrollX; lastY = scrollY;
      if (now - startedAt > 5000) throw new Error('Page scrolling did not settle before capture');
    }
    window.scrollTo({top: 0, left: 0, behavior: 'instant'});
    await frame(); await frame();
  });
  await page.waitForFunction(() => Math.abs(scrollY) < 1 && Math.abs(scrollX) < 1, undefined, {timeout: 5000});
  await page.screenshot({path: path.join(output, filename), fullPage: true, animations: 'disabled', style: '#toast{visibility:hidden}'});
}

try {
  app = await electron.launch({...options, env, timeout: 45000});
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && app.windows().length < 2) await pause(100);
  assert.equal(app.windows().length, 2, 'exactly the settings window and pet window are created');
  const dashboard = app.windows().find(page => page.url().includes('index.html'));
  const pet = app.windows().find(page => page.url().includes('pet.html'));
  assert.ok(dashboard && pet);
  for (const page of [dashboard, pet]) page.on('pageerror', error => report.errors.push(error.message));
  await dashboard.waitForFunction(() => document.querySelectorAll('#stock-rows tr').length === 20);
  await pet.waitForFunction(() => document.querySelector('#pet-character [data-character]')?.dataset.frame !== undefined);
  await settle(dashboard); await settle(pet);
  const native = await app.evaluate(({app, BrowserWindow}) => ({
    internalName: app.getName(), profile: app.getPath('userData'), version: app.getVersion(),
    windows: BrowserWindow.getAllWindows().map(window => ({title: window.getTitle(), url: window.webContents.getURL(), focusable: window.isFocusable(), alwaysOnTop: window.isAlwaysOnTop()})),
  }));
  assert.equal(native.internalName, 'Chiikawa Stocks', 'keychain and user-data identity remain stable across the visible rename');
  assert.equal(native.profile, profile);
  assert.equal(native.version, manifest.version);
  assert.equal(native.windows.find(window => window.url.includes('index.html')).title, `먼작주 ${manifest.version}`);
  const initial = await dashboard.evaluate(() => window.chii.getState());
  assert.equal(initial.mode, 'demo'); assert.equal(initial.credentialsConfigured, false);
  assert.equal(await dashboard.title(), `먼작주 ${manifest.version}`);
  assert.equal(await dashboard.locator('#window-title').textContent(), `먼작주 ${manifest.version}`);
  assert.equal(await dashboard.locator('[data-page="history"], #history-view').count(), 0);
  const visual = await dashboard.evaluate(() => {
    const bar = document.querySelector('.app-titlebar'), logo = document.querySelector('.brand-logo');
    const selectors = ['body', '.price-cell', '.nav-button', '#interval-input', '#baseline-select', '.page-footer'];
    return {
      titlebarHeight: bar.getBoundingClientRect().height, titlebarColor: getComputedStyle(bar).backgroundColor,
      dragRegion: getComputedStyle(bar).getPropertyValue('-webkit-app-region'),
      logoLoaded: logo.complete && logo.naturalWidth > 0, logoAlt: logo.alt,
      fonts: selectors.map(selector => ({selector, family: getComputedStyle(document.querySelector(selector)).fontFamily})),
      loadedFonts: [...document.fonts].filter(font => font.family === 'Tmoney RoundWind').map(font => ({weight: font.weight, status: font.status})),
      forbiddenCopy: ['작고 소중한 주식 친구', '시세는 알려드려도, 선택은 언제나 당신의 몫.', '세 친구, 세 가지 작은 하루', 'WINDOWS & macOS · 나의 작은 친구'].filter(copy => document.body.textContent.includes(copy)),
      overflow: document.documentElement.scrollWidth > innerWidth,
      disclaimer: document.querySelector('.page-footer').textContent.trim(),
      viewOpacity: getComputedStyle(document.querySelector('#watchlist-view')).opacity,
    };
  });
  assert.equal(visual.titlebarHeight, 40); assert.equal(visual.titlebarColor, 'rgb(248, 220, 227)');
  assert.equal(visual.dragRegion, 'drag'); assert.equal(visual.logoLoaded, true); assert.equal(visual.logoAlt, '먼작주');
  assert.ok(visual.fonts.every(font => font.family.includes('Tmoney RoundWind')));
  assert.deepEqual(visual.loadedFonts.map(font => font.status), ['loaded', 'loaded']);
  assert.deepEqual(visual.forbiddenCopy, []); assert.equal(visual.overflow, false); assert.equal(visual.viewOpacity, '1');
  assert.match(visual.disclaimer, /투자 판단.*책임.*이용자 본인/);
  const petFont = await pet.evaluate(() => getComputedStyle(document.querySelector('#speech-title')).fontFamily);
  assert.match(petFont, /Tmoney RoundWind/);
  report.checks.push('stable internal identity and isolated credentials', 'exactly two native windows', '먼작주 native title and visible version', '40px themed draggable titlebar', 'generated logo and both bundled font weights', 'history tab and decorative slogans removed', 'readable investment disclaimer', 'entrance animation completed before final screenshots');
  await capture(dashboard, `brand-watchlist-${manifest.version}${suffix}.png`);
  await dashboard.locator('[data-page="preferences"]').click(); await settle(dashboard);
  const update = await dashboard.evaluate(() => window.chii.getUpdateState());
  assert.equal(update.mode, 'disabled', 'isolated demo never performs release network requests');
  assert.equal(update.status, 'disabled'); assert.equal(update.currentVersion, manifest.version);
  for (const method of ['checkForUpdates', 'downloadUpdate', 'installUpdate']) {
    const state = await dashboard.evaluate(method => window.chii[method](), method);
    assert.equal(state.status, 'disabled', `${method} respects disabled demo mode`);
    await assert.rejects(pet.evaluate(method => window.chii[method](), method), /허용되지/, `${method} rejects pet-window callers`);
  }
  await assert.rejects(pet.evaluate(() => window.chii.getUpdateState()), /허용되지/);
  assert.equal(await dashboard.locator('#check-updates').isDisabled(), true);
  assert.equal(await dashboard.locator('#download-update').isVisible(), false);
  assert.equal(await dashboard.locator('#install-update').isVisible(), false);
  report.checks.push('update IPC available in settings and rejected from pet', 'isolated demo cannot download or install updates');
  // Only renderer events are injected: no updater controller, release URL or install is touched.
  await app.evaluate(({BrowserWindow}) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chii:update-state', {status: 'available', mode: 'manual', currentVersion: '0.5.0', latestVersion: '0.5.1', message: '가상 업데이트 안내 · 다운로드 후 앱을 교체해 주세요.', progress: 0});
  });
  await pet.waitForFunction(() => document.querySelector('#speech-title').textContent === '0.5.1 새 버전이 있어요');
  assert.match(await pet.locator('#speech-meta').textContent(), /두 번 클릭/);
  await dashboard.waitForFunction(() => !document.querySelector('#download-update').hidden);
  assert.equal(await dashboard.locator('#install-update').isVisible(), false);
  assert.match(await dashboard.locator('#update-help').textContent(), /앱을 교체/);
  await dashboard.locator('[data-page="watchlist"]').click(); await settle(dashboard);
  assert.equal(await dashboard.locator('#update-notice').isVisible(), true);
  await dashboard.locator('#update-notice').click(); await settle(dashboard);
  assert.equal(await dashboard.locator('#preferences-view').isVisible(), true);
  await capture(dashboard, `brand-update-manual-${manifest.version}${suffix}.png`);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).webContents.send('chii:update-state', {status: 'downloading', mode: 'automatic', currentVersion: '0.5.0', latestVersion: '0.5.1', message: '가상 다운로드 진행률', progress: 42}));
  await dashboard.waitForFunction(() => document.querySelector('#update-progress').value === 42);
  assert.equal(await dashboard.locator('#check-updates').isDisabled(), true);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).webContents.send('chii:update-state', {status: 'downloaded', mode: 'automatic', currentVersion: '0.5.0', latestVersion: '0.5.1', message: '가상 설치 준비 상태', progress: 100}));
  await dashboard.waitForFunction(() => !document.querySelector('#install-update').hidden);
  report.checks.push('pet update bubble independent of OS notification support', 'manual update notice, download-only UI and header navigation', 'automatic update progress and explicit install UI via synthetic events');
  await app.evaluate(({BrowserWindow}, update) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).webContents.send('chii:update-state', update), update);
  await settle(dashboard);
  await capture(dashboard, `brand-preferences-${manifest.version}${suffix}.png`);
  assert.equal(app.windows().length, 2); assert.deepEqual(report.errors, []);
  report.native = native; report.visual = visual; report.petFont = petFont; report.update = update; report.passed = true;
} catch (error) {failure = error; report.failure = error.stack || String(error);}
finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  report.profileCleaned = await fs.access(profile).then(() => false, () => true);
  await fs.writeFile(path.join(output, `brand-updates-${manifest.version}${suffix}.json`), JSON.stringify(report, null, 2));
}
if (failure) throw failure;
console.log('Native branding, fonts, titlebar, removed history and safe update IPC smoke passed.');
