import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd(), output=path.join(root,'qa');
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'desktop-profile-'));
const env={...process.env,CHII_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const launches=[];
async function launch(){
  const app=await electron.launch({args:[root],env,timeout:45000});launches.push(app);
  const deadline=Date.now()+30000;
  while(app.windows().length<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  const pages=app.windows();
  const dashboard=pages.find(page=>page.url().includes('index.html'));
  const pet=pages.find(page=>page.url().includes('pet.html'));
  assert.ok(dashboard,'settings window exists');assert.ok(pet,'pet window exists');
  await dashboard.waitForFunction(()=>document.querySelector('#stock-rows')?.children.length===20);
  return {app,dashboard,pet};
}
const consoleErrors=[];
try{
  const {app,dashboard,pet}=await launch();
  for(const page of [dashboard,pet])page.on('pageerror',error=>consoleErrors.push(error.message));
  const initial=await dashboard.evaluate(()=>window.chii.getState());
  assert.equal(initial.mode,'demo');assert.equal(initial.credentialsConfigured,false);assert.equal(initial.quotes.length,20);
  assert.equal(initial.config.intervalMinutes,5);assert.equal(initial.config.baseline,'previousClose');
  assert.equal(initial.config.speechScale,100);
  assert.ok(initial.quotes.every(quote=>typeof quote.price==='number'));
  assert.ok(await dashboard.getByText('데모 모드',{exact:true}).isVisible());
  await dashboard.screenshot({path:path.join(output,'dashboard.png')});
  const native=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({url:window.webContents.getURL(),alwaysOnTop:window.isAlwaysOnTop(),focusable:window.isFocusable(),visible:window.isVisible(),transparent:window.getBackgroundColor(),webPreferences:window.webContents.getLastWebPreferences()})));
  const overlay=native.find(window=>window.url.includes('pet.html'));
  assert.equal(overlay.alwaysOnTop,true);assert.equal(overlay.focusable,false);
  assert.ok(native.every(window=>window.webPreferences.contextIsolation&&window.webPreferences.sandbox&&!window.webPreferences.nodeIntegration));
  await dashboard.locator('[data-market="KR"]').click();assert.equal(await dashboard.locator('#stock-rows tr').count(),10);
  await dashboard.locator('[data-market="US"]').click();assert.equal(await dashboard.locator('#stock-rows tr').count(),10);
  await dashboard.locator('[data-market="ALL"]').click();
  await dashboard.locator('#add-stock').click();await dashboard.locator('#stock-search').fill('AAPL');
  await dashboard.waitForFunction(()=>document.querySelector('#search-results')?.innerText.includes('AAPL'));
  assert.equal(await dashboard.locator('#search-results .search-result').count(),1);
  await dashboard.locator('#search-dialog [data-close-dialog]').click();
  await dashboard.locator('[data-page="preferences"]').click();
  await dashboard.locator('#speech-scale-input').evaluate(input=>{input.value='140';input.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await dashboard.locator('#speech-scale-value').textContent(),'140%');
  await dashboard.evaluate(()=>window.chii.updateConfig({petSize:160}));
  assert.equal(await dashboard.locator('#speech-scale-input').inputValue(),'140','incoming state preserves speech draft');
  await dashboard.locator('#save-character').click();
  await pet.waitForFunction(()=>document.querySelector('#speech').style.getPropertyValue('--speech-scale')==='1.4');
  await dashboard.screenshot({path:path.join(output,'speech-settings-0.4.0.png')});
  await dashboard.locator('#interval-input').fill('7');await dashboard.locator('#baseline-select').selectOption('custom');
  await dashboard.locator('#save-notifications').click();
  await dashboard.waitForFunction(async()=>{const s=await window.chii.getState();return s.config.intervalMinutes===7&&s.config.baseline==='custom';});
  await dashboard.evaluate(()=>window.chii.updateConfig({intervalMinutes:5,baseline:'previousClose',roaming:false,petSize:180}));
  await dashboard.evaluate(()=>window.chii.previewMotion('happy'));
  await pet.waitForFunction(()=>document.querySelector('[data-character]')?.getAttribute('data-action')==='happy');
  await pet.screenshot({path:path.join(output,'pet-happy.png')});
  await app.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('pet.html'));
    window.webContents.send('chii:motion',{action:'cry',alert:{id:'qa-only',symbol:'005930',name:'삼성전자',price:65000,percent:-10.5,level:10,direction:'down',at:Date.now()}});
  });
  await pet.waitForFunction(()=>document.querySelector('[data-character]')?.getAttribute('data-action')==='cry');
  await pet.screenshot({path:path.join(output,'pet-cry.png')});
  const bodyBackground=await pet.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  assert.equal(bodyBackground,'rgba(0, 0, 0, 0)');
  await dashboard.evaluate(()=>window.chii.hidePet());
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('pet.html')).isVisible()),false);
  await dashboard.evaluate(()=>window.chii.previewMotion('idle'));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('pet.html')).isVisible()),true);
  await assert.rejects(dashboard.evaluate(()=>window.chii.setCredentials({clientId:'',clientSecret:''})),/형식/);
  await dashboard.evaluate(()=>window.chii.demo());
  assert.deepEqual(consoleErrors,[]);
  await app.close();
  const restarted=await launch();
  const restored=await restarted.dashboard.evaluate(()=>window.chii.getState());
  assert.equal(restored.config.petSize,180);assert.equal(restored.config.roaming,false);
  assert.equal(restored.config.speechScale,140);
  assert.equal(restored.mode,'demo');assert.equal(restored.credentialsConfigured,false);
  await restarted.app.close();
  await fs.writeFile(path.join(output,'desktop-smoke.json'),JSON.stringify({passed:true,platform:process.platform,arch:process.arch,at:new Date().toISOString(),checks:['isolated settings and pet windows','20 demo quotes / clear demo label','native always-on-top and non-focusable overlay','market filters and stock search','speech scale draft preserved, applied to pet, persisted after restart','settings persistence after restart','happy and crying event rendering','transparent overlay','hide and restore','invalid credentials rejected','no renderer errors'],native:native.map(({webPreferences,...item})=>item),consoleErrors},null,2));
  console.log('Desktop smoke passed. Evidence in qa/.');
}finally{
  for(const app of launches){try{await app.close();}catch{}}
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
