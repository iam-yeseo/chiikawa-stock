import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
const root=process.cwd();
const profile=await fs.mkdtemp(path.join(root,'qa/multimonitor-profile-'));
const env={...process.env,CHII_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let app;
const records=[];
try {
  app=await electron.launch({args:[root],env,timeout:45000});
  const dashboard=await app.firstWindow();
  await dashboard.waitForSelector('#stock-rows');
  const pet=app.windows().find(w=>w.url().includes('pet.html'));
  await pet.waitForSelector('#pet-character');
  await dashboard.evaluate(()=>window.chii.updateConfig({roaming:false}));
  await app.evaluate(({BrowserWindow})=>{
    BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).hide();
    const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('pet.html'));
    const original=w.setIgnoreMouseEvents.bind(w);
    w.__qaIgnore=true;w.__qaMouse=[];
    w.setIgnoreMouseEvents=(ignore,options)=>{w.__qaIgnore=ignore;return original(ignore,options);};
    w.webContents.on('before-mouse-event',(_e,m)=>{if(['mouseDown','mouseUp'].includes(m.type))w.__qaMouse.push({type:m.type,button:m.button,x:m.x,y:m.y,globalX:m.globalX,globalY:m.globalY});});
  });
  await pet.evaluate(()=>{
    window.dragPackets=[];window.pointerEvents=[];
    window.chii.onPetPlacement(p=>{window.dragPackets.push(p);if(window.dragPackets.length>600)window.dragPackets.shift();});
    for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,e=>window.pointerEvents.push({type,clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY,buttons:e.buttons}));
  });
  async function inspect(label){
    const native=await app.evaluate(({screen,BrowserWindow})=>{
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('pet.html'));
      return {displays:screen.getAllDisplays().map(({id,bounds,workArea,scaleFactor})=>({id,bounds,workArea,scaleFactor})),bounds:w.getBounds(),cursor:screen.getCursorScreenPoint(),ignore:w.__qaIgnore,mouse:w.__qaMouse};
    });
    const renderer=await pet.evaluate(()=>({rect:document.querySelector('#pet').getBoundingClientRect().toJSON(),dragging:document.querySelector('#pet').classList.contains('dragging'),packets:window.dragPackets.slice(-4),visitedDisplays:[...new Set(window.dragPackets.map(p=>p.displayId))],events:window.pointerEvents}));
    const record={label,native,renderer};records.push(record);console.log(JSON.stringify(record));
  }
  await inspect('ready');
  for await(const line of readline.createInterface({input:process.stdin})){
    const command=line.trim();
    if(command==='finish')break;
    if(command.startsWith('record '))await inspect(command.slice(7));
    else if(command==='hide')await dashboard.evaluate(()=>window.chii.hidePet());
  }
  await fs.writeFile('qa/multimonitor-native.json',JSON.stringify({at:new Date().toISOString(),platform:process.platform,arch:process.arch,records},null,2));
}finally{
  if(app)await app.close();
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  process.stdin.unref?.();
}
