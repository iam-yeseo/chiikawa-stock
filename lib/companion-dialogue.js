import {DEFAULT_CHARACTER_ID} from './characters.js';

// Everyday companion lines are separate from market reactions so this mode
// cannot accidentally pick a price report or a stock-specific catchphrase.
const lines = {
  chiikawa: [
    ['응…!', 'talk'], ['와아…!', 'happy'], ['에…?', 'talk'],
    ['으응…', 'talk'], ['와…?', 'talk'], ['아…!', 'happy'],
    ['응. 응…!', 'talk'], ['와아… 와…!', 'happy'], ['에헤…', 'happy'],
    ['…응.', 'idle'], ['으아…?', 'talk'], ['…으응.', 'sleep'],
  ],
  hachiware: [
    ['있잖아, 오늘은 어디로 가 볼까?', 'talk'],
    ['우와! 여기, 쉬어 가기 좋다!', 'happy'],
    ['같이 걸으니까 더 재밌네!', 'happy'],
    ['저쪽도 구경해 볼까? 천천히 가자!', 'talk'],
    ['맛있는 거 먹고 싶다. 너도 그래?', 'talk'],
    ['뭔가 좋은 일이 생길 것 같아!', 'happy'],
    ['어라? 이쪽은 처음 와 보는 것 같아!', 'talk'],
    ['괜찮아! 잠깐 쉬었다 가면 되지!', 'talk'],
    ['작은 것도 자세히 보면 재밌어!', 'talk'],
    ['오늘도 만나서 반가워!', 'happy'],
    ['후아… 조금만 쉬자. 여기서!', 'sleep'],
    ['있잖아, 그냥 같이 있어도 좋네!', 'idle'],
  ],
  usagi: [
    ['야하!', 'happy'], ['우라! 우라!', 'talk'], ['우냐…?', 'talk'],
    ['야하하!', 'happy'], ['푸루루루!', 'talk'], ['우라아아!', 'happy'],
    ['하아? 야하!', 'talk'], ['우랴!', 'happy'], ['야하! 우라!', 'talk'],
    ['푸루…?', 'talk'], ['우냐!', 'idle'], ['…우냐.', 'sleep'],
  ],
};

export const COMPANION_DIALOGUE = Object.freeze(Object.fromEntries(
  Object.entries(lines).map(([characterId,entries]) => [characterId,Object.freeze(
    entries.map(([text,action],index) => Object.freeze({id:`${characterId}-${index}`,text,action})),
  )]),
));

const boundedRandom = random => Math.min(1-Number.EPSILON,Math.max(0,Number(random())||0));

/** Avoid an immediate repeat even with a deterministic/randomly unlucky draw. */
export function pickCompanionDialogue(characterId,{previousId=null,action=null,random=Math.random}={}) {
  const catalog=Object.hasOwn(COMPANION_DIALOGUE,characterId)?COMPANION_DIALOGUE[characterId]:COMPANION_DIALOGUE[DEFAULT_CHARACTER_ID];
  const matching=action?catalog.filter(line=>line.action===action):catalog;
  const available=matching.length?matching:catalog;
  const fresh=available.filter(line=>line.id!==previousId);
  const pool=fresh.length?fresh:catalog.filter(line=>line.id!==previousId);
  return pool[Math.floor(boundedRandom(random)*pool.length)];
}

export function companionDialogueDelay(random=Math.random) {
  return 18000+boundedRandom(random)*14000;
}
