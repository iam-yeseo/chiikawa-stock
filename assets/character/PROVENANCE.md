# 캐릭터 원본과 제작 기록

제작일: 2026-10-20. 제작 도구: Codex 내장 `image_gen` (CLI/API fallback 사용 안 함).

## 결과 파일

- `chiikawa-atlas-v1.png`: 1254 × 1254, RGBA, 16개 전신 표정/포즈. 완전 투명 픽셀 46.6869%. 실제 생성된 크기가 요청한 2048 × 2048과 달라서, 균등 타일을 가정하지 않고 `src/character.js`의 실측 프레임 좌표를 사용한다.
- `app-icon.png`: 1254 × 1254, 불투명 PNG. 패키징 도구가 운영체제 아이콘 크기로 변환한다.
- `qa-light-dark.png`: Chrome에서 아이들·기쁨·오열을 밝은 배경/어두운 배경 위에 재생하여 확인한 스크린샷.
- `qa-pet-happy.png`, `qa-pet-cry.png`: 독립 펫 화면의 상승·하락 알림 스크린샷. 가상 테스트 가격.
- `qa-result.json`: 투명 창, 표정 프레임 변화, 눈물, 한글 말풍선, 국내 영숫자 종목코드 통화, 드래그, 산책 정지, 연결 오류 알림 중복 방지, 재연결, 설정 열기, 화면 크기 변경 검증 결과.

`char/` 원본 파일은 수정하지 않았다. 모든 참고 이미지를 시각적으로 확인했고, 특히 아래 파일을 생성기에 전달했다.

| 원본 | 역할 |
|---|---|
| `char/images.png` | 전신 비율, 얼굴, 귀, 팔다리 |
| `char/스크린샷 2026-10-20 09.16.37.png` | 웃는 눈과 입, 행복한 포즈 |
| `char/KakaoTalk_Photo_2026-10-20-09-42-03.png` | 전신 오열 표정, 눈물, 떨리는 몸 |
| `char/KakaoTalk_Photo_2026-10-20-09-48-52.png` | 최신 추가 이미지, 커다란 눈물과 울음 표정 |
| `char/channels4_profile.jpg` | 앱 아이콘의 얼굴과 색상 |

프레임은 참고 이미지에 기반한 새 생성물이다. 원본 이미지의 픽셀을 그대로 복제한 파일이나 공식 애니메이션의 실제 프레임은 아니다. 머리·몸 비율, 두 귀, 갈색 외곽선, 분홍 볼과 입 모양을 최대한 유지했다. 16프레임 중 걷기 4개, 기쁨 4개, 울음 4개, 기본 표정 4개를 사용한다. 60fps 위치 이동·점프·착지·호흡·떨림과 CSS 눈물 입자가 이 프레임들을 보완한다. 사운드는 없다.

## Atlas 최종 생성 프롬프트

```text
Use case: identity-preserve. Asset type: production transparent sprite atlas for a Chiikawa desktop pet. Create ONE EXACT 4 column x 4 row atlas on a 2048 x 2048 canvas with 16 square cells of 512x512 each. Background MUST be actual alpha transparency, no grid, no borders, no text. Every cell contains one full body Chiikawa, same model, scale, outline thickness, palette and center alignment. The provided images are character/style/expression references: image 1 full body proportions, image 2 happy expression and feet, image 3 full body crying expression, image 4 big tears and trembling distressed eyebrows. Faithfully preserve this original Chiikawa design: soft white untextured body, very large rounded head flowing into tiny pear body, two small rounded ears, dark warm brown handdrawn clean outline, little limbs, tiny mouth, pink oval cheeks with three tiny diagonal strokes, glossy round eyes. No outfit, no props, no shadow under feet, no new character. Each sprite is centered on x=256 within its cell, feet baseline y=450, head top around y=52; about 340 pixels wide, 400 pixels high, leave margin from edges. All faces looking toward camera. Row 1 four idle expressions: normal eyes open relaxed arms; subtle blink; gentle closed-eye content smile; open eyes soft speaking tiny mouth. Row 2 four actual walking-cycle poses with small alternating legs and opposite little swinging arms: left foot forward, passing neutral, right foot forward, passing neutral. Body must keep same proportions and mostly face front. Row 3 four exuberant happy expressions with eyes happily closed and mouth open as in image 2, arms lifting: anticipation crouch slightly, arms raised excitedly, airborne happy pose feet spread, soft landing joyful pose. Row 4 four visibly sobbing/crying frames faithful to images 3 and 4: distressed glossy big eyes and trembling eyebrows with small tears; wailing rectangular open mouth and tears streaming down both cheeks; eyes squeezing and mouth wide crying and long tears; gasping sob with tear streams and arms shaking near body. Cry frames must truly be crying, not smiling. Keep all art consistent and preserve same head/face identity across all 16 cells. Solid white interior fully opaque. Do not draw other characters, any text, captions, sparkles, arrows, frames or backgrounds. Precise even grid with generous transparent gutters is essential. This is an illustrated animation asset not a storyboard.
```

## 앱 아이콘 최종 생성 프롬프트

```text
Use case: identity-preserve. Create a production square desktop app icon 1024 by 1024 pixels from this exact Chiikawa face reference. Keep Chiikawa's face proportions, round ears, warm dark brown outlines, glossy eyes, pink blush cheek ovals with three strokes, small happy mouth, and solid white fill identical to the reference. Show the full face and both ears centered, occupying about 74 percent of the icon. Background should be a solid very pale warm pink #f7e4df, with a simple subtle cream circular halo behind the head. The outer image is fully opaque and square; no pre-rounded corners. No text, numbers, logos, stock arrows, accessories, other characters, gradients, shadows, textures, or details around the face. Crisp clean original-style flat animation drawing. Keep the drawing natural and friendly like the reference. This is the app icon for a Chiikawa desktop companion.
```

## 후속 모션 수정 방법

원본 참고 이미지는 유지하고 `image_gen`으로 `chiikawa-atlas-v2.png` 같은 별도 버전을 생성한다. 프레임 경계·투명도·캐릭터 비율을 재확인하고 `src/character.js`의 프레임 좌표와 import를 함께 변경한다. 밝은 바탕과 어두운 바탕에서 검은/유색 외곽 번짐과 잘린 팔다리를 확인한다. 기본 크기 150px와 최대 크기에서 재생한다.
