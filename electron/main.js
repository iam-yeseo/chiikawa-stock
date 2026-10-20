import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, safeStorage, powerMonitor, session, shell, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MarketService } from '../lib/market-service.js';
import { defaultConfig, normalizeConfig } from '../lib/config.js';
import { getCharacterProfile } from '../lib/characters.js';
import { atomicWrite, readConfig, createVault } from './storage.js';
import { PetDragController } from './pet-drag.js';
import electronUpdater from 'electron-updater';
import { UpdateController } from './updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Keep the existing safeStorage Keychain identity and data directory across the
// visible rename. Changing this name would strand existing encrypted API keys.
app.setName('Chiikawa Stocks');
app.setPath('userData', path.join(app.getPath('appData'), 'Chiikawa Stocks'));
if (process.platform === 'win32') app.setAppUserModelId('im.chii.stocks');
// Explicit preview runs use a separate profile and never open the user's API vault.
const demoPreview = app.commandLine.hasSwitch('demo-preview');
if ((!app.isPackaged || demoPreview) && process.env.CHII_USER_DATA) app.setPath('userData', path.resolve(process.env.CHII_USER_DATA));
else if (demoPreview) app.setPath('userData', path.join(app.getPath('userData'), 'demo-preview'));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let settingsWindow, petWindow, tray, service, vault, updates;
let credentialReady = false, quitting = false, suspended = false, preferredMode = 'demo';
let selectedDisplay, configWrite = Promise.resolve(), lifecycle = Promise.resolve(), resumeMode = null;
let petMousePress = null;
const announcedUpdates = new Set();
function queueLifecycle(operation) {
  const result = lifecycle.catch(() => {}).then(operation);
  lifecycle = result.catch(() => {});
  return result;
}
const devURL = !app.isPackaged && process.env.CHII_DEV_URL === 'http://127.0.0.1:5173' ? process.env.CHII_DEV_URL : null;
const preload = path.join(here, 'preload.cjs');
const webPreferences = { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false };
const windows = () => [settingsWindow, petWindow].filter(window => window && !window.isDestroyed());
const petDrag = new PetDragController({ screen, getWindow: () => petWindow,
  onDisplayChange: id => { selectedDisplay = id; updateTray(); } });

function decorate(state) {
  return { ...state, ...(suspended ? {connection:{state:'idle',message:'컴퓨터가 잠들어 있어요. 깨어나면 다시 연결합니다.',updatedAt:Date.now()},quotes:state.quotes.map(q=>({...q,stale:true}))}:{}), credentialsConfigured: credentialReady, version: app.getVersion() };
}
function snapshot() { return decorate(service.getState()); }
function broadcast(channel, payload) { for (const window of windows()) window.webContents.send(channel, payload); }
function publish(state) { broadcast('chii:state', decorate(state ?? service.getState())); }
function validSender(event, settingsOnly = false) {
  const allowed = settingsOnly ? [settingsWindow] : windows();
  return allowed.some(w => w && !w.isDestroyed() && event.sender === w.webContents && event.senderFrame === w.webContents.mainFrame);
}
function requireSender(event, settingsOnly = false) { if (!validSender(event, settingsOnly)) throw new Error('허용되지 않은 요청입니다.'); }
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
async function load(window, page) {
  if (devURL) await window.loadURL(`${devURL}/${page}`);
  else await window.loadFile(path.join(root, 'dist', page));
}
function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ width: 1180, height: 830, minWidth: 850, minHeight: 650, show: false,
    title: `먼작주 ${app.getVersion()}`, backgroundColor:'#fffdf3', autoHideMenuBar:true,
    titleBarStyle:'hidden', titleBarOverlay:{color:'#f8dce3',symbolColor:'#654a3c',height:40},
    ...(process.platform === 'darwin' ? {trafficLightPosition:{x:14,y:13}} : {}), webPreferences });
  settingsWindow.on('page-title-updated', event => { event.preventDefault(); });
  secureWindow(settingsWindow);
  settingsWindow.once('ready-to-show', () => { settingsWindow.show(); publish(); });
  settingsWindow.on('close', event => { if (!quitting) { event.preventDefault(); settingsWindow.hide(); } });
  load(settingsWindow, 'index.html').catch(() => console.error('설정 화면을 열지 못했습니다.'));
}
function currentDisplay() {
  return screen.getAllDisplays().find(display => display.id === selectedDisplay) || screen.getPrimaryDisplay();
}
function showPet() {
  if (petWindow && !petWindow.isDestroyed()) { petWindow.showInactive(); return; }
  const area = currentDisplay().workArea;
  petWindow = new BrowserWindow({ ...area, show:false, frame:false, transparent:true, hasShadow:false,
    resizable:false, movable:false, focusable:false, skipTaskbar:true, alwaysOnTop:true,
    fullscreenable:false, roundedCorners:false, backgroundColor:'#00000000', webPreferences });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.on('hide', () => { petMousePress=null; petDrag.end(undefined, 'hidden'); petWindow?.setIgnoreMouseEvents(true, { forward: true }); });
  // Native mouse-up also ends drags if DOM pointer capture was lost at a display edge.
  petWindow.webContents.on('before-mouse-event', (_event, mouse) => {
    // Electron exposes Blink PositionInScreen; Chromium's Windows mouse builder
    // already converts native screen pixels to DIP. Do not scale these again.
    const point = Number.isFinite(mouse.globalX) && Number.isFinite(mouse.globalY)
      ? { x: mouse.globalX, y: mouse.globalY } : null;
    if (mouse.type === 'mouseDown' && mouse.button === 'left') petMousePress = { down: point, latest: point, released: false };
    if (petMousePress && point && !petMousePress.released) petMousePress.latest = point;
    if (mouse.type === 'mouseMove' && petDrag.active) petDrag.update(false, '', point);
    if (mouse.type === 'mouseUp' && mouse.button === 'left') {
      if (petMousePress) petMousePress.released = true;
      petDrag.end(undefined, 'released', point);
    }
  });
  petWindow.webContents.on('render-process-gone', () => { petMousePress=null; petDrag.end(undefined, 'renderer-gone'); });
  petWindow.webContents.on('did-start-loading', () => { petMousePress=null; petDrag.end(undefined, 'reload'); });
  petWindow.on('close', () => { petMousePress=null; petDrag.end(undefined, 'closed'); });
  secureWindow(petWindow);
  petWindow.once('ready-to-show', () => { petWindow.showInactive(); publish(); });
  petWindow.on('closed', () => { petWindow = null; });
  load(petWindow, 'pet.html').catch(() => console.error('캐릭터 창을 열지 못했습니다.'));
}
function trayImage() {
  // A small stock-chart glyph; character artwork is rendered by the pet window.
  const size=22, data=Buffer.alloc(size*size*4);
  const dot=(x,y)=>{ if(x>=0&&y>=0&&x<size&&y<size){const i=(y*size+x)*4;data[i]=35;data[i+1]=35;data[i+2]=40;data[i+3]=255;} };
  for(let x=3;x<20;x++)for(let d=0;d<2;d++) dot(x,19-d);
  for(let y=3;y<20;y++)for(let d=0;d<2;d++) dot(3+d,y);
  const points=[[6,14],[10,10],[13,13],[18,5]];
  for(let p=1;p<points.length;p++)for(let t=0;t<=1;t+=.03){const x=Math.round(points[p-1][0]*(1-t)+points[p][0]*t),y=Math.round(points[p-1][1]*(1-t)+points[p][1]*t);dot(x,y);dot(x+1,y);}
  const result=nativeImage.createFromBitmap(data,{width:size,height:size});
  if(process.platform==='darwin')result.setTemplateImage(true);
  return result;
}
function updateTray() {
  if(!tray)return;
  const characterName = getCharacterProfile(service?.config?.characterId).name;
  const update = updates?.getState();
  const updateLabel = ['available','downloaded'].includes(update?.status) ? `새 버전 ${update.latestVersion} · 업데이트 열기` : '업데이트 확인';
  tray.setToolTip(`먼작주 ${app.getVersion()}${update?.status === 'available' ? ` · 새 버전 ${update.latestVersion}` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:`먼작주 ${app.getVersion()}`,enabled:false},
    {label:'관심종목 · 설정',click:showSettings},
    {label:`${characterName} 보이기`,click:showPet},
    {label:`${characterName} 잠시 숨기기`,click:()=>petWindow?.hide()},
    {label:'보낼 모니터',submenu:screen.getAllDisplays().map((display,i)=>({label:`화면 ${i+1} (${display.size.width}×${display.size.height})`,type:'radio',checked:display.id===currentDisplay().id,click:()=>{petDrag.end(undefined,'menu');selectedDisplay=display.id;showPet();petWindow.setBounds(display.workArea);updateTray();}}))},
    {type:'separator'},
    {label:'상승 반응 미리보기',click:()=>broadcast('chii:motion',{action:'happy'})},
    {label:'하락 반응 미리보기',click:()=>broadcast('chii:motion',{action:'cry'})},
    {label:updateLabel,click:()=>{showSettings();updates?.check();}},
    {type:'separator'},
    {label:'종료',click:()=>app.quit()}
  ]));
}
async function rememberMode(mode) {
  preferredMode=mode;
  await atomicWrite(path.join(app.getPath('userData'),'session.json'),JSON.stringify({mode}));
}
function persistConfig(config) {
  configWrite=configWrite.catch(()=>{}).then(()=>atomicWrite(path.join(app.getPath('userData'),'settings.json'),JSON.stringify(config,null,2)));
  return configWrite;
}
function installIPC() {
  ipcMain.handle('chii:update-state',event=>{requireSender(event,true);return updates.getState();});
  ipcMain.handle('chii:update-check',event=>{requireSender(event,true);return updates.check();});
  ipcMain.handle('chii:update-download',event=>{requireSender(event,true);return updates.download();});
  ipcMain.handle('chii:update-install',event=>{requireSender(event,true);return updates.install();});
  ipcMain.handle('chii:state',event=>{requireSender(event);return snapshot();});
  ipcMain.handle('chii:config',async(event,patch)=>{
    requireSender(event);
    if(!patch || typeof patch!=='object' || Array.isArray(patch) || JSON.stringify(patch).length>100000)throw new Error('설정 내용을 확인해 주세요.');
    await service.updateConfig(patch);
    await persistConfig(service.getPersistedConfig());
    publish();return snapshot();
  });
  ipcMain.handle('chii:credentials',async(event,input)=>{
    requireSender(event,true);
    if(demoPreview)throw new Error('데모 미리보기에서는 실제 API 키를 저장하지 않아요. 일반 실행으로 연결해 주세요.');
    return queueLifecycle(async()=>{
    await vault.save(input);credentialReady=true;
    await service.stop();
    await rememberMode('demo');await service.start('demo');publish();return snapshot();
    });
  });
  ipcMain.handle('chii:clear-credentials',async event=>{
    requireSender(event,true);
    if(demoPreview)throw new Error('데모 미리보기에서는 실제 API 키를 변경하지 않아요.');
    return queueLifecycle(async()=>{
    await service.stop();await vault.clear();credentialReady=false;
    await rememberMode('demo');await service.start('demo');publish();return snapshot();
    });
  });
  ipcMain.handle('chii:connect',async event=>{
    requireSender(event,true);return queueLifecycle(async()=>{
    if(!credentialReady)throw new Error('먼저 본인의 API 키를 저장해 주세요.');
    await rememberMode('live');await service.start('live');publish();return snapshot();
    });
  });
  ipcMain.handle('chii:demo',async event=>{
    requireSender(event,true);return queueLifecycle(async()=>{
    await rememberMode('demo');await service.start('demo');publish();return snapshot();
    });
  });
  ipcMain.handle('chii:search',async(event,query)=>{
    requireSender(event,true);if(typeof query!=='string'||query.length>80)throw new Error('검색어는 80자 이내로 입력해 주세요.');
    return service.searchStocks(query.trim());
  });
  ipcMain.handle('chii:portfolio-refresh',async event=>{
    requireSender(event,true);
    await service.refreshPortfolio();
    publish();return snapshot();
  });
  ipcMain.handle('chii:portfolio-select',async(event,id)=>{
    requireSender(event,true);
    if(!Number.isSafeInteger(id)||id<0)throw new Error('조회할 계좌를 다시 선택해 주세요.');
    await service.selectAccount(id);
    publish();return snapshot();
  });
  ipcMain.on('chii:interactive',(event,value)=>{
    if(validSender(event)&&event.sender===petWindow?.webContents&&typeof value==='boolean')petWindow.setIgnoreMouseEvents(!(value||petDrag.active),{forward:true});
  });
  ipcMain.on('chii:pet-drag-begin',(event,input)=>{
    if(validSender(event)&&event.sender===petWindow?.webContents){
      const press=petMousePress;petMousePress=null;
      if(petDrag.begin(input,press?.down)&&press?.released)petDrag.end(input.sessionId,'released',press.latest);
    }
  });
  ipcMain.on('chii:pet-drag-end',(event,input)=>{
    if(validSender(event)&&event.sender===petWindow?.webContents&&Number.isSafeInteger(input?.sessionId))petDrag.end(input.sessionId);
  });
  ipcMain.on('chii:motion',(event,action)=>{
    if(validSender(event)&&['idle','walk','happy','cry','sleep','talk'].includes(action)){showPet();broadcast('chii:motion',{action});}
  });
  ipcMain.on('chii:settings',event=>{if(validSender(event))showSettings();});
  ipcMain.on('chii:docs',event=>{if(validSender(event,true))shell.openExternal('https://developers.tossinvest.com/docs').catch(()=>{});});
  ipcMain.on('chii:hide-pet',event=>{if(validSender(event))petWindow?.hide();});
  ipcMain.on('chii:quit',event=>{if(validSender(event))app.quit();});
}

if(gotLock)app.whenReady().then(async()=>{
  Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([
    {label:'먼작주',submenu:[{label:'설정',click:showSettings},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'},{role:'windowMenu'}
  ]):null);
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const directory=app.getPath('userData');
  vault=createVault(directory,safeStorage);credentialReady=demoPreview ? false : await vault.exists();
  const config=await readConfig(directory,defaultConfig,normalizeConfig);
  if(!demoPreview)try{const saved=JSON.parse(await fs.readFile(path.join(directory,'session.json'),'utf8'));if(saved.mode==='live'&&credentialReady)preferredMode='live';else if(saved.mode==='offline')preferredMode='offline';}catch{}
  service=new MarketService({config,credentialProvider:()=>vault.read()});
  updates=new UpdateController({version:app.getVersion(),platform:process.platform,arch:process.arch,
    enabled:app.isPackaged&&!demoPreview,updater:process.platform==='win32'?electronUpdater.autoUpdater:undefined,openExternal:url=>shell.openExternal(url),
    beforeInstall:async()=>{await configWrite;}});
  updates.on('state',state=>{
    broadcast('chii:update-state',state);
    if(state.status!=='downloading')updateTray();
    if(state.status==='available'&&!announcedUpdates.has(state.latestVersion)){
      announcedUpdates.add(state.latestVersion);
      if(Notification.isSupported()){
        const notice=new Notification({title:`먼작주 ${state.latestVersion} 업데이트`,body:'새 버전이 있어요. 눌러서 업데이트를 확인해 주세요.',silent:true});
        notice.on('click',showSettings);
        // The pet bubble and tray remain available if the OS rejects a toast
        // (in particular, macOS notifications require a signed application).
        notice.on('failed',()=>{});
        try { notice.show(); } catch {}
      }
    }
  });
  service.on('state',publish);
  service.on('alert',alert=>broadcast('chii:motion',{action:alert.direction==='up'?'happy':'cry',alert}));
  service.on('bulletin',bulletin=>broadcast('chii:bulletin',bulletin));
  service.on('config',config=>{persistConfig(config).catch(()=>{});updateTray();});
  service.on('halt',()=>{
    const haltedEpoch=service.epoch;
    preferredMode='offline';resumeMode=null;
    queueLifecycle(()=>service.epoch===haltedEpoch&&!service.running ? rememberMode('offline') : undefined).catch(()=>{});
  });
  installIPC();showSettings();showPet();
  tray=new Tray(trayImage());tray.setToolTip(`먼작주 ${app.getVersion()}`);tray.on('click',showSettings);updateTray();
  updates.start();
  screen.on('display-metrics-changed',()=>{if(petDrag.active)petDrag.update();else petWindow?.setBounds(currentDisplay().workArea);updateTray();});
  screen.on('display-added',updateTray);
  screen.on('display-removed',()=>{petDrag.end(undefined,'display-removed');petWindow?.setBounds(currentDisplay().workArea);updateTray();});
  powerMonitor.on('suspend',()=>{
    petMousePress=null;
    petDrag.end(undefined,'suspend');
    resumeMode=service.running ? service.mode : null;
    suspended=true;service.stop();publish();
  });
  powerMonitor.on('resume',()=>{
    suspended=false;
    const mode=resumeMode;resumeMode=null;
    if(mode)queueLifecycle(()=>service.start(mode)).catch(()=>{});
    else publish();
  });
  if(preferredMode!=='offline')await queueLifecycle(()=>service.start(preferredMode));
}).catch(error=>{console.error('앱 초기화 실패:',error.message);app.quit();});

app.on('second-instance',()=>{showSettings();showPet();});
app.on('activate',()=>{if(service)showSettings();});
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>{quitting=true;petDrag.end(undefined,'quit');updates?.dispose();service?.stop();});
