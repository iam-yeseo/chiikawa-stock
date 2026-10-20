import test from 'node:test';
import assert from 'node:assert/strict';
import {PetRoamingSchedule,chooseRoamingTarget} from '../lib/pet-roaming.js';
import {petBounds} from '../lib/pet-geometry.js';

test('sequential explicit previews each get a full timeline, then automatic alerts retain their bounded budget',()=>{
  const schedule=new PetRoamingSchedule({now:0});
  schedule.protectStep(0,4000);
  // The user presses walk, then happy after 850ms, then decline after 3300ms.
  for(const now of [0,850,4150]){
    const preview=schedule.requestPreview(now,6500);
    assert.deepEqual(preview,{play:true,until:now+6500});
    assert.equal(schedule.canWalk(now+6499),false);
    assert.equal(schedule.canWalk(now+6500),true);
    assert.equal(schedule.protectedUntil,0);
    assert.equal(schedule.episodeStarted,null);
  }
  for(const now of [10650,11650,12650]){
    const alert=schedule.requestReaction(now,2400);
    assert.equal(alert.play,true);
    assert.ok(alert.until<=14650,'automatic alerts still share the four-second episode');
  }
  const nextAlert=schedule.requestReaction(14650,2400);
  assert.equal(nextAlert.play,false);
  assert.equal(schedule.canWalk(14650),true);
});

test('continuous three-second alerts leave frequent meaningful walking opportunities',()=>{
  const schedule=new PetRoamingSchedule({now:0,random:()=>.5});
  let pending=null,stepUntil=0,firstStep=null,movingMs=0,shownAlerts=0;
  for(let now=0;now<=60000;now+=20){
    if(now%3000===0){
      shownAlerts+=1;
      const result=schedule.requestReaction(now,2400);
      pending=result.play?null:result.until;
      if(result.play)stepUntil=0;
    }
    if(pending!==null&&now>=pending){
      const result=schedule.requestReaction(now,2400);
      pending=result.play?null:result.until;
      if(result.play)stepUntil=0;
    }
    if(schedule.canWalk(now)){
      if(now>=stepUntil){stepUntil=now+2900;schedule.protectStep(now,3300);}
      firstStep??=now;movingMs+=20;
    }
  }
  assert.equal(shownAlerts,21);
  assert(firstStep<=4500,`first walk was delayed until ${firstStep}ms`);
  assert(movingMs>=25000,`busy alerts left only ${movingMs}ms for movement`);
});

test('reaction budget never moves a scheduled walk later; user pause is not overridden',()=>{
  const schedule=new PetRoamingSchedule({now:1000});
  const due=schedule.nextWalkAt;
  for(let now=1000;now<20000;now+=1000){
    schedule.requestReaction(now,4000,{allowWalk:false});
    assert.equal(schedule.nextWalkAt,due);
    assert.equal(schedule.protectedUntil,0,'disabled roaming must not reserve walking time');
  }
  schedule.resume(20000,5000);
  assert.equal(schedule.canWalk(24999),false);
  assert.equal(schedule.canWalk(25000),true);
});

test('startup and interaction walks begin promptly, completed walks rest for only four to nine seconds',()=>{
  const schedule=new PetRoamingSchedule({now:0,random:()=>.5});
  assert.equal(schedule.canWalk(1999),false);
  assert.equal(schedule.canWalk(2000),true);
  schedule.rest(10000);
  assert.equal(schedule.nextWalkAt,16500);
  schedule.resume(20000);
  assert.equal(schedule.nextWalkAt,22000);
  assert.equal(schedule.canWalk(22000),true);
  for(const random of [()=>0,()=>1]){
    const limit=new PetRoamingSchedule({random});limit.rest(10000);
    assert(limit.nextWalkAt>=14000&&limit.nextWalkAt<=19000);
  }
});

test('outward directions at every corner produce meaningful travel within the viewport',()=>{
  const bounds=petBounds({width:1200,height:800},150);
  for(const x of [bounds.left,bounds.right])for(const y of [bounds.top,bounds.bottom]){
    for(let angle=0;angle<Math.PI*2;angle+=Math.PI/8){
      const target=chooseRoamingTarget({x,y},bounds,210,angle);
      assert(target);
      assert(Math.hypot(target.x-x,target.y-y)>=115);
      assert(Math.hypot(target.x-x,target.y-y)<=211);
      assert(target.x>=bounds.left&&target.x<=bounds.right);
      assert(target.y>=bounds.top&&target.y<=bounds.bottom);
    }
  }
});

test('a viewport too small to move returns no target without a retry loop',()=>{
  const bounds=petBounds({width:100,height:100},150);
  assert.equal(chooseRoamingTarget({x:0,y:0},bounds,65,Math.PI/4),null);
});
