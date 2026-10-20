import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),manifest=JSON.parse(await fs.readFile('package.json','utf8'));
const packaged=process.argv.includes('--packaged');
const characterId=process.argv.find(arg=>arg.startsWith('--character='))?.split('=')[1]||'chiikawa';
assert.ok(['chiikawa','hachiware','usagi'].includes(characterId));
const profile=await fs.mkdtemp(path.join(root,'qa/roaming-profile-'));
const env={...process.env,CHII_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const options=packaged?{executablePath:path.resolve(manifest.build.directories.output,`${process.arch==='arm64'?'mac-arm64':'mac'}/${manifest.build.executableName || manifest.productName}.app/Contents/MacOS/${manifest.build.executableName || manifest.productName}`),args:['--demo-preview']}:{args:[root]};
let app;const samples=[],errors=[];
try{
  app=await electron.launch({...options,env,timeout:45000});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&!['index.html','pet.html'].every(name=>app.windows().some(page=>page.url().includes(name))))await new Promise(resolve=>setTimeout(resolve,100));
  const dashboard=app.windows().find(page=>page.url().includes('index.html'));
  const pet=app.windows().find(page=>page.url().includes('pet.html'));assert.ok(dashboard&&pet,'settings and pet ready');
  await dashboard.waitForSelector('#stock-rows');
  await dashboard.evaluate(id=>window.chii.updateConfig({characterId:id}),characterId);
  await pet.waitForFunction(id=>document.querySelector('[data-character]')?.dataset.character===id,characterId);
  pet.on('pageerror',error=>errors.push(error.message));
  await pet.waitForFunction(()=>document.querySelector('#pet')?.style.transform);
  const sample=async(label)=>{
    const value=await pet.evaluate(()=>{
      const r=document.querySelector('#pet').getBoundingClientRect();
      return {x:r.x,y:r.y,action:document.querySelector('[data-character]')?.dataset.action,speech:!document.querySelector('#speech').hidden,dragging:document.querySelector('#pet').classList.contains('dragging')};
    });samples.push({at:Date.now(),label,...value});return value;
  };
  const start=await sample('initial');
  // Real wall-clock frames: the demo continually generates quotes and threshold reactions.
  // Inject a full bulletin immediately so this also covers the old 114-second speech blockade.
  await app.evaluate(async({BrowserWindow})=>{
    const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('pet.html'));
    const state=await w.webContents.executeJavaScript('window.chii.getState()');
    w.webContents.send('chii:bulletin',{quotes:state.quotes,at:Date.now()});
  });
  for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,1500));await sample('roaming-with-bulletins-and-alerts');}
  const firstMovement=samples.find(s=>Math.hypot(s.x-start.x,s.y-start.y)>=5);
  const maxDisplacement=Math.max(...samples.map(s=>Math.hypot(s.x-start.x,s.y-start.y)));
  assert.ok(firstMovement&&firstMovement.at-samples[0].at<=8000,'pet visibly starts moving within eight seconds even with continuous alerts');
  assert.ok(maxDisplacement>=60,'pet travels visibly across the screen, at least60px during30seconds of continuous alerts');
  const movedWithSpeech=samples.some(s=>s.speech&&Math.hypot(s.x-start.x,s.y-start.y)>=5);assert.ok(movedWithSpeech,'ordinary speech does not block roaming');
  await dashboard.evaluate(()=>window.chii.updateConfig({roaming:false}));
  const resting=await sample('roaming-disabled');
  for(let i=0;i<3;i++){await new Promise(resolve=>setTimeout(resolve,1500));const s=await sample('disabled');assert.ok(Math.hypot(s.x-resting.x,s.y-resting.y)<.2,'explicit rest stays still');}
  await dashboard.evaluate(()=>window.chii.updateConfig({roaming:true}));
  for(let i=0;i<12;i++){await new Promise(resolve=>setTimeout(resolve,1000));await sample('resumed');}
  assert.ok(samples.filter(s=>s.label==='resumed').some(s=>Math.hypot(s.x-resting.x,s.y-resting.y)>=3),'roaming resumes after toggle under alerts');
  assert.deepEqual(errors,[]);
  await fs.writeFile(`qa/roaming-${manifest.version}${characterId==='chiikawa'?'':'-'+characterId}${packaged?'-packaged':''}.json`,JSON.stringify({passed:true,characterId,version:manifest.version,packaged,platform:process.platform,arch:process.arch,mode:'isolated demo with real wall-clock frames',movedWithSpeech,firstMovementMs:firstMovement.at-samples[0].at,maxDisplacement,samples,errors},null,2));
  console.log('Real-time roaming, continuous alerts + bulletin, explicit rest and resume passed.');
}finally{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
