# 치이카와 모션 이미지 v2

제작일: 2026-10-20. 도구: Codex 내장 `image_gen` (`imagegen` 스킬). CLI/API fallback 미사용.

## 결과와 참고 이미지

- 결과: `assets/character/chiikawa-atlas-v2.png` — 1254 × 1254 RGBA, 16프레임, 완전 투명 픽셀 47.0286%.
- `char/images.png`: 본래 얼굴·귀·몸통·팔다리 비율.
- `char/스크린샷 2026-10-20 09.16.37.png`: 웃는 눈과 입.
- `char/KakaoTalk_Photo_2026-10-20-09-48-52.png`: 걱정스러운 눈썹과 눈물.
- `char/KakaoTalk_Photo_2026-10-20-09-42-03.png`: 작은 입으로 흐느끼는 표정과 몸의 자세.

`char/` 원본과 `chiikawa-atlas-v1.png`는 보존했다. 새 파일은 원본을 참고하여 생성한 이미지이며 공식 애니메이션의 실제 프레임이나 픽셀 단위 복제물은 아니다. 요청 크기와 생성 크기가 달라 실제 알파 영역을 측정해 프레임 좌표를 사용한다.

행별 순서: 기본·눈깜박임·수줍은 미소·말하기 / 작은 걸음 4개 / 놀람에서 소소한 기쁨까지 4개 / 눈물 맺힘·흐느낌·눈 감고 울기·잔잔한 눈물 4개. 렌더러에서 바닥 위치를 맞추고 과도한 신축과 회전을 제거한다.

영상 관찰 및 모션 해석은 `docs/motion-references.md`, 캐릭터 추가 구조는 `docs/character-packs.md`를 참고한다. 렌더링 확인 결과는 `QA.md`와 `qa/`에 기록한다.

## 최종 생성 프롬프트

```text
Use case: identity-preserve. Asset: revised production animation sprite atlas for a Chiikawa desktop companion. The four input images are reference images, not a layout to copy. Image 1 defines exact Chiikawa model/proportions/linework; image 2 defines the happy face; image 3 and 4 define the actual tearful worried face. Draw one 4 by 4 regular grid of 16 full-body Chiikawa sprites, on one square 2048x2048 actual transparent RGBA canvas. No visible grid, text, backgrounds or cell borders. Each cell 512x512, same scale, center x=256, fixed feet baseline y=464, top of ears around y=55. Keep every sprite entirely inside its own cell with generous empty gutters. CRITICAL IDENTITY: match original reference rather than a generic cute hamster. Broad round white head/body, very short rounded ears (not long), two tiny short arms and two tiny feet, dark near-black/warm brown handdrawn outlines, cheek ovals pale pink with THREE short black strokes, original black oval eyes with white lower curved highlights, tiny w-like mouth with lower lip mark. Same head width and volume in every cell. No fur texture, eyebrows only when reference expression has them, NO added blush on nose, NO clothing, NO glitter, NO accessories, NO cast shadow, NO white matte background. Solid opaque white inside the body; actual transparency outside.
Motion art direction: shy, tentative, very restrained. No athletic jumps, no large open arms, no spinning, no stretched/squashed body. Subtle differences are intentional. Row1 left-to-right: (0) normal quietly standing face from ref1, short arms hanging; (1) same standing pose but eyes gently closed for blink; (2) small timid content smile, paws together in front of chest, eyes gently closed; (3) same neutral model with small speaking mouth, paws near tummy. Row2: four tiny hesitant walking poses at SAME height and face direction; (4) left tiny foot slightly forward and opposite paw subtly forward, (5) feet together pause, (6) right tiny foot slightly forward and opposite paw subtly forward, (7) feet together other passing pose. Minimal head bob, character facing mostly front with a very slight sideward gaze. Row3: four quiet happiness poses; (8) shy realization, open shining eyes and paws close to cheeks, (9) happy eyes closed and small open happy mouth like ref2, both paws lifted only to chest height, (10) same delighted face and very small arms-out pose with feet together, (11) bashful pleased settling pose, paws together and eyes softly closed. Ground position stays fixed; game code adds one little hop. Row4: four authentic crying stages like ref3 and ref4; (12) stunned worried glossy eyes, wavering brows, closed tiny mouth, tears pooled at lower eyes; (13) tears stream vertically below both eyes, small square open sobbing mouth as ref4, arms close to sides; (14) eyes tightly squeezed for one sob, paws touching cheeks, mouth crying not smiling, thin streaming tears; (15) large watery open eyes again, little gasp square mouth, paws lowered, continuous tear streams. Crying face must read distressed and fragile, not happy. Do not enlarge eyes into generic anime eyes. Keep outline thickness and head proportions identical through all16 cells. Clean flat 2D official-reference appearance, no gradients, glow, texture, 3D, lettering, motion lines, decorative dots or symbols.
```
