import './character.css';
import {getCharacterProfile, DEFAULT_CHARACTER_ID} from '../lib/characters.js';
import {sampleCharacterPose} from '../lib/character-motion.js';
import {CHARACTER_SKINS as SKINS} from './character-skins.js';

const VALID_ACTIONS = new Set(['idle','walk','happy','cry','sleep','talk']);
const images = new Map();
function loadAtlas(url) {
  if(!images.has(url)){const image=new Image();image.src=url;images.set(url,image);}
  return images.get(url);
}

/** Raster poses stay on model; modest interpolated movement never stretches the art. */
export function mountCharacter(container,{size=150,action='idle',characterId=DEFAULT_CHARACTER_ID}={}) {
  const root=document.createElement('div');
  root.className='chii-character';root.setAttribute('role','img');
  root.innerHTML='<span class="chii-shadow"></span><div class="chii-body"><canvas class="chii-art" aria-hidden="true"></canvas><div class="chii-tears" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>';
  const body=root.querySelector('.chii-body');
  const shadow=root.querySelector('.chii-shadow');
  const canvas=root.querySelector('canvas');
  const context=canvas.getContext('2d');
  const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let profile,skin,atlas,current='idle',started=performance.now(),px=150,raf=0,destroyed=false;
  let lastNow=performance.now(),poseX=0,poseY=0,poseRotation=0,displayedFrame=-1;
  let reducedMotion=motionPreference.matches;
  container.append(root);

  function markLabel(){root.setAttribute('aria-label',`${profile.actionLabels[current]} ${profile.name}`);}
  function setCharacter(id){
    let next=getCharacterProfile(id);
    if(!next.available || !SKINS[next.id])next=getCharacterProfile(DEFAULT_CHARACTER_ID);
    if(profile?.id===next.id)return;
    profile=next;skin=SKINS[next.id];atlas=loadAtlas(skin.atlasUrl);
    root.dataset.character=profile.id;
    root.style.setProperty('--chii-tear-left',`${skin.tears.left*100}%`);
    root.style.setProperty('--chii-tear-right',`${skin.tears.right*100}%`);
    root.style.setProperty('--chii-tear-top',`${skin.tears.top*100}%`);
    displayedFrame=-1;poseX=0;poseY=0;poseRotation=0;started=performance.now();
    context.clearRect(0,0,px,px);markLabel();
  }
  function setSize(value){
    px=Math.max(64,Math.min(400,Number(value)||150));
    root.style.width=`${px}px`;root.style.height=`${px}px`;
    root.style.setProperty('--chii-tear-fall',`${Math.round(px*.27)}px`);
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.ceil(px*dpr);canvas.height=Math.ceil(px*dpr);
    context.setTransform(dpr,0,0,dpr,0,0);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    displayedFrame=-1;
  }
  function setAction(value,{restart=false}={}){
    const next=VALID_ACTIONS.has(value)?value:'idle';
    if(next===current&&!restart)return;
    current=next;started=performance.now();root.dataset.action=next;markLabel();
  }
  function paint(frame){
    const [sx,sy,sw,sh]=skin.frames[frame];
    const ratio=px/skin.referenceSize;
    context.globalAlpha=1;
    context.globalCompositeOperation='source-over';
    context.drawImage(atlas,sx,sy,sw,sh,(px-sw*ratio)/2,px*skin.baseline-sh*ratio,sw*ratio,sh*ratio);
  }
  function draw(frame){
    if(!atlas.complete||!atlas.naturalWidth||frame===displayedFrame)return;
    // Show one complete drawing at a time. Blending different arm positions
    // makes extra limbs visible; smooth movement belongs to the body transform.
    context.clearRect(0,0,px,px);
    paint(frame);displayedFrame=frame;root.dataset.frame=String(frame);
  }
  function onPreference(event){
    reducedMotion=event.matches;root.dataset.reducedMotion=String(reducedMotion);
    if(reducedMotion){poseX=0;poseY=0;poseRotation=0;}
    displayedFrame=-1;
  }
  motionPreference.addEventListener('change',onPreference);
  function animate(now){
    if(destroyed)return;
    const t=(now-started)/1000,dt=Math.min(.05,Math.max(0,(now-lastNow)/1000));lastNow=now;
    const pose=sampleCharacterPose(profile.id,current,t,px,{reducedMotion});
    if(reducedMotion){poseX=0;poseY=0;poseRotation=0;}
    else{
      const settle=1-Math.exp(-dt*24);
      poseX+=(pose.x-poseX)*settle;poseY+=(pose.y-poseY)*settle;poseRotation+=(pose.rotation-poseRotation)*settle;
    }
    draw(pose.frame);
    body.style.transform=`translate(${poseX.toFixed(3)}px,${poseY.toFixed(3)}px) rotate(${poseRotation.toFixed(3)}deg)`;
    const shadowScale=1+poseY/px*.7;shadow.style.transform=`translateX(-50%) scaleX(${shadowScale.toFixed(3)})`;
    root.dataset.phase=pose.phase;root.dataset.tears=pose.tears&&!reducedMotion?'flowing':'still';
    raf=requestAnimationFrame(animate);
  }
  root.dataset.action='idle';root.dataset.reducedMotion=String(reducedMotion);
  setCharacter(characterId);setSize(size);setAction(action);raf=requestAnimationFrame(animate);
  return {setAction,setSize,setCharacter,destroy(){destroyed=true;cancelAnimationFrame(raf);motionPreference.removeEventListener('change',onPreference);root.remove();}};
}
