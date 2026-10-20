/** Shared character identities and movement profiles; raster assets stay in the renderer. */
export const DEFAULT_CHARACTER_ID = 'chiikawa';

export const CHARACTER_CATALOG = Object.freeze([
  {
    id: 'chiikawa', name: '치이카와', available: true,
    description: '조금 수줍고, 마음은 다정한 작은 친구', accent: '#f1a7b7',
    actionLabels: {idle:'가만히 기다리는',walk:'조심조심 걷는',happy:'작게 뛰고 기뻐하는',cry:'눈물을 흘리며 흐느끼는',sleep:'눈을 감고 쉬는',talk:'작게 소리를 내는'},
    speech: {
      idle:'…응.',walk:'응…!',happy:'와아…!',cry:'흐으… 흐아앙…',
      sleep:'…',talk:'와…?',greeting:'와…!',
      rise:'와아…!',fall:'흐아앙…',
    },
    motion: {
      idleMs: [4000, 9000], roamDistance: [140, 280], walkSpeed: 28,
      walkBurstMs: [2200, 3600], walkPauseMs: [280, 600], happyHopHeight: 0.065,
    },
  },
  {
    id: 'hachiware', name: '하치와레', available: true,
    description: '호기심 가득한 발걸음, 씩씩하고 다정한 친구', accent: '#a8d6eb',
    actionLabels: {idle:'주변을 궁금해하는',walk:'경쾌하게 구경하며 걷는',happy:'손을 들고 두 번 폴짝이는',cry:'잠깐 눈물을 보이고 마음을 추스르는',sleep:'편안하게 눈을 감은',talk:'다정하게 소식을 알려주는'},
    speech: {
      idle:'있잖아, 저건 뭘까?',walk:'가 볼까? 저쪽 말이야!',
      happy:'우와! 봤어? 방금 그거!',cry:'앗… 훌쩍. 잠깐 쉬어 갈까?',
      sleep:'조금만 쉬자. 여기서!',talk:'있잖아, 지금은 이만큼이래!',greeting:'있잖아, 오늘도 같이 볼까?',
      rise:'올랐어! 보고 있던 그 주식 말이야!',fall:'조금 내려갔네… 같이 확인해 볼까?',
    },
    motion: {
      idleMs: [3000, 7000], roamDistance: [180, 340], walkSpeed: 36,
      walkBurstMs: [2400, 3600], walkPauseMs: [180, 420], happyHopHeight: 0.09,
    },
  },
  {
    id: 'usagi', name: '우사기', available: true,
    description: '표정은 담담하게, 발걸음은 기운차게 움직이는 친구', accent: '#f4d980',
    actionLabels: {idle:'담담하게 주변을 보는',walk:'작은 보폭으로 빠르게 걷는',happy:'같은 얼굴로 짧게 두 번 폴짝이는',cry:'잠깐 멈칫하고 한쪽 발을 가볍게 움직이는',sleep:'눈을 감고 쉬는',talk:'짧게 외치는'},
    speech: {
      idle:'우냐…?',walk:'우라! 우라!',happy:'야하! 야하!',cry:'우냐…',
      sleep:'…',talk:'우라!',greeting:'야하!',
      rise:'야하!',fall:'우냐…',
    },
    motion: {
      idleMs: [2000, 5000], roamDistance: [220, 420], walkSpeed: 52,
      walkBurstMs: [1800, 3000], walkPauseMs: [120, 300], happyHopHeight: 0.075,
      paceVariation: 0.2,
    },
  },
].map(character => Object.freeze({
  ...character,
  actionLabels: Object.freeze(character.actionLabels),
  speech: Object.freeze(character.speech),
  motion: Object.freeze(Object.fromEntries(Object.entries(character.motion).map(([key, value]) => [key, Array.isArray(value) ? Object.freeze(value) : value]))),
})));

export function getCharacterProfile(id = DEFAULT_CHARACTER_ID) {
  return CHARACTER_CATALOG.find(character => character.id === id) || CHARACTER_CATALOG[0];
}

export function isAvailableCharacter(id) {
  return CHARACTER_CATALOG.some(character => character.id === id && character.available);
}
