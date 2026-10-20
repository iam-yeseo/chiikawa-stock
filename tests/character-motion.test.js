import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_CATALOG} from '../lib/characters.js';
import {sampleCharacterPose} from '../lib/character-motion.js';

const actions=['idle','walk','happy','cry','sleep','talk'];

test('every character action stays inside the 16-pose atlas with bounded finite movement', () => {
  for(const {id} of CHARACTER_CATALOG) for(const action of actions) for(const size of [80,150,300]) for(let t=0;t<36;t+=.037){
    const pose=sampleCharacterPose(id,action,t,size);
    assert.ok(Number.isInteger(pose.frame)&&pose.frame>=0&&pose.frame<16,`${id}/${action} frame`);
    for(const value of [pose.x,pose.y,pose.rotation]) assert.ok(Number.isFinite(value),`${id}/${action} movement`);
    assert.ok(Math.abs(pose.x)<size*.03&&Math.abs(pose.y)<size*.2&&Math.abs(pose.rotation)<5,`${id}/${action} bounded movement`);
  }
});

test('the real 2.4-second rise alert preserves quiet and friendly hops while Usagi makes two short hops', () => {
  function hops(id){
    let previousAir=false,count=0,maxHeight=0,lastAir=0;
    for(let t=0;t<2.4;t+=.005){
      const pose=sampleCharacterPose(id,'happy',t,150),air=pose.y<-3;
      if(air&&!previousAir)count++;
      previousAir=air;maxHeight=Math.max(maxHeight,-pose.y);if(air)lastAir=t;
    }
    return {count,maxHeight,lastAir};
  }
  const quiet=hops('chiikawa'),friendly=hops('hachiware'),energetic=hops('usagi');
  assert.equal(quiet.count,1);assert.equal(friendly.count,2);assert.equal(energetic.count,2);
  assert.ok(quiet.maxHeight<energetic.maxHeight&&energetic.maxHeight<friendly.maxHeight);
  assert.ok(energetic.lastAir<1.2&&energetic.lastAir<friendly.lastAir);
  assert.equal(sampleCharacterPose('usagi','happy',2.2).phase,'calm-settle');
});

test('decline reactions retain distinct personalities and Hachiware recovers within the alert', () => {
  assert.equal(sampleCharacterPose('hachiware','cry',1.1).tears,true);
  assert.equal(sampleCharacterPose('hachiware','cry',2.2).tears,false);
  assert.equal(sampleCharacterPose('hachiware','cry',2.2).phase,'gather-courage');
  assert.equal(sampleCharacterPose('chiikawa','cry',2.2).tears,true);
  assert.equal(sampleCharacterPose('chiikawa','cry',7).tears,true);
  let footTap=false;
  for(let t=0;t<8;t+=.05){
    const pose=sampleCharacterPose('usagi','cry',t);
    assert.equal(pose.tears,false);footTap ||= pose.phase==='light-foot-tap'&&pose.y<0;
  }
  assert.equal(footTap,true);
  assert.equal(sampleCharacterPose('usagi','cry',2.2).phase,'calm-recover');
  assert.equal(sampleCharacterPose('usagi','cry',2.2).frame,15);
});

test('Usagi reacts with low body movement and settles promptly without broad turns or tears', () => {
  const limits={idle:{y:0,rotation:.5},walk:{y:.014,rotation:.7},happy:{y:.075,rotation:.6},cry:{y:.007,rotation:.5},talk:{y:0,rotation:0}};
  for(const [action,limit] of Object.entries(limits)) for(const size of [90,150,280]) for(let t=0;t<12;t+=.011){
    const pose=sampleCharacterPose('usagi',action,t,size);
    assert.ok(Math.abs(pose.y)<=size*limit.y+1e-8,`${action} gentle height`);
    assert.ok(Math.abs(pose.rotation)<=limit.rotation+1e-8,`${action} small turn`);
    assert.ok(Math.abs(pose.x)<=size*.004+1e-8,`${action} small lean`);
    assert.equal(pose.tears,false);
    if((action==='happy'||action==='cry')&&t>=1.22){
      assert.equal(pose.x,0);assert.equal(pose.y,0);assert.equal(pose.rotation,0);
    }
  }
  assert.equal(sampleCharacterPose('usagi','cry',0,150,{reducedMotion:true}).frame,15);
});

test('reduced motion uses a single static expression without sprite loops, turns, jumps, or tears', () => {
  for(const {id} of CHARACTER_CATALOG) for(const action of actions){
    const initial=sampleCharacterPose(id,action,0,150,{reducedMotion:true});
    assert.equal(initial.x,0);assert.equal(initial.y,0);assert.equal(initial.rotation,0);assert.equal(initial.tears,false);
    for(const t of [.35,.8,1.5,2.3,9,36,100]) assert.deepEqual(sampleCharacterPose(id,action,t,150,{reducedMotion:true}),initial);
  }
});

test('walking poses and profiles differ while keeping the frequent roaming schedule', () => {
  const poses=CHARACTER_CATALOG.map(({id})=>sampleCharacterPose(id,'walk',.19));
  assert.equal(new Set(poses.map(pose=>pose.phase)).size,3);
  const motions=CHARACTER_CATALOG.map(item=>item.motion);
  assert.ok(motions[0].walkSpeed<motions[1].walkSpeed&&motions[1].walkSpeed<motions[2].walkSpeed);
  for(const motion of motions) assert.ok(motion.idleMs[1]<=9000);
  const usagi=CHARACTER_CATALOG.find(item=>item.id==='usagi').motion;
  assert.equal(usagi.walkSpeed,52);
  assert.deepEqual(usagi.idleMs,[2000,5000]);
  assert.deepEqual(usagi.roamDistance,[220,420]);
  assert.deepEqual(usagi.walkBurstMs,[1800,3000]);
  assert.deepEqual(usagi.walkPauseMs,[120,300]);
  assert.equal(usagi.paceVariation,.2);
});

test('Chiikawa and Usagi make brief sounds instead of mouthing the full market report', () => {
  const mouthTime={};
  for(const {id} of CHARACTER_CATALOG){
    let speaking=0,total=0;
    for(let t=0;t<30;t+=.01){
      if(sampleCharacterPose(id,'talk',t).frame===3)speaking++;
      total++;
    }
    mouthTime[id]=speaking/total;
  }
  assert.ok(mouthTime.chiikawa>0&&mouthTime.chiikawa<.05);
  assert.ok(mouthTime.usagi>0&&mouthTime.usagi<.05);
  assert.ok(mouthTime.hachiware>.15&&mouthTime.hachiware<.25);
  for(const id of ['chiikawa','usagi']){
    assert.equal(sampleCharacterPose(id,'talk',.4).frame,3);
    assert.equal(sampleCharacterPose(id,'talk',1).frame,0);
    assert.equal(sampleCharacterPose(id,'talk',5).frame,0);
  }
});
