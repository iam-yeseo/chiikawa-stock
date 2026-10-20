import {getCharacterProfile} from './characters.js';

const ACTIONS = new Set(['idle','walk','happy','cry','sleep','talk']);
const staticFrames = {idle:0,walk:0,happy:11,cry:14,sleep:1,talk:3};
const blink = (t,windows) => windows.some(([start,end]) => t >= start && t < end);

/** Pure pose sampling keeps every preview and the desktop pet on the same timeline.
 * Atlas contract: idle/blink/smile/talk, four walks, four rises, four declines.
 * The existing action name `cry` means a decline reaction, not forced crying.
 */
export function sampleCharacterPose(characterId, action, seconds, size=150, {reducedMotion=false}={}) {
  const profile=getCharacterProfile(characterId),id=profile.id;
  const current=ACTIONS.has(action)?action:'idle';
  const t=Number.isFinite(seconds)?Math.max(0,seconds):0;
  const px=Number.isFinite(size)?Math.max(64,Math.min(400,size)):150;
  const pose={frame:0,x:0,y:0,rotation:0,phase:'still',tears:false};
  if(reducedMotion) return {...pose,frame:id==='usagi'&&current==='cry'?15:staticFrames[current],phase:'reduced-motion'};

  if(current==='walk'){
    const period=id==='usagi'?.58:id==='hachiware'?.84:1.08;
    const step=(t%period)/period;
    pose.frame=4+Math.min(3,Math.floor(step*4));
    pose.y=-(Math.sin(Math.PI*(step*2%1))**2)*px*(id==='usagi'?.014:id==='hachiware'?.008:.0035);
    pose.rotation=id==='usagi'?Math.sin(step*Math.PI*2)*.7:id==='hachiware'?Math.sin(step*Math.PI*2)*.5:0;
    pose.phase=id==='usagi'?'quick-small-steps':id==='hachiware'?'curious-steps':'small-steps';
  }else if(current==='happy'){
    if(id==='hachiware'){
      pose.frame=t<.25?8:t<.45?9:11;pose.phase=t<.25?'notice':'friendly-wave';
      for(const [start,end,height] of [[.45,.95,.09],[1.13,1.66,.075]]){
        if(t>=start&&t<end){const p=(t-start)/(end-start);pose.y=-4*p*(1-p)*px*height;pose.frame=p<.12||p>.88?9:10;pose.phase='two-little-hops';}
      }
      if(t>=1.8&&t<2.45){pose.rotation=Math.sin((t-1.8)*Math.PI*3)*.65;pose.frame=11;}
    }else if(id==='usagi'){
      // Usagi keeps the same face: short leg/ear gestures carry the reaction.
      pose.frame=t<.16?8:t<.26?9:11;pose.phase=t<.16?'brief-notice':t<.26?'ready-hop':'calm-settle';
      for(const [start,end,height] of [[.26,.68,.075],[.82,1.2,.055]]){
        if(t>=start&&t<end){const p=(t-start)/(end-start);pose.y=-4*p*(1-p)*px*height;pose.rotation=Math.sin(p*Math.PI*2)*.6;pose.frame=p<.13||p>.88?9:10;pose.phase='two-quick-hops';}
      }
    }else{
      pose.frame=t<.7?8:t<1.65?9:11;pose.phase=t<.7?'notice':'quiet-smile';
      for(const [start,end,height] of [[.9,1.52,.065],[2.65,3.2,.065*.65]]){
        if(t>=start&&t<=end){const p=(t-start)/(end-start);pose.y=-4*p*(1-p)*px*height;pose.frame=p<.15||p>.85?9:10;pose.phase='small-hop';}
      }
    }
  }else if(current==='cry'){
    if(id==='hachiware'){
      if(t<.35){pose.frame=12;pose.phase='surprised';}
      else if(t<.8){pose.frame=13;pose.phase='worried';}
      else if(t<1.65){pose.frame=14;pose.phase='brief-tears';pose.tears=true;pose.y=-(Math.sin((t-.8)*Math.PI*3)**2)*px*.003;}
      else{pose.frame=t<2.35?15:2;pose.phase='gather-courage';}
    }else if(id==='usagi'){
      if(t<.36){pose.frame=12;pose.phase='small-pause';}
      else if(t<.68){
        const p=(t-.36)/.32;
        pose.frame=13;pose.phase='small-lean';pose.rotation=Math.sin(p*Math.PI)*.5;
      }else if(t<1.22){
        const p=(t-.68)/.54,lift=Math.sin(p*Math.PI)**2;
        pose.frame=14;pose.phase='light-foot-tap';
        pose.y=-lift*px*.007;pose.x=lift*px*.004;
        pose.rotation=Math.sin(p*Math.PI*2)*.5;
      }else{pose.frame=15;pose.phase='calm-recover';}
    }else{
      if(t<.85){pose.frame=12;pose.phase='freeze';}
      else if(t<1.8){pose.frame=13;pose.phase='tears-well';pose.tears=true;}
      else{
        const sob=(t-1.8)%4.2;pose.tears=true;pose.phase='quiet-sob';
        pose.frame=sob<.5?14:sob<2.4?15:sob<2.9?14:13;
        const burst=sob<.5?Math.sin(sob/.5*Math.PI):sob>=2.4&&sob<2.9?Math.sin((sob-2.4)/.5*Math.PI):0;
        pose.x=(Math.sin(t*39)+Math.sin(t*23)*.35)*px*.0014*burst;pose.y=-burst*px*.003;
      }
    }
  }else if(current==='talk'){
    // Market text stays visible longer than a short exclamation. Chiikawa and
    // Usagi return to their usual face rather than mouthing a whole sentence.
    const period=id==='usagi'?6.2:id==='hachiware'?3.5:6.6,p=t%period;
    const speaking=id==='hachiware'?(p>.3&&p<.62)||(p>.83&&p<1.12):p>.3&&p<(id==='usagi'?.5:.48);
    pose.frame=speaking?3:id==='hachiware'?2:0;
    pose.phase=id==='usagi'?'brief-call':id==='hachiware'?'friendly-talk':'small-sound';
  }else if(current==='sleep'){
    pose.frame=1;pose.phase='rest';pose.y=Math.sin(t*1.05)*px*.0015;
  }else if(id==='hachiware'){
    const p=t%14.1;pose.frame=blink(p,[[3.8,3.97],[9.4,9.58]])?1:p>5.2&&p<7.2?2:0;
    pose.rotation=p>5&&p<7.5?Math.sin((p-5)/2.5*Math.PI)*.8:0;
    pose.phase='curious-look';pose.y=Math.sin(t*1.08)*px*.0012;
  }else if(id==='usagi'){
    const p=t%10.7;pose.frame=blink(p,[[2.3,2.47],[8.1,8.28]])?1:p>4&&p<5?2:0;
    pose.rotation=p>5.4&&p<6.2?Math.sin((p-5.4)*Math.PI*2.5)*.5:0;
    pose.phase='steady-look';
  }else{
    const p=t%31.3;pose.frame=blink(p,[[7.2,7.36],[12.8,12.98],[21.7,21.88]])?1:0;
    pose.y=Math.sin(t*1.08)*px*.0012;
  }
  return pose;
}
