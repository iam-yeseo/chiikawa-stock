import './pet.css';
import {bridge, isDesktop} from './bridge.js';
import {mountCharacter} from './character.js';
import {getCharacterProfile, DEFAULT_CHARACTER_ID} from '../lib/characters.js';
import {PET_SIZE} from '../lib/config.js';
import {petBounds, clampPetPosition} from '../lib/pet-geometry.js';
import {PetRoamingSchedule, chooseRoamingTarget} from '../lib/pet-roaming.js';
import {speechPlacement} from '../lib/speech-layout.js';

const pet = document.querySelector('#pet');
const hitbox = document.querySelector('#pet-character');
const speech = document.querySelector('#speech');
const speechVoice = document.createElement('p');
speechVoice.id='speech-voice';speechVoice.className='speech-voice';speechVoice.hidden=true;
document.querySelector('#speech-body').before(speechVoice);
const menu = document.querySelector('#pet-menu');
const character = mountCharacter(hitbox);
let snapshot = null, size = PET_SIZE.default, speechScale = 1, x = 0, y = 0, target = null, lastNow = performance.now();
let profile=getCharacterProfile(DEFAULT_CHARACTER_ID);
const roaming=new PetRoamingSchedule({now:performance.now(),idleMs:profile.motion.idleMs});
let reactionUntil = 0, reactionAction = '', dragging = null,pendingMotion=null;
let walkBurstStarted=0,walkBurstUntil=0,walkPauseUntil=0,stepping=false;
let walkPace=1,turnDuringWalk=false;
const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
let speechUntil = 0, bulletinQueue = [], lastBulletin = 0, nextBulletinAt = 0, currentInteractive = false, stopped = false, bulletinTimer;
let previousMode = null, previousConnectionState = null;
let speechVoiceKey=null,speechTitleKey=null;
let pointerPosition = null, nextHitTestAt = 0;
const nativeDraggingAvailable=isDesktop && ['beginPetDrag','endPetDrag','onPetPlacement'].every(name=>typeof bridge[name]==='function');
let dragSessionCounter=0,nativeViewport=null;
const disposers = [];
const randomRange=([low,high])=>low+Math.random()*(high-low);
const ease=value=>{const n=Math.max(0,Math.min(1,value));return n*n*(3-2*n);};
function stopWalking(delay=2000){target=null;stepping=false;walkBurstUntil=0;walkPauseUntil=0;turnDuringWalk=false;roaming.resume(performance.now(),delay);}
function finishWalk(now){target=null;stepping=false;walkBurstUntil=0;walkPauseUntil=0;turnDuringWalk=false;roaming.rest(now);}
function walkingEnabled(){return snapshot?.config.roaming && !motionPreference.matches && !dragging && menu.hidden && !document.hidden;}
const money = (price, currency = 'KRW') => Number.isFinite(price) ? (currency === 'USD' ? `$${price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : `${Math.round(price).toLocaleString('ko-KR')}원`) : '가격 확인 중';
const pct = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '기준가 확인 중';
function viewport(){return dragging?.native && nativeViewport ? nativeViewport : {width:innerWidth,height:innerHeight};}
function bounds() {return petBounds(viewport(),size);}
function placeSpeech() {
  if (speech.hidden) return;
  const placement = speechPlacement({pet:{x,y,size},viewport:viewport(),
    bubble:{width:speech.offsetWidth,height:speech.offsetHeight},gap:16*speechScale});
  speech.style.left=`${placement.left}px`;speech.style.top=`${placement.top}px`;
  speech.style.setProperty('--speech-tail',`${placement.tailLeft}px`);
  speech.dataset.side=placement.side;
}
const speechObserver = new ResizeObserver(placeSpeech);
speechObserver.observe(speech);
function place({clamp=!dragging?.native}={}) {
  const view=viewport();
  if(clamp)({x,y}=clampPetPosition({x,y},view,size));
  pet.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  pet.classList.toggle('speech-below',y < 180);
  placeSpeech();
}
function showSpeech({kind='먼작주',title,voiceKey=null,body='',meta='',tone='normal',duration=8000}) {
  speechVoiceKey=voiceKey;
  const voice=profile.speech[voiceKey]||'';
  speechTitleKey=Object.keys(profile.speech).find(key=>profile.speech[key]===title)||null;
  document.querySelector('#speech-kind').textContent = kind;
  document.querySelector('#speech-title').textContent = title;
  document.querySelector('#speech-body').textContent = body;
  document.querySelector('#speech-meta').textContent = meta;
  speechVoice.textContent=voice;speechVoice.hidden=!voice;
  speechVoice.setAttribute('aria-label',`${profile.name}: ${voice}`);
  speechVoice.dataset.speaker=profile.id;
  speech.dataset.tone = tone; speech.hidden = false; speechUntil = performance.now()+duration;
  place();
}
function hideSpeech() {speech.hidden = true; speechUntil = 0;}
function quoteSpeech(quote) {
  quote = snapshot?.quotes.find(item => item.symbol === quote.symbol && item.market === quote.market) || quote;
  const demo = snapshot?.mode === 'demo';
  const stale = quote.stale || !Number.isFinite(quote.price);
  const baseline = {previousClose:'전일 종가 대비',purchase:'내 평균 매수가 대비',custom:'설정 기준가 대비',tracking:'추적 시작가 대비'}[snapshot?.config.baseline] || '기준가 대비';
  const updated = Number.isFinite(quote.updatedAt) ? new Date(quote.updatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
  const held = snapshot?.portfolio?.holdings?.items.some(item => item.quantity > 0 && item.symbol === quote.symbol && item.market === quote.market);
  showSpeech({kind:demo ? held ? '데모 · 보유종목 소식' : '데모 · 가상 시세' : stale ? '시세 확인 필요' : held ? '보유종목 소식' : '관심종목 소식',title:`${quote.name} ${money(quote.price,quote.currency)}`,voiceKey:stale?'idle':'talk',body:stale ? '새 시세 수신 대기 중' : Number.isFinite(quote.changePercent) ? `${baseline} ${pct(quote.changePercent)}` : '등락률 계산에 필요한 기준가 없음',meta:`${quote.symbol}${updated ? ` · ${updated} 기준` : ''}${stale ? ' · 마지막 수신값' : ''}`,duration:5700});
}
function onBulletin(event) {
  if (!snapshot || !event?.quotes?.length) return;
  const at = Number(event.at) || Date.now();
  if (at <= lastBulletin) return;
  lastBulletin = at;
  const key = quote => `${quote.market}:${quote.symbol}`;
  const latest = new Map(event.quotes.slice(0,100).map(quote => [key(quote),quote]));
  // Preserve unread reports when the selected interval is shorter than a full
  // watchlist round; replace their data with the newest snapshot.
  const pending = bulletinQueue.map(quote => latest.get(key(quote))).filter(Boolean);
  const pendingKeys = new Set(pending.map(key));
  bulletinQueue = [...pending,...[...latest.values()].filter(quote => !pendingKeys.has(key(quote)))];
  // A scheduled report gets its first visible update at the requested interval,
  // even when previous alerts kept extending the current speech bubble.
  if (!dragging && menu.hidden) quoteSpeech(bulletinQueue.shift());
  nextBulletinAt = performance.now() + 5700;
}
function scheduleFallback() {
  clearInterval(bulletinTimer);
  if (typeof bridge.onBulletin === 'function') return;
  bulletinTimer = setInterval(()=>onBulletin({quotes:snapshot?.quotes,at:Date.now()}), Math.max(0.1,Number(snapshot?.config.intervalMinutes)||5)*60000);
}
function applyState(state) {
  const oldInterval = snapshot?.config.intervalMinutes;
  const firstState=!snapshot;
  const oldCharacter=snapshot?.config.characterId||DEFAULT_CHARACTER_ID;
  const oldRoaming=snapshot?.config.roaming;
  snapshot = state;
  if(firstState||oldCharacter!==(state.config.characterId||DEFAULT_CHARACTER_ID)){
    const selected=getCharacterProfile(state.config.characterId);
    profile=selected.available?selected:getCharacterProfile(DEFAULT_CHARACTER_ID);
    if(speechVoiceKey){
      speechVoice.textContent=profile.speech[speechVoiceKey];
      speechVoice.setAttribute('aria-label',`${profile.name}: ${profile.speech[speechVoiceKey]}`);
      speechVoice.dataset.speaker=profile.id;
    }
    if(speechTitleKey)document.querySelector('#speech-title').textContent=profile.speech[speechTitleKey];
    character.setCharacter(profile.id);roaming.idleMs=profile.motion.idleMs;stopWalking();
    document.title=`먼작주 · ${profile.name}`;
    document.querySelector('#pet-world').setAttribute('aria-label',`${profile.name} 주식 친구`);
    hitbox.setAttribute('aria-label',`${profile.name}. 드래그로 이동, 두 번 클릭하면 설정, 오른쪽 클릭하면 메뉴.`);
    document.querySelector('#hide-pet').firstChild.textContent=`${profile.name} 숨기기 `;
  }
  const nextSize = Math.min(PET_SIZE.max,Math.max(PET_SIZE.min,Number(state.config.petSize)||PET_SIZE.default));
  if (size !== nextSize) { size = nextSize; character.setSize(size); pet.style.width=`${size}px`;pet.style.height=`${size}px`;place(); }
  speechScale=Math.min(160,Math.max(80,Number(state.config.speechScale)||100))/100;
  speech.style.setProperty('--speech-scale',String(speechScale));
  placeSpeech();
  if (oldRoaming !== undefined && oldRoaming !== state.config.roaming) stopWalking();
  document.querySelector('#toggle-roaming').firstChild.textContent = state.config.roaming ? '잠깐 쉬기 ' : '산책 시작하기 ';
  if (oldInterval !== state.config.intervalMinutes) scheduleFallback();
  if (previousMode !== null && previousMode !== state.mode) {
    bulletinQueue = [];
    showSpeech({kind:state.mode === 'demo' ? '데모 · 가상 시세' : '먼작주 · 연결 상태',title:state.mode === 'live' ? '실시간 시세 연결' : state.mode === 'demo' ? '데모 모드' : '시세 연결 대기',body:state.mode === 'demo' ? '지금 표시되는 가격은 가상 시세입니다.' : state.connection.message,duration:6500});
  }
  if (previousConnectionState !== null && previousConnectionState !== 'error' && state.connection.state === 'error') {
    bulletinQueue = [];
    showSpeech({kind:'먼작주 · 연결 상태',title:'새 시세 수신 중단',body:state.connection.message || '설정에서 연결 상태를 확인해 주세요.',meta:'두 번 클릭 · 연결 설정',duration:12000});
  } else if (previousConnectionState === 'error' && state.connection.state === 'connected') {
    showSpeech({kind:'먼작주 · 연결 상태',title:'시세 연결 복구',body:'새로 수신한 가격으로 갱신합니다.',duration:6500});
  }
  previousMode = state.mode;
  previousConnectionState = state.connection.state;
}
function onMotion({action,alert}={}) {
  const next = ['idle','walk','happy','cry','sleep','talk'].includes(action) ? action : 'idle';
  playMotion(next,alert?2400:6500,{preview:!alert});
  if (alert) {
    const demo = snapshot?.mode === 'demo';
    const quote = snapshot?.quotes.find(item => item.symbol === alert.symbol && (!alert.market || item.market === alert.market));
    const stock = snapshot?.config.watchlist.find(item => item.symbol === alert.symbol && (!alert.market || item.market === alert.market));
    const currency = quote?.currency || ((alert.market || stock?.market) === 'US' ? 'USD' : 'KRW');
    showSpeech({kind:`${demo?'데모 · ':''}${alert.direction==='up'?'상승':'하락'} ${alert.level}% 도달`,title:`${alert.name} ${pct(alert.percent)}`,voiceKey:alert.direction==='up'?'rise':'fall',body:`현재가 ${money(alert.price,currency)}`,meta:demo?'가상 시세 알림 · 실제 투자 정보 아님':'설정한 등락 기준 도달',tone:alert.direction,duration:12000});
  } else showSpeech({kind:`${profile.name} · 모션 미리보기`,title:profile.speech[next],duration:6000});
}
function playMotion(action,duration,{preview=false}={}){
  const now=performance.now();
  const result=preview?roaming.requestPreview(now,duration):roaming.requestReaction(now,duration,{allowWalk:walkingEnabled()});
  if(!result.play){pendingMotion={action,duration,after:result.until};return;}
  pendingMotion=null;reactionAction=action;reactionUntil=result.until;
  stepping=false;walkBurstUntil=0;walkPauseUntil=0;
  character.setAction(action,{restart:true});
}
function updateInteractive(point) {
  const element = point ? document.elementFromPoint(point.x,point.y) : null;
  const next = Boolean(dragging || element?.closest('[data-interactive]'));
  if (next !== currentInteractive) {currentInteractive = next;bridge.setInteractive(next);}
}
function releaseDragCapture(previous){
  try{if(hitbox.hasPointerCapture(previous.pointerId))hitbox.releasePointerCapture(previous.pointerId);}catch{/* Capture may already be gone after a native display handoff. */}
}
function finishDrag(point=null){
  if(!dragging)return;
  const previous=dragging;dragging=null;nativeViewport=null;
  pet.classList.remove('dragging');delete pet.dataset.dragMode;stopWalking();releaseDragCapture(previous);
  pointerPosition=!document.hidden && point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  // The host releases its input latch on drop. Reassert hover for an immediate second grab.
  if(previous.native)currentInteractive=false;
  updateInteractive(pointerPosition);
}
function endNativeDrag(){
  if(!dragging?.native || dragging.ending)return;
  dragging.ending=true;
  // Keep the host's placement authoritative until its final packet arrives.
  bridge.endPetDrag({sessionId:dragging.sessionId});
}
function applyPetPlacement(packet){
  if(!dragging?.native || packet?.sessionId!==dragging.sessionId)return;
  if(!Number.isSafeInteger(packet.sequence) || packet.sequence<=dragging.lastSequence)return;
  if(!Number.isFinite(packet.x)||!Number.isFinite(packet.y)||typeof packet.dragging!=='boolean')return;
  if(!Number.isFinite(packet.viewport?.width)||!Number.isFinite(packet.viewport?.height)||packet.viewport.width<=0||packet.viewport.height<=0)return;
  dragging.lastSequence=packet.sequence;nativeViewport={width:packet.viewport.width,height:packet.viewport.height};
  x=packet.x;y=packet.y;pet.dataset.displayId=String(packet.displayId);
  place({clamp:false});
  if(!packet.dragging)finishDrag(packet.cursor);
}
function applyPetDragEnded(packet){
  if(!dragging?.native || packet?.sessionId!==dragging.sessionId)return;
  finishDrag();place();
}
window.addEventListener('pointermove',event=>{
  if(dragging?.native){if(event.buttons===0)endNativeDrag();return;}
  if (dragging) {x=event.clientX-dragging.offsetX;y=event.clientY-dragging.offsetY;dragging.moved ||= Math.abs(event.clientX-dragging.startX)+Math.abs(event.clientY-dragging.startY)>4;place();}
  pointerPosition={x:event.clientX,y:event.clientY};updateInteractive(pointerPosition);
});
window.addEventListener('pointerleave',()=>{pointerPosition=null;if (!dragging && currentInteractive) {currentInteractive=false;bridge.setInteractive(false);}});
hitbox.addEventListener('pointerdown',event=>{
  if(event.button!==0 || dragging)return;
  const native=nativeDraggingAvailable && event.pointerType!=='touch';
  dragging={offsetX:event.clientX-x,offsetY:event.clientY-y,startX:event.clientX,startY:event.clientY,moved:false,pointerId:event.pointerId,native,sessionId:native?++dragSessionCounter:null,lastSequence:-1,ending:false};
  if(native)nativeViewport={width:innerWidth,height:innerHeight};
  hitbox.setPointerCapture(event.pointerId);stopWalking();pet.classList.add('dragging');pet.dataset.dragMode=native?'native':'local';menu.hidden=true;currentInteractive=true;bridge.setInteractive(true);
  if(native){
    try{bridge.beginPetDrag({sessionId:dragging.sessionId,offset:{x:dragging.offsetX,y:dragging.offsetY},size});}
    catch{finishDrag({x:event.clientX,y:event.clientY});}
  }
});
function stopDrag(event) {
  if(!dragging)return;
  if(dragging.native){endNativeDrag();return;}
  finishDrag(event?{x:event.clientX,y:event.clientY}:null);
}
window.addEventListener('pointerup',stopDrag);window.addEventListener('pointercancel',stopDrag);
hitbox.addEventListener('lostpointercapture',()=>{if(dragging && !dragging.native)finishDrag();});
hitbox.addEventListener('dblclick',()=>{if(isDesktop)bridge.showSettings();else window.location.href='./index.html';});
hitbox.addEventListener('contextmenu',event=>{event.preventDefault();stopWalking();menu.hidden=!menu.hidden;hideSpeech();});
hitbox.addEventListener('keydown',event=>{if(event.key==='Enter')bridge.showSettings();if(event.key===' ') {event.preventDefault();menu.hidden=!menu.hidden;}});
document.querySelector('#dismiss-speech').addEventListener('click',hideSpeech);
document.querySelector('#settings').addEventListener('click',()=>{menu.hidden=true;if(isDesktop)bridge.showSettings();else window.location.href='./index.html';});
document.querySelector('#toggle-roaming').addEventListener('click',async()=>{menu.hidden=true;try {applyState(await bridge.updateConfig({roaming:!snapshot.config.roaming}));} catch(error){showSpeech({title:'설정을 저장하지 못했어요.',body:error.message});}});
document.querySelector('#hide-pet').addEventListener('click',()=>{menu.hidden=true;if(dragging)stopDrag();currentInteractive=false;bridge.setInteractive(false);bridge.hidePet();if(!isDesktop)pet.hidden=true;});
window.addEventListener('resize',()=>{stopWalking();place();});
motionPreference.addEventListener('change',()=>stopWalking());
window.addEventListener('blur',()=>{menu.hidden=true;if(dragging && !dragging.native)finishDrag();if(!dragging){currentInteractive=false;bridge.setInteractive(false);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){menu.hidden=true;if(dragging)stopDrag();pointerPosition=null;currentInteractive=false;bridge.setInteractive(false);}else{lastNow=performance.now();stopWalking();}});
function tick(now) {
  if(stopped)return;
  const dt = Math.min((now-lastNow)/1000,.05);lastNow=now;
  if(pointerPosition && now>nextHitTestAt){updateInteractive(pointerPosition);nextHitTestAt=now+100;}
  if(speechUntil && now>speechUntil)hideSpeech();
  // Threshold alerts remain immediate, but cannot postpone every later holding
  // in a scheduled report indefinitely by extending speechUntil.
  if(bulletinQueue.length && now>=nextBulletinAt && !dragging && menu.hidden){
    quoteSpeech(bulletinQueue.shift());nextBulletinAt=now+5700;
  }
  if(pendingMotion && now>=pendingMotion.after && !dragging && !document.hidden){
    const pending=pendingMotion;pendingMotion=null;playMotion(pending.action,pending.duration);
  }
  if(walkingEnabled() && roaming.canWalk(now)) {
    if(!target) {
      const b=bounds(),distance=randomRange(profile.motion.roamDistance),angle=Math.random()*Math.PI*2;
      target=chooseRoamingTarget({x,y},b,distance,angle);
      // Usagi may change course once during a walk, then still reaches a stop.
      turnDuringWalk=profile.id==='usagi' && Math.random()<.55;
      walkBurstUntil=0;walkPauseUntil=now+120+Math.random()*180;
      if(!target)finishWalk(now);
    }
    if(target) {
      const dx=target.x-x,dy=target.y-y,distance=Math.hypot(dx,dy);
      if(distance<.8)finishWalk(now);
      else if(now>=walkPauseUntil){
        if(!walkBurstUntil){walkBurstStarted=now;walkBurstUntil=now+randomRange(profile.motion.walkBurstMs);walkPace=1+(Math.random()*2-1)*(profile.motion.paceVariation||0);roaming.protectStep(now,walkBurstUntil-now+400);reactionUntil=0;}
        if(now>=walkBurstUntil){
          stepping=false;walkBurstUntil=0;walkPauseUntil=now+randomRange(profile.motion.walkPauseMs);
          if(turnDuringWalk){
            turnDuringWalk=false;
            const angle=Math.atan2(dy,dx)+(Math.random()<.5?-1:1)*(.45+Math.random()*.45);
            target=chooseRoamingTarget({x,y},bounds(),distance,angle);
            if(!target)finishWalk(now);
          }
        }
        else{
          const p=(now-walkBurstStarted)/(walkBurstUntil-walkBurstStarted);
          const pace=Math.min(ease(p/.2),ease((1-p)/.2));
          const step=Math.min(distance,profile.motion.walkSpeed*walkPace*dt*pace);
          x+=dx/distance*step;y+=dy/distance*step;stepping=true;place();
        }
      }else stepping=false;
    }
  }
  const reacting=now<reactionUntil;
  character.setAction(reacting?reactionAction:stepping&&!dragging?'walk':speechUntil?'talk':'idle');
  requestAnimationFrame(tick);
}

try {
  applyState(await bridge.getState());
  const b=bounds();x=b.right;y=b.bottom;place();
  disposers.push(bridge.onState(applyState),bridge.onMotion(onMotion));
  if(typeof bridge.onBulletin==='function')disposers.push(bridge.onBulletin(onBulletin));
  if(nativeDraggingAvailable)disposers.push(bridge.onPetPlacement(applyPetPlacement));
  if(nativeDraggingAvailable && typeof bridge.onPetDragEnded==='function')disposers.push(bridge.onPetDragEnded(applyPetDragEnded));
  showSpeech({kind:snapshot.mode==='demo'?'데모 · 가상 시세':'먼작주',title:profile.name,voiceKey:'greeting',body:snapshot.mode==='demo'?'가상 시세를 표시합니다. 두 번 클릭하면 설정이 열립니다.':snapshot.mode==='offline'?'설정에서 API 키를 연결해 주세요. 두 번 클릭하면 설정이 열립니다.':'관심종목 알림이 켜져 있습니다. 캐릭터를 끌어서 옮길 수 있습니다.',meta:'오른쪽 클릭 · 산책과 표시 설정',duration:9000});
  requestAnimationFrame(tick);
} catch(error) {showSpeech({title:'앱 연결을 기다리고 있어요.',body:error.message,duration:30000});}
window.addEventListener('beforeunload',()=>{if(dragging)stopDrag();stopped=true;clearInterval(bulletinTimer);speechObserver.disconnect();disposers.forEach(fn=>fn?.());character.destroy();bridge.setInteractive(false);});
