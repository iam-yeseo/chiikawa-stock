import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {COMPANION_DIALOGUE} from '../lib/companion-dialogue.js';

const root = process.cwd();
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'qa');
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? '-packaged' : '';
await fs.mkdir(output, {recursive: true});
const profile = await fs.mkdtemp(path.join(output, 'companion-profile-'));
const env = {...process.env, CHII_USER_DATA: profile};
delete env.ELECTRON_RUN_AS_NODE;
const executableName = manifest.build.executableName || manifest.productName;
const executable = process.platform === 'darwin'
  ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/${executableName}.app/Contents/MacOS/${executableName}`
  : `win-unpacked/${executableName}.exe`;
const options = packaged
  ? {executablePath: path.resolve(manifest.build.directories.output, executable), args: ['--demo-preview']}
  : {args: [root, '--demo-preview']};
const names = {chiikawa: '치이카와', hachiware: '하치와레', usagi: '우사기'};
const allowed = Object.fromEntries(Object.entries(COMPANION_DIALOGUE).map(([id, entries]) => [id, new Set(entries.map(entry => entry.text))]));
const report = {passed: false, version: manifest.version, packaged, platform: process.platform, arch: process.arch,
  mode: 'isolated demo and companion; no real account data or update downloads', checks: [], characters: [], errors: []};
const launches = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let failure;

async function launch() {
  const app = await electron.launch({...options, env, timeout: 45000});
  launches.push(app);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !['index.html', 'pet.html'].every(name => app.windows().some(page => page.url().includes(name)))) await pause(100);
  const dashboard = app.windows().find(page => page.url().includes('index.html'));
  const pet = app.windows().find(page => page.url().includes('pet.html'));
  assert.ok(dashboard && pet, 'settings and pet windows exist');
  for (const page of [dashboard, pet]) {
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.errors.push(error.message));
  }
  await dashboard.waitForSelector('#companion-mode-input', {state: 'attached'});
  await pet.waitForFunction(() => document.querySelector('#pet-character [data-character]')?.dataset.frame !== undefined);
  const native = await app.evaluate(({app}) => ({profile: app.getPath('userData'), packaged: app.isPackaged, version: app.getVersion()}));
  assert.equal(native.profile, profile, 'only the temporary test profile is used');
  assert.equal(native.packaged, packaged);
  assert.equal(native.version, manifest.version);
  await pet.evaluate(async () => {
    const state = await window.chii.getState();
    const qa = window.__companionQA = {speeches: [], motions: [], bulletins: [], previous: null, companionActive: state.config.companionMode === true};
    const capture = () => {
      const speech = document.querySelector('#speech');
      if (speech.hidden) return;
      const value = {at: Date.now(), companionActive: qa.companionActive, content: speech.dataset.content || '', kind: document.querySelector('#speech-kind').textContent,
        title: document.querySelector('#speech-title').textContent, body: document.querySelector('#speech-body').textContent,
        meta: document.querySelector('#speech-meta').textContent, character: document.querySelector('#pet-character [data-character]')?.dataset.character};
      const signature = JSON.stringify({...value, at: 0});
      if (signature !== qa.previous) { qa.speeches.push(value); qa.previous = signature; }
    };
    // The checkbox can wait for layout/actionability while ordinary demo
    // reports are still valid. Keep those observations for diagnosis, but mark
    // the exact state boundary rather than treating the click's start as enable.
    // Renderer state handlers run before this listener; capture also catches a
    // stock bubble incorrectly retained after a companion-enabled snapshot.
    qa.unsubscribeState = window.chii.onState(state => {qa.companionActive = state.config.companionMode === true; capture();});
    qa.observer = new MutationObserver(capture);
    qa.observer.observe(document.querySelector('#speech'), {subtree: true, childList: true, characterData: true, attributes: true});
    qa.unsubscribeMotion = window.chii.onMotion(event => qa.motions.push(event));
    qa.unsubscribeBulletin = window.chii.onBulletin(event => qa.bulletins.push(event));
    capture();
  });
  return {app, dashboard, pet};
}

async function readSpeech(pet) {
  return pet.evaluate(() => {
    const speech = document.querySelector('#speech');
    const box = speech.getBoundingClientRect();
    const heading = document.querySelector('#speech-kind').getBoundingClientRect();
    const line = document.querySelector('#speech-title').getBoundingClientRect();
    const character = document.querySelector('#pet-character [data-character]');
    const position = document.querySelector('#pet').getBoundingClientRect();
    return {hidden: speech.hidden, content: speech.dataset.content, kind: document.querySelector('#speech-kind').textContent,
      title: document.querySelector('#speech-title').textContent, body: document.querySelector('#speech-body').textContent,
      meta: document.querySelector('#speech-meta').textContent, voiceHidden: document.querySelector('#speech-voice').hidden,
      character: character.dataset.character, action: character.dataset.action, x: position.x, y: position.y,
      headingAboveLine: heading.bottom <= line.top + 1, onScreen: box.x >= 0 && box.y >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1};
  });
}

function assertCompanionSpeech(value, id) {
  assert.equal(value.hidden, false, `${id} has a visible companion bubble`);
  assert.equal(value.content, 'companion');
  assert.equal(value.kind, names[id], 'the character name appears above its line');
  assert.ok(allowed[id].has(value.title), `${id} uses its own dialogue catalog: ${value.title}`);
  assert.equal(value.body, '', 'stock details are absent');
  assert.equal(value.meta, '', 'stock metadata is absent');
  assert.equal(value.voiceHidden, true, 'a second stock voice row is absent');
  assert.equal(value.character, id);
  assert.equal(value.headingAboveLine, true);
  assert.equal(value.onScreen, true, 'the complete speech bubble stays inside the screen');
}

async function capturePet(pet, filename) {
  const clip = await pet.evaluate(() => {
    const pet = document.querySelector('#pet-character').getBoundingClientRect();
    const speech = document.querySelector('#speech').getBoundingClientRect();
    const x = Math.max(0, Math.floor(Math.min(pet.left, speech.left) - 20));
    const y = Math.max(0, Math.floor(Math.min(pet.top, speech.top) - 20));
    const right = Math.min(innerWidth, Math.ceil(Math.max(pet.right, speech.right) + 20));
    const bottom = Math.min(innerHeight, Math.ceil(Math.max(pet.bottom, speech.bottom) + 20));
    return {x, y, width: right - x, height: bottom - y};
  });
  await pet.screenshot({path: path.join(output, filename), clip});
}

async function injectFinancialEvents(app) {
  await app.evaluate(async ({BrowserWindow}) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet.html'));
    const state = await window.webContents.executeJavaScript('window.chii.getState()');
    const quote = {...state.quotes[0], market: 'KR', symbol: '005930', name: 'COMPANION_QA_STOCK', price: 123456, currency: 'KRW', changePercent: 25, updatedAt: Date.now(), stale: false};
    window.webContents.send('chii:bulletin', {quotes: [quote], at: Date.now(), __qaCompanion: true});
    for (const direction of ['up', 'down']) window.webContents.send('chii:motion', {action: direction === 'up' ? 'happy' : 'cry',
      alert: {id: `qa-companion-${direction}`, ...quote, level: 25, percent: direction === 'up' ? 25 : -25, direction, at: Date.now()}});
    window.webContents.send('chii:state', {...state, mode: 'live', connection: {state: 'error', message: 'COMPANION_QA_CONNECTION_ERROR', updatedAt: Date.now()}});
    window.webContents.send('chii:state', {...state, mode: 'live', connection: {state: 'connected', message: 'COMPANION_QA_CONNECTION_RECOVERY', updatedAt: Date.now()}});
    window.webContents.send('chii:state', state);
  });
}

function assertNoFinancialSpeech(speeches) {
  assert.ok(speeches.length > 0, 'active companion speech was observed');
  for (const speech of speeches) {
    assert.equal(speech.content, 'companion', 'financial events never replace companion speech');
    assert.equal(speech.kind, names[speech.character]);
    assert.ok(allowed[speech.character].has(speech.title));
    assert.equal(speech.body, '');
    assert.equal(speech.meta, '');
    assert.doesNotMatch(`${speech.kind} ${speech.title} ${speech.body} ${speech.meta}`, /COMPANION_QA|시세|종목|연결|기준가|\d[,.\d]*\s*(?:원|%)/);
  }
}

const started = Date.now();
try {
  const {app, dashboard, pet} = await launch();
  await dashboard.waitForFunction(async () => (await window.chii.getState()).mode === 'demo');
  await dashboard.evaluate(() => window.chii.demo());
  const initial = await dashboard.evaluate(() => window.chii.getState());
  assert.equal(initial.config.companionMode, false);
  assert.equal(initial.credentialsConfigured, false);
  await dashboard.evaluate(() => window.chii.updateConfig({roaming: false, intervalMinutes: 0.1}));
  const before = await dashboard.evaluate(() => window.chii.getState());
  await dashboard.locator('[data-page="preferences"]').click();
  await dashboard.locator('#speech-scale-input').evaluate(input => {input.value = '150'; input.dispatchEvent(new Event('input', {bubbles: true}));});
  await dashboard.locator('#interval-input').fill('11');
  await dashboard.locator('#companion-mode-input').check();
  await dashboard.waitForFunction(async () => {
    const state = await window.chii.getState();
    return state.config.companionMode && state.mode === 'offline' && !document.querySelector('#companion-mode-input').disabled;
  });
  await pet.waitForFunction(() => !document.querySelector('#speech').hidden && document.querySelector('#speech').dataset.content === 'companion');
  const enabled = await dashboard.evaluate(() => window.chii.getState());
  for (const key of ['roaming', 'petSize', 'speechScale', 'intervalMinutes', 'baseline']) assert.deepEqual(enabled.config[key], before.config[key], `${key} is preserved by the immediate toggle`);
  assert.deepEqual(enabled.config.watchlist, before.config.watchlist);
  assert.equal(await dashboard.locator('#speech-scale-input').inputValue(), '150', 'unsaved speech-size draft is preserved');
  assert.equal(await dashboard.locator('#interval-input').inputValue(), '11', 'unsaved interval draft is preserved');
  assert.equal(await dashboard.locator('#companion-mode-status').textContent(), '함께 산책 중');
  assert.equal(await dashboard.locator('#speech-scale-sample > span').textContent(), '치이카와');
  assert.equal(await dashboard.locator('#speech-scale-sample > p').isHidden(), true, 'settings speech preview also omits stock details');
  assert.equal(enabled.portfolio.holdings, null, 'account runtime data is cleared while monitoring is paused');
  assertCompanionSpeech(await readSpeech(pet), 'chiikawa');
  await pet.evaluate(() => {window.__companionQA.motions = []; window.__companionQA.bulletins = [];});
  report.checks.push('real settings toggle immediately starts companion mode, pauses market monitoring, and preserves config and drafts');

  const movement = [];
  for (let i = 0; i < 16; i++) {movement.push(await readSpeech(pet)); await pause(500);}
  const origin = movement[0];
  const maxDisplacement = Math.max(...movement.map(value => Math.hypot(value.x - origin.x, value.y - origin.y)));
  assert.ok(maxDisplacement >= 5, 'companion visibly roams even when the stock roaming preference is disabled');
  assert.ok(movement.some(value => value.action === 'walk'), 'actual walk frames occur');
  report.movement = {storedRoaming: enabled.config.roaming, maxDisplacement, samples: movement};
  report.checks.push('real wall-clock roaming works with stored roaming:false');

  for (const id of ['hachiware', 'chiikawa', 'usagi']) {
    await dashboard.locator(`.character-choice[data-character-id="${id}"]`).click();
    await pet.waitForFunction(id => document.querySelector('#pet-character [data-character]')?.dataset.character === id &&
      document.querySelector('#speech-kind').textContent === ({chiikawa: '치이카와', hachiware: '하치와레', usagi: '우사기'})[id] && !document.querySelector('#speech').hidden, id);
    const first = await readSpeech(pet);
    assertCompanionSpeech(first, id);
    await injectFinancialEvents(app);
    await pause(350);
    const afterFinancial = await readSpeech(pet);
    assertCompanionSpeech(afterFinancial, id);
    assert.equal(afterFinancial.title, first.title, 'alerts, bulletins, and connection changes do not replace a character line');
    await dashboard.locator('[data-preview-action="happy"]').click();
    await pet.waitForFunction(() => document.querySelector('#pet-character [data-character]')?.dataset.action === 'happy');
    const preview = await readSpeech(pet);
    assertCompanionSpeech(preview, id);
    assert.ok(COMPANION_DIALOGUE[id].some(line => line.text === preview.title && line.action === 'happy'), 'motion previews use a matching everyday line');
    await capturePet(pet, `companion-${id}-${manifest.version}${suffix}.png`);
    report.characters.push({id, first, afterFinancial, preview});
  }
  report.checks.push('all three character names, distinct dialogue catalogs, and financial-event suppression');

  const recurringStart = Date.now();
  const last = await readSpeech(pet);
  await pet.locator('#dismiss-speech').evaluate(button => button.click());
  assert.equal(await pet.locator('#speech').isHidden(), true, 'a speech bubble can be dismissed');
  await pet.waitForFunction(previous => {
    const speech = document.querySelector('#speech');
    return !speech.hidden && speech.dataset.content === 'companion' && document.querySelector('#speech-title').textContent !== previous;
  }, last.title, {timeout: 35000});
  const recurring = await readSpeech(pet);
  assertCompanionSpeech(recurring, 'usagi');
  report.recurring = {elapsedMs: Date.now() - recurringStart, previous: last.title, next: recurring.title};
  assert.ok(report.recurring.elapsedMs >= 1000, 'new dialogue arrives from the random schedule rather than immediately replacing dismissal');
  const observation = await pet.evaluate(() => ({speeches: window.__companionQA.speeches, motions: window.__companionQA.motions, bulletins: window.__companionQA.bulletins}));
  report.observedSpeech = observation.speeches;
  const activeSpeech = observation.speeches.filter(speech => speech.companionActive);
  report.observationBoundary = {inactiveNotices: observation.speeches.filter(speech => !speech.companionActive && speech.content === 'notice').length, activeSpeeches: activeSpeech.length};
  assert.ok(report.observationBoundary.inactiveNotices > 0, 'ordinary stock setup notices are retained with the inactive state flag');
  assertNoFinancialSpeech(activeSpeech);
  assert.equal(observation.motions.filter(event => event.alert && !event.alert.id.startsWith('qa-companion-')).length, 0, 'main sends no automatic stock alerts while companion mode is active');
  assert.equal(observation.bulletins.filter(event => !event.__qaCompanion).length, 0, 'main sends no periodic stock bulletins while companion mode is active');
  report.checks.push('random dialogue resumes after dismissal with a different line; market events stay paused for more than one six-second report interval');
  await dashboard.evaluate(async () => {
    window.scrollTo({top: 0, left: 0, behavior: 'instant'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await dashboard.waitForFunction(() => Math.abs(scrollY) < 1 && Math.abs(scrollX) < 1);
  await dashboard.screenshot({path: path.join(output, `companion-settings-${manifest.version}${suffix}.png`), fullPage: true, animations: 'disabled', style: '#toast{visibility:hidden}'});

  await pet.reload();
  await pet.waitForFunction(() => document.querySelector('#speech')?.dataset.content === 'companion' && !document.querySelector('#speech').hidden);
  assertCompanionSpeech(await readSpeech(pet), 'usagi');
  await app.close();
  const restarted = await launch();
  const restored = await restarted.dashboard.evaluate(() => window.chii.getState());
  assert.equal(restored.config.companionMode, true);
  assert.equal(restored.config.characterId, 'usagi');
  assert.equal(restored.config.roaming, false);
  assert.equal(restored.config.speechScale, before.config.speechScale, 'an unsaved draft is not persisted');
  assert.equal(restored.config.intervalMinutes, 0.1);
  assert.equal(restored.mode, 'offline', 'restart does not reconnect the market while companion mode is enabled');
  assert.equal(restored.credentialsConfigured, false);
  await restarted.pet.waitForFunction(() => document.querySelector('#speech')?.dataset.content === 'companion' && !document.querySelector('#speech').hidden);
  assertCompanionSpeech(await readSpeech(restarted.pet), 'usagi');
  const persisted = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
  assert.equal(persisted.companionMode, true);
  const session = JSON.parse(await fs.readFile(path.join(profile, 'session.json'), 'utf8'));
  assert.equal(session.mode, 'demo', 'the preceding stock mode is retained for later resumption');
  report.checks.push('renderer reload and app restart retain companion mode without stock startup speech or reconnecting');

  await restarted.dashboard.locator('[data-page="preferences"]').click();
  await restarted.dashboard.locator('#companion-mode-input').uncheck();
  await restarted.dashboard.waitForFunction(async () => {
    const state = await window.chii.getState();
    return !state.config.companionMode && state.mode === 'demo' && state.quotes.some(quote => Number.isFinite(quote.price));
  });
  await restarted.pet.waitForFunction(() => !document.querySelector('#speech').hidden && document.querySelector('#speech').dataset.content !== 'companion');
  await pause(500);
  const disabledPosition = await readSpeech(restarted.pet);
  await pause(3000);
  const restingPosition = await readSpeech(restarted.pet);
  assert.ok(Math.hypot(restingPosition.x - disabledPosition.x, restingPosition.y - disabledPosition.y) < 0.2, 'disabling companion restores the saved no-roaming preference');
  await restarted.pet.waitForFunction(() => document.querySelector('#speech-kind').textContent.includes('데모') && document.querySelector('#speech-body').textContent.includes('%'), undefined, {timeout: 10000});
  report.checks.push('disabling resumes the previous demo mode, periodic financial speech, and saved roaming preference');
  await restarted.dashboard.locator('#companion-mode-input').check();
  await restarted.dashboard.waitForFunction(async () => (await window.chii.getState()).config.companionMode);
  const explicitDemo = await restarted.dashboard.evaluate(() => window.chii.demo());
  assert.equal(explicitDemo.config.companionMode, false, 'explicit stock demo selection exits companion mode');
  assert.equal(explicitDemo.mode, 'demo');
  report.checks.push('explicit stock demo exits companion mode');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  failure = error;
  report.failure = error.stack || String(error);
} finally {
  for (const app of launches) {try {await app.close();} catch {}}
  await fs.rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  report.profileCleaned = await fs.access(profile).then(() => false, () => true);
  report.elapsedMs = Date.now() - started;
  await fs.writeFile(path.join(output, `companion-${manifest.version}${suffix}.json`), JSON.stringify(report, null, 2));
}
if (failure) throw failure;
console.log(`Companion settings, three voices, real roaming, financial suppression, schedule and restart passed (${(report.elapsedMs / 1000).toFixed(1)}s).`);
