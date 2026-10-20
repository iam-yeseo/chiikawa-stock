/** Isolated renderer regression QA. Start Vite on 5177, then run this file. No API or credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.CHII_RENDERER_TEST_URL||'http://127.0.0.1:5177';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
async function pageFor({roaming=true,reducedMotion='no-preference',owned=false,intervalMinutes=5}={}){
  const page=await browser.newPage({viewport:{width:1200,height:800},reducedMotion});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(`${base}/`)?route.continue():route.abort());
  await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(({roaming,owned,intervalMinutes})=>{
    const quote={market:'KR',symbol:'005930',name:'삼성전자',price:75000,currency:'KRW',previousClose:70000,changePercent:7.14,updatedAt:Date.now(),stale:false};
    const quotes=owned?[quote,{market:'US',symbol:'AAPL',name:'애플',price:178.5,currency:'USD',previousClose:175,changePercent:2,updatedAt:Date.now(),stale:false}]:[quote];
    if(owned===3)quotes.push({market:'US',symbol:'MSFT',name:'마이크로소프트',price:420,currency:'USD',previousClose:400,changePercent:5,updatedAt:Date.now(),stale:false});
    const state={version:'test',mode:'demo',connection:{state:'connected',message:'Isolated mock'},config:{characterId:'chiikawa',petSize:150,speechScale:100,roaming,intervalMinutes,baseline:'previousClose',watchlist:quotes},quotes,alerts:[],portfolio:owned?{status:'ready',holdings:{items:quotes.map(item=>({...item,quantity:2}))}}:null};
    const qa=window.qa={state,time:0,raf:new Map(),nextRaf:1,begins:[],ends:[],interactive:[],samples:[],paintCalls:[],motion:null,update:null,bulletin:null,placement:null,ended:null};
    const drawImage=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...args){
      if(this.canvas.classList.contains('chii-art'))qa.paintCalls.push({time:qa.time,alpha:this.globalAlpha,mode:this.globalCompositeOperation});
      return drawImage.apply(this,args);
    };
    Object.defineProperty(performance,'now',{value:()=>qa.time});
    Math.random=()=>.5;
    window.requestAnimationFrame=callback=>{const id=qa.nextRaf++;qa.raf.set(id,callback);return id;};
    window.cancelAnimationFrame=id=>qa.raf.delete(id);
    qa.position=()=>{const rect=document.querySelector('#pet').getBoundingClientRect();return {x:rect.x,y:rect.y};};
    qa.advance=(duration,{alerts=false,bulletins=false,alertInterval=3000,bulletinInterval=1000,fullPortfolio=false}={})=>{
      const end=qa.time+duration;let nextAlert=qa.time,nextBulletin=qa.time;
      while(qa.time<end){
        if(alerts&&qa.time>=nextAlert){qa.motion({action:'happy',alert:{...quote,direction:'up',level:5,percent:7.14}});nextAlert+=alertInterval;}
        if(bulletins&&qa.time>=nextBulletin){qa.update(structuredClone(state));qa.bulletin({quotes:fullPortfolio?state.quotes:Array(20).fill(quote),at:Date.now()+qa.time});nextBulletin+=bulletinInterval;}
        qa.time=Math.min(end,qa.time+1000/60);
        const callbacks=[...qa.raf.values()];qa.raf.clear();callbacks.forEach(callback=>callback(qa.time));
        qa.samples.push({time:qa.time,...qa.position(),action:document.querySelector('[data-character]').dataset.action,speech:!document.querySelector('#speech').hidden,title:document.querySelector('#speech-title').textContent,kind:document.querySelector('#speech-kind').textContent});
      }
      return qa.position();
    };
    window.chii={
      getState:async()=>structuredClone(state),
      onState:fn=>(qa.update=fn,()=>{}),onMotion:fn=>(qa.motion=fn,()=>{}),onBulletin:fn=>(qa.bulletin=fn,()=>{}),
      updateConfig:async patch=>{Object.assign(state.config,patch);qa.update(structuredClone(state));return structuredClone(state);},
      setInteractive:value=>qa.interactive.push(value),showSettings(){},hidePet(){},
      beginPetDrag:value=>qa.begins.push(value),endPetDrag:value=>qa.ends.push(value),
      onPetPlacement:fn=>(qa.placement=fn,()=>{}),onPetDragEnded:fn=>(qa.ended=fn,()=>{}),
    };
  },{roaming,owned,intervalMinutes});
  await page.goto(`${base}/pet.html`);
  await page.waitForFunction(()=>window.qa?.motion&&window.qa?.ended);
  return page;
}
const displacement=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const results=[];
try{
  {
    const page=await pageFor({roaming:false,reducedMotion:'reduce'});
    await page.setViewportSize({width:800,height:600});
    await page.waitForFunction(()=>{
      qa.advance(17);
      const canvas=document.querySelector('.chii-art');
      return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0);
    },null,{polling:50});
    for(const size of [80,290,300]){
      await page.evaluate(size=>window.chii.updateConfig({petSize:size,speechScale:160}),size);
      await page.evaluate(()=>qa.advance(17));
      await page.waitForFunction(size=>document.querySelector('#pet-character').getBoundingClientRect().width===size,size);
      const dimensions=await page.locator('#pet-character').boundingBox();
      assert.equal(dimensions.width,size);
      assert.equal(dimensions.height,size);
      await page.evaluate(()=>qa.bulletin({quotes:qa.state.quotes,at:Date.now()+qa.time+1}));
      const bubble=await page.locator('#speech').boundingBox();
      // offsetWidth/offsetHeight round the scaled bubble while the DOM rectangle
      // retains fractional pixels; allow that rounding inside the screen margin.
      assert(bubble.x>=11&&bubble.x+bubble.width<=789,JSON.stringify(bubble));
      assert(bubble.y>=11&&bubble.y+bubble.height<=589,JSON.stringify(bubble));
      await page.mouse.move(dimensions.x+size/2,dimensions.y+size/2);await page.mouse.down();
      const begin=await page.evaluate(()=>qa.begins.at(-1));
      assert.equal(begin.size,size,'native drag receives the exact configured size');
      await page.evaluate(id=>qa.ended({sessionId:id,reason:'released'}),begin.sessionId);
      await page.mouse.up();
    }
    await page.screenshot({path:'/tmp/chiikawa-pet-300-small-viewport.png'});
    results.push({case:'80, 290, 300 pixel size + native drag + 160% speech on 800×600',sizes:[80,290,300]});
    await page.close();
  }
  {
    const page=await pageFor({roaming:false});
    const voices=[];
    for(const id of ['hachiware','chiikawa','usagi']){
      await page.evaluate(id=>window.chii.updateConfig({characterId:id}),id);
      await page.waitForFunction(()=>{
        qa.advance(17);
        const canvas=document.querySelector('.chii-art');
        return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0);
      },null,{polling:50});
      await page.evaluate(()=>{
        qa.paintCalls=[];
        for(const action of ['walk','happy','cry']){qa.motion({action});qa.advance(2500);}
        qa.bulletin({quotes:qa.state.quotes,at:Date.now()+qa.time});
      });
      const result=await page.evaluate(()=>({
        calls:qa.paintCalls,title:document.querySelector('#speech-title').textContent,
        voice:document.querySelector('#speech-voice').textContent,body:document.querySelector('#speech-body').textContent,
      }));
      assert(result.calls.length>10,'poses should actually change during the sampled motions');
      assert(result.calls.every(call=>call.alpha===1&&call.mode==='source-over'),'every pose is painted opaque without additive blending');
      assert.equal(new Set(result.calls.map(call=>call.time)).size,result.calls.length,'each animation frame paints at most one pose, preventing ghost limbs');
      assert.equal(result.title,'삼성전자 75,000원');
      assert.equal(result.body,'전일 종가 대비 +7.14%');
      if(id==='chiikawa')assert.match(result.voice,/^[응와아흐으앙에…!?.\s]+$/u);
      if(id==='usagi')assert.match(result.voice,/^[우냐라야하…!?.\s]+$/u);
      if(id==='hachiware')assert.match(result.voice,/있잖아/);
      await page.evaluate(()=>qa.motion({action:'happy',alert:{symbol:'005930',name:'삼성전자',market:'KR',direction:'up',level:5,percent:7.14,price:75000}}));
      assert.equal(await page.locator('#speech-title').textContent(),'삼성전자 +7.14%');
      assert.equal(await page.locator('#speech-body').textContent(),'현재가 75,000원');
      voices.push({character:id,bulletin:result.voice,rise:await page.locator('#speech-voice').textContent(),opaquePosePaints:result.calls.length});
    }
    results.push({case:'one opaque raster pose per frame + character voices separate from factual prices',voices});
    await page.close();
  }
  {
    const page=await pageFor();
    const before=await page.evaluate(()=>qa.position());
    const after=await page.evaluate(()=>qa.advance(25000,{bulletins:true}));
    const sample=await page.evaluate(()=>qa.samples.find(sample=>sample.action==='walk'&&sample.speech));
    assert(displacement(before,after)>250,'ordinary speech/state delivery must allow clearly visible travel');
    assert(sample,'the speech bubble should follow an actively walking pet');
    assert(sample.time<=3000,`startup walking took ${sample.time}ms`);
    results.push({case:'continuous speech + same-state updates',distance:displacement(before,after),firstWalk:sample.time});
    await page.close();
  }
  for(const alertInterval of [3000,500]){
    const page=await pageFor({owned:true});
    const firstTitle=await page.evaluate(()=>{qa.bulletin({quotes:qa.state.quotes,at:Date.now()});return document.querySelector('#speech-title').textContent;});
    assert.equal(firstTitle,'삼성전자 75,000원','the first owned stock is reported at the scheduled interval');
    await page.evaluate(alertInterval=>qa.advance(12000,{alerts:true,alertInterval}),alertInterval);
    const second=await page.evaluate(()=>qa.samples.find(sample=>sample.title==='애플 $178.50'&&sample.kind==='데모 · 보유종목 소식'));
    assert(second&&second.time<=12000,`the second held stock was starved by alerts every ${alertInterval}ms`);
    results.push({case:`two held stocks reported under ${alertInterval}ms alerts`,firstTitle,secondTitle:second.title,secondReportAt:second.time});
    await page.close();
  }
  {
    const page=await pageFor({owned:3,intervalMinutes:.1});
    await page.evaluate(()=>qa.advance(12000,{alerts:true,alertInterval:500,bulletins:true,bulletinInterval:6000,fullPortfolio:true}));
    const reports=await page.evaluate(()=>['삼성전자 75,000원','애플 $178.50','마이크로소프트 $420.00'].map(title=>qa.samples.find(sample=>sample.title===title&&sample.kind==='데모 · 보유종목 소식')).map(sample=>sample&&({title:sample.title,time:sample.time})));
    assert(reports.every(Boolean),'a fresh six-second bulletin must preserve unread holdings before repeating the first stock');
    results.push({case:'three held stocks, six-second bulletins and half-second alerts',reports});
    await page.close();
  }
  {
    const page=await pageFor();
    const before=await page.evaluate(()=>qa.position());
    const after=await page.evaluate(()=>qa.advance(60000,{alerts:true,bulletins:true}));
    const first=await page.evaluate(start=>qa.samples.find(sample=>Math.hypot(sample.x-start.x,sample.y-start.y)>1),before);
    assert(first&&first.time<=5000,`continuous alerts delayed visible movement: ${first?.time}`);
    assert(displacement(before,after)>400,'continuous alerts must leave meaningful travel');
    results.push({case:'every-three-second alerts',distance:displacement(before,after),firstVisibleMovement:first.time});
    await page.screenshot({path:'/tmp/chiikawa-roaming-v030.png'});
    await page.close();
  }
  {
    const page=await pageFor();
    const before=await page.evaluate(()=>qa.position());
    const after=await page.evaluate(()=>qa.advance(60000,{alerts:true,bulletins:true,alertInterval:500}));
    const first=await page.evaluate(start=>qa.samples.find(sample=>Math.hypot(sample.x-start.x,sample.y-start.y)>1),before);
    assert(first&&first.time<=5000,`dense alert bursts delayed visible movement: ${first?.time}`);
    assert(displacement(before,after)>250,'dense alert bursts must still allow movement across the screen');
    assert.equal(await page.locator('#speech-kind').textContent(),'데모 · 상승 5% 도달','alerts remain visible immediately even when their pose waits');
    results.push({case:'every-half-second alerts',distance:displacement(before,after),firstVisibleMovement:first.time});
    await page.close();
  }
  for(const options of [{roaming:false},{reducedMotion:'reduce'}]){
    const page=await pageFor(options),before=await page.evaluate(()=>qa.position());
    const after=await page.evaluate(()=>qa.advance(90000,{alerts:true,bulletins:true}));
    assert.equal(displacement(before,after),0,'user pause and reduced-motion preference must be respected');
    results.push({case:JSON.stringify(options),distance:0});
    await page.close();
  }
  {
    const page=await pageFor();
    const rect=await page.locator('#pet-character').boundingBox();
    await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
    const begin=await page.evaluate(()=>qa.begins.at(-1));assert(begin?.sessionId);
    await page.evaluate(id=>qa.ended({sessionId:id+1,reason:'error'}),begin.sessionId);
    assert.equal(await page.locator('#pet').getAttribute('data-drag-mode'),'native','stale terminal must not end a newer drag');
    await page.evaluate(id=>qa.placement({sessionId:id,sequence:1,x:360,y:420,viewport:{width:1200,height:800},displayId:2,dragging:true,cursor:{x:435,y:495}}),begin.sessionId);
    const placement=await page.evaluate(()=>qa.position());assert.deepEqual(placement,{x:360,y:420});
    await page.evaluate(id=>qa.ended({sessionId:id,reason:'error'}),begin.sessionId);
    assert.equal(await page.locator('#pet').getAttribute('data-drag-mode'),null,'host error terminal must release native drag');
    await page.mouse.up();
    const after=await page.evaluate(()=>qa.advance(5000));
    assert(displacement(placement,after)>40,'walking must resume promptly after terminal drag failure');
    results.push({case:'native handoff + stale terminal ignored + error terminal',distanceAfterRelease:displacement(placement,after)});
    await page.close();
  }
  {
    const page=await pageFor();
    const before=await page.evaluate(()=>qa.position());
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));qa.advance(60000);});
    assert.equal(displacement(before,await page.evaluate(()=>qa.position())),0);
    const after=await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));return qa.advance(5000);});
    assert(displacement(before,after)>40,'visible pet should resume promptly after a bounded short delay');
    results.push({case:'hidden then visible',distanceAfterResume:displacement(before,after)});
    await page.close();
  }
  assert.deepEqual(errors,[],'renderer console must remain clean');
  const report={passed:results.length,results,errors,screenshot:'/tmp/chiikawa-roaming-v030.png'};
  await fs.writeFile('qa/roaming-renderer-0.3.0.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
