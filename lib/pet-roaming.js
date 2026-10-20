/** Scheduling is independent of quote/state delivery so busy markets cannot postpone every walk. */
export class PetRoamingSchedule {
  constructor({now=0,idleMs=[4000,9000],random=Math.random,startupDelay=2000}={}) {
    this.idleMs=idleMs;this.random=random;this.nextWalkAt=now+startupDelay;
    this.reactionUntil=0;this.episodeStarted=null;this.protectedUntil=0;
  }
  resume(now,delay=2000){
    this.nextWalkAt=now+delay;this.protectedUntil=0;this.episodeStarted=null;this.reactionUntil=0;
  }
  rest(now){
    const [low,high]=this.idleMs;
    this.resume(now,low+this.random()*(high-low));
  }
  canWalk(now){return now>=this.nextWalkAt && now>=this.reactionUntil;}
  requestPreview(now,duration=6500){
    // An explicit preview is a new user action. It must not inherit a prior
    // alert's episode budget or a walking burst's protection deadline.
    this.resume(now,duration);
    this.reactionUntil=now+duration;
    return {play:true,until:this.reactionUntil};
  }
  requestReaction(now,duration=2400,{allowWalk=true}={}){
    if(allowWalk && now<this.protectedUntil)return {play:false,until:this.protectedUntil};
    // Even a busy watchlist gets a complete walking burst after a brief reaction.
    if(allowWalk && this.episodeStarted!==null && now>=this.episodeStarted+4000 && now>=this.nextWalkAt){
      this.reactionUntil=0;this.protectedUntil=now+4000;
      return {play:false,until:this.protectedUntil};
    }
    if(this.episodeStarted===null || now>=this.episodeStarted+4000)this.episodeStarted=now;
    this.reactionUntil=Math.min(now+duration,this.episodeStarted+4000);
    return {play:true,until:this.reactionUntil};
  }
  protectStep(now,duration){
    this.protectedUntil=Math.max(this.protectedUntil,now+Math.min(4000,duration));
    this.episodeStarted=null;this.reactionUntil=0;
  }
}

/** Reflect an outward direction at an edge instead of scheduling a zero-distance walk. */
export function chooseRoamingTarget({x,y},bounds,distance,angle){
  let dx=Math.cos(angle)*distance,dy=Math.sin(angle)*distance*.55;
  if(x+dx<bounds.left || x+dx>bounds.right)dx=-dx;
  if(y+dy<bounds.top || y+dy>bounds.bottom)dy=-dy;
  const clamp=point=>({x:Math.max(bounds.left,Math.min(bounds.right,point.x)),y:Math.max(bounds.top,Math.min(bounds.bottom,point.y))});
  const target=clamp({x:x+dx,y:y+dy});
  if(Math.hypot(target.x-x,target.y-y)>=Math.min(18,distance*.4))return target;
  const alternatives=[{x:x+distance,y},{x:x-distance,y},{x,y:y+distance*.55},{x,y:y-distance*.55}].map(clamp);
  alternatives.sort((a,b)=>Math.hypot(b.x-x,b.y-y)-Math.hypot(a.x-x,a.y-y));
  return Math.hypot(alternatives[0].x-x,alternatives[0].y-y)>=.8?alternatives[0]:null;
}
