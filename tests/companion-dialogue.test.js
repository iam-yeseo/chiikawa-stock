import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_CATALOG} from '../lib/characters.js';
import {COMPANION_DIALOGUE,pickCompanionDialogue,companionDialogueDelay} from '../lib/companion-dialogue.js';

test('every selectable character has varied everyday dialogue with a distinct voice',()=>{
  for(const character of CHARACTER_CATALOG.filter(item=>item.available)){
    const lines=COMPANION_DIALOGUE[character.id];
    assert(lines.length>=10);
    assert.equal(new Set(lines.map(line=>line.id)).size,lines.length);
    assert.equal(new Set(lines.map(line=>line.text)).size,lines.length);
    for(const line of lines){
      assert(['idle','talk','happy','sleep'].includes(line.action));
      assert.doesNotMatch(line.text,/주식|시세|종목|원|\$|%|매수|매도|계좌|API|가상/);
      if(character.id==='chiikawa'){
        assert.match(line.text,/^[응와아흐으앙에헤…!?.\s]+$/u);
        assert(line.text.length<=12);
      }else if(character.id==='usagi'){
        assert.match(line.text,/^[우냐라야하아푸루랴…!?.\s]+$/u);
        assert(line.text.length<=12);
      }else assert(line.text.length>=10);
    }
  }
});

test('selection avoids a consecutive repeat and supports preview actions and unknown legacy IDs',()=>{
  for(const characterId of Object.keys(COMPANION_DIALOGUE)){
    let previousId=null;
    for(let turn=0;turn<30;turn++){
      const line=pickCompanionDialogue(characterId,{previousId,random:()=>.5});
      assert.notEqual(line.id,previousId);previousId=line.id;
    }
    assert.equal(pickCompanionDialogue(characterId,{action:'happy'}).action,'happy');
    assert(pickCompanionDialogue(characterId,{action:'walk'}).text);
    const sleepy=pickCompanionDialogue(characterId,{action:'sleep'});
    assert.notEqual(pickCompanionDialogue(characterId,{previousId:sleepy.id,action:'sleep'}).id,sleepy.id);
  }
  assert(pickCompanionDialogue('unknown').id.startsWith('chiikawa-'));
  for(const random of [()=>0,()=>1,()=>NaN,()=>-2,()=>3])assert(pickCompanionDialogue('chiikawa',{random}));
});

test('randomized companion pauses leave quiet time between short bubbles',()=>{
  assert.equal(companionDialogueDelay(()=>0),18000);
  assert.equal(companionDialogueDelay(()=>.5),25000);
  assert(companionDialogueDelay(()=>1)<32000);
});
