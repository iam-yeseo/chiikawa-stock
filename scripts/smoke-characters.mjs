import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),manifest=JSON.parse(await fs.readFile('package.json','utf8'));
const packaged=process.argv.includes('--packaged'),suffix=packaged?'-packaged':'';
const output=path.join(root,'qa'),version=manifest.version;
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(output,'characters-profile-'));
const env={...process.env,CHII_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
function packagedExecutable(){
  const relative=process.platform==='darwin'
    ?`${process.arch==='arm64'?'mac-arm64':'mac'}/${manifest.build.executableName || manifest.productName}.app/Contents/MacOS/${manifest.build.executableName || manifest.productName}`
    :process.platform==='win32'?`win-unpacked/${manifest.build.executableName || manifest.productName}.exe`:null;
  assert.ok(relative,'packaged character smoke supports Windows and macOS');
  return path.resolve(manifest.build.directories.output,relative);
}
const launchOptions=packaged?{executablePath:packagedExecutable(),args:['--demo-preview']}:{args:[root]};
const launches=[],errors=[],started=Date.now();
const report={passed:false,version,packaged,platform:process.platform,arch:process.arch,mode:'isolated demo',selection:[],characters:[],errors};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let failure;
async function launch(){
  const app=await electron.launch({...launchOptions,env,timeout:30000});launches.push(app);
  const deadline=Date.now()+15000;
  while(Date.now()<deadline&&!['index.html','pet.html'].every(name=>app.windows().some(page=>page.url().includes(name))))await pause(50);
  const dashboard=app.windows().find(page=>page.url().includes('index.html'));
  const pet=app.windows().find(page=>page.url().includes('pet.html'));
  assert.ok(dashboard&&pet,'settings and desktop character windows exist');
  for(const page of [dashboard,pet]){page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));}
  await dashboard.waitForFunction(()=>document.querySelectorAll('#stock-rows tr').length===20);
  await pet.waitForFunction(()=>document.querySelector('[data-character]')?.dataset.frame!==undefined);
  const native=await app.evaluate(({app})=>({packaged:app.isPackaged,profile:app.getPath('userData'),version:app.getVersion()}));
  assert.equal(native.profile,profile);assert.equal(native.packaged,packaged);assert.equal(native.version,version);
  return {app,dashboard,pet};
}
async function readPose(pet){
  return pet.evaluate(()=>{
    const root=document.querySelector('#pet-character [data-character]');
    return {character:root.dataset.character,action:root.dataset.action,frame:Number(root.dataset.frame),phase:root.dataset.phase,tears:root.dataset.tears,reducedMotion:root.dataset.reducedMotion,transform:root.querySelector('.chii-body').style.transform};
  });
}
async function canvasFingerprint(pet){
  return pet.evaluate(()=>{
    const canvas=document.querySelector('#pet-character canvas');
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let hash=2166136261,visible=0,bodyPixels=0,nearOpaque=0,opaqueWhite=0,minX=canvas.width,minY=canvas.height,maxX=0,maxY=0;
    for(let i=0;i<pixels.length;i++){
      hash=Math.imul(hash^pixels[i],16777619);
      if(i%4===3&&pixels[i]){
        visible++;if(pixels[i]>=64)bodyPixels++;if(pixels[i]>=250){nearOpaque++;if(pixels[i-3]>235&&pixels[i-2]>235&&pixels[i-1]>235)opaqueWhite++;}
        const x=((i-3)/4)%canvas.width,y=Math.floor(((i-3)/4)/canvas.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      }
    }
    return {hash:(hash>>>0).toString(16),visible,bodyPixels,nearOpaque,opaqueWhite,bounds:{minX,minY,maxX,maxY},width:canvas.width,height:canvas.height};
  });
}
async function cropPet(pet,filename){
  const box=await pet.locator('#pet-character').boundingBox();
  const viewport=await pet.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const x=Math.max(0,box.x-28),y=Math.max(0,box.y-28);
  await pet.screenshot({path:path.join(output,filename),clip:{x,y,width:Math.min(viewport.width-x,box.width+56),height:Math.min(viewport.height-y,box.height+56)}});
}
try{
  const {app,dashboard,pet}=await launch();
  const initial=await dashboard.evaluate(()=>window.chii.getState());
  assert.equal(initial.mode,'demo');assert.equal(initial.credentialsConfigured,false);
  assert.equal(initial.config.characterId,'chiikawa');
  // Keep the synthetic market below all thresholds so scheduled demo reactions do
  // not replace the explicit poses being observed. This never touches a real profile.
  await dashboard.evaluate(async()=>{
    const state=await window.chii.getState();
    await window.chii.updateConfig({roaming:false,baseline:'custom',watchlist:state.config.watchlist.map(stock=>({...stock,referencePrice:1e9}))});
  });
  const before=await dashboard.evaluate(()=>window.chii.getState());
  await dashboard.locator('[data-page="preferences"]').click();
  assert.equal(await dashboard.locator('#character-choices[role="radiogroup"]').count(),1);
  assert.equal(await dashboard.locator('.character-choice[role="radio"]:not(:disabled)').count(),3);
  await dashboard.locator('#speech-scale-input').evaluate(input=>{input.value='150';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await dashboard.locator('#interval-input').fill('11');
  async function selected(id,input){
    await input();
    await dashboard.waitForFunction(id=>document.querySelector(`.character-choice[data-character-id="${id}"]`)?.getAttribute('aria-checked')==='true',id);
    await pet.waitForFunction(id=>document.querySelector('#pet-character [data-character]')?.dataset.character===id,id);
    await dashboard.waitForFunction(()=>!document.querySelector('#character-choices').hasAttribute('aria-busy'));
    assert.equal(await dashboard.locator('.character-choice[aria-checked="true"]').count(),1);
    assert.equal(await dashboard.locator('.character-choice[tabindex="0"]').count(),1);
    assert.equal(await dashboard.locator('#speech-scale-input').inputValue(),'150');
    assert.equal(await dashboard.locator('#interval-input').inputValue(),'11');
    const state=await dashboard.evaluate(()=>window.chii.getState());
    assert.deepEqual(state.config,{...before.config,characterId:id});
    assert.equal(state.credentialsConfigured,false);
    assert.deepEqual(state.portfolio.holdings,before.portfolio.holdings);
    const name={chiikawa:'치이카와',hachiware:'하치와레',usagi:'우사기'}[id];
    assert.equal(await dashboard.locator('#active-friend-name').textContent(),name);
    assert.match(await dashboard.locator('#companion-title').textContent(),new RegExp(name));
    assert.equal(await dashboard.locator('.companion-card').getAttribute('data-character'),id);
    report.selection.push({id,name,draftsPreserved:true,persistedConfigPreserved:true});
  }
  const card=id=>dashboard.locator(`.character-choice[data-character-id="${id}"]`);
  await selected('hachiware',()=>card('hachiware').click());
  await selected('usagi',()=>card('hachiware').press('ArrowRight'));
  await selected('chiikawa',()=>card('usagi').press('Home'));
  await selected('usagi',()=>card('chiikawa').press('End'));
  await selected('hachiware',()=>card('usagi').press('ArrowLeft'));
  await selected('chiikawa',()=>card('chiikawa').click());
  await selected('usagi',()=>card('usagi').click());
  await dashboard.screenshot({path:path.join(output,`characters-settings-${version}${suffix}.png`),fullPage:true,style:'#toast{visibility:hidden}'});
  for(const id of ['chiikawa','hachiware','usagi']){
    await selected(id,()=>card(id).click());
    await dashboard.evaluate(()=>window.chii.previewMotion('idle'));
    await pet.waitForFunction(()=>document.querySelector('#pet-character [data-character]')?.dataset.action==='idle');
    await pause(120);
    const fingerprint=await canvasFingerprint(pet);
    const entry={id,fingerprint,actions:[],sizes:[]};report.characters.push(entry);
    assert.ok(fingerprint.visible>100,'actual character art is drawn on canvas');
    assert.ok(fingerprint.nearOpaque/fingerprint.bodyPixels>.8,'body pixels retain at least 98% alpha instead of transparent white fills');
    assert.ok(fingerprint.bounds.minY>0&&fingerprint.bounds.maxY<fingerprint.height-1,'ears and feet fit inside the canvas');
    for(const [tone,color] of [['light','#fffdf4'],['dark','#262936']]){
      await pet.evaluate(color=>document.body.style.setProperty('background-color',color,'important'),color);
      await cropPet(pet,`character-${id}-idle-${tone}-${version}${suffix}.png`);
    }
    await pet.evaluate(()=>document.body.style.removeProperty('background-color'));
    for(const size of [90,280]){
      await dashboard.evaluate(size=>window.chii.updateConfig({petSize:size}),size);
      await pet.waitForFunction(size=>document.querySelector('#pet-character [data-character]')?.style.width===`${size}px`,size);
      await pause(120);
      const art=await canvasFingerprint(pet);entry.sizes.push({size,...art});
      assert.ok(art.nearOpaque/art.bodyPixels>.8,`${id} ${size}px body remains filled`);
      assert.ok(art.bounds.minY>0&&art.bounds.maxY<art.height-1,`${id} ${size}px ears and feet fit the canvas`);
      await pet.evaluate(()=>document.body.style.setProperty('background-color','#262936','important'));
      await cropPet(pet,`character-${id}-idle-dark-${size}px-${version}${suffix}.png`);
      await pet.evaluate(()=>document.body.style.removeProperty('background-color'));
    }
    await dashboard.evaluate(()=>window.chii.updateConfig({petSize:150}));
    await pet.waitForFunction(()=>document.querySelector('#pet-character [data-character]')?.style.width==='150px');
    for(const [action,duration] of [['walk',850],['happy',3300],['cry',2850]]){
      await dashboard.locator(`[data-preview-action="${action}"]`).click();
      await pet.waitForFunction(action=>document.querySelector('#pet-character [data-character]')?.dataset.action===action,action);
      const actionStarted=Date.now(),samples=[];let screenshot=false;
      while(Date.now()-actionStarted<duration){
        const pose=await readPose(pet);assert.equal(pose.character,id);assert.equal(pose.action,action,'explicit preview is not replaced during observation');
        if(id==='usagi')assert.equal(pose.tears,'still','Usagi decline uses a brief pause and light foot tap, never tear streams');
        samples.push({ms:Date.now()-actionStarted,...pose});
        if(!screenshot&&Date.now()-actionStarted>=(action==='walk'?260:action==='happy'?1180:1100)){
          await cropPet(pet,`character-${id}-${action}-${version}${suffix}.png`);screenshot=true;
        }
        await pause(75);
      }
      assert.ok(new Set(samples.map(sample=>sample.frame)).size>=2,`${id} ${action} advances raster poses`);
      assert.ok(new Set(samples.map(sample=>sample.transform)).size>=2,`${id} ${action} has interpolated movement`);
      if(action!=='walk')assert.ok(new Set(samples.map(sample=>sample.phase)).size>=2,`${id} ${action} advances reaction phases`);
      if(action==='cry'&&id!=='usagi')assert.ok(samples.some(sample=>sample.tears==='flowing'),`${id} tears are rendered during decline`);
      if(action==='cry'&&id==='hachiware')assert.equal(samples.at(-1).phase,'gather-courage');
      entry.actions.push({action,samples});
    }
    await pet.emulateMedia({reducedMotion:'reduce'});
    await pet.waitForFunction(()=>document.querySelector('#pet-character [data-character]')?.dataset.reducedMotion==='true');
    for(const action of ['walk','happy','cry']){
      await dashboard.evaluate(action=>window.chii.previewMotion(action),action);
      await pet.waitForFunction(action=>{const r=document.querySelector('#pet-character [data-character]');return r?.dataset.action===action&&r?.dataset.phase==='reduced-motion';},action);
      await pause(100);const first=await readPose(pet);await pause(160);const last=await readPose(pet);
      assert.deepEqual(last,first,`${id} ${action} reduced-motion pose stays still`);assert.equal(last.tears,'still');
    }
    entry.reducedMotionStatic=true;
    await pet.emulateMedia({reducedMotion:'no-preference'});
  }
  assert.equal(new Set(report.characters.map(entry=>entry.fingerprint.hash)).size,3,'all three characters draw distinct artwork');
  assert.deepEqual(errors,[]);
  await app.close();
  const restarted=await launch();
  const restored=await restarted.dashboard.evaluate(()=>window.chii.getState());
  assert.deepEqual(restored.config,{...before.config,characterId:'usagi'});
  await restarted.pet.waitForFunction(()=>document.querySelector('#pet-character [data-character]')?.dataset.character==='usagi');
  assert.equal(restored.mode,'demo');assert.equal(restored.credentialsConfigured,false);
  assert.deepEqual(errors,[]);
  report.restartPreservedSelection=true;report.unsavedDraftsNotPersisted=true;report.passed=true;
}catch(error){failure=error;report.failure=error.stack||String(error);}
finally{
  for(const app of launches){try{await app.close();}catch{}}
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  report.profileCleaned=await fs.access(profile).then(()=>false,()=>true);report.elapsedMs=Date.now()-started;
  await fs.writeFile(path.join(output,`characters-${version}${suffix}.json`),JSON.stringify(report,null,2));
}
if(failure)throw failure;
console.log(`Character selection, personalities, reduced motion, and restart passed (${(report.elapsedMs/1000).toFixed(1)}s).`);
