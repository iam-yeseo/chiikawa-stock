# 우사기 모션 이미지 v2 — 0.4.1

제작일: 2026-10-20. Codex 내장 `image_gen`과 `imagegen` 스킬을 사용했다. CLI/API fallback 미사용.

- 최종 결과: `assets/character/usagi-atlas-v2.png` — 1254×1254 RGBA, 4×4의 16포즈, 실제 투명 배경.
- 편집 대상: `assets/character/usagi-atlas-v1.png`. 이전 이미지와 `char/` 원본은 보존했다.
- 형태 참고: `references-0.4.0/official-character-lineup.png`, https://www.anime-chiikawa.jp/images/characters/img_charapage.png 의 왼쪽 세 번째 우사기.
- 영상은 내려받지 않았다. 공식 영상 관찰과 앱용 해석은 `docs/usagi-references-0.4.1.md`에 기록한다. 새 그림은 공식 영상 프레임 추출물이 아니다.
- 변화: 웃는 눈·분노/걱정 눈썹·크게 벌린 입·큰 놀람 눈을 제거했다. 1번 눈감기와 3번 작은 말하기 입을 제외하면 둥근 눈과 완만한 곡선 눈썹, 닫힌 작은 입을 유지한다. 자세·손발·귀 각도의 작은 변화로 동작을 구분한다.
- 이미지 전체의 alpha≥32 최대 연결 본체 16개 영역에 2px 여백을 둔 crop은 `qa/character-alpha-0.4.1.json`과 `src/character-skins.js`에 있다. 균등 격자 경계가 귀를 자르지 않도록 전체 이미지에서 본체를 찾았다. 생성 픽셀을 Python 등으로 수정하지 않고 렌더러 좌표를 맞췄다.

## 최종 프롬프트

```text
Use case: identity-preserve.
Asset: replacement 4x4 animation sprite atlas for Usagi in Chiikawa Stocks 0.4.1.
Input image 1 is the EDIT TARGET, the existing Usagi sixteen-pose atlas. Input image 2 is the official reference lineup: ONLY the THIRD character from the left is Usagi. Preserve Usagi's identity, pale cream-yellow round body, long upright pink-inner ears, dark brown smooth outline, black round eyes with small white highlights, pink cheeks, tiny paws and feet. Match reference 2 anatomy and the neutral first cell in input1.
PRIMARY CHANGE: Usagi's expression stays essentially unchanged during movement. In official episode1, broad body movement retains round eyes and gently high curved eyebrows. This user's correction is crucial: DO NOT make expressive happy or sad faces. Copy the SAME neutral round eyes, gently arched eyebrows, and small CLOSED w mouth from the FIRST cell across EVERY pose, except blink cell1 and a TINY talking-mouth opening cell3. No enlarged eyes, no white shocked eyes, no furrowed, slanted, worried or angry eyebrows, no ^_^ smiling eyes, no wide open shouting mouth, no sad mouth, no tears. No rage or sadness expressed by face. Mouth NEVER becomes a large cavity. Neutral face is not blank: retain Usagi's actual distinctive small w mouth and curved eyebrows.
Layout: square transparent PNG, 4 equal columns and4 equal rows, exactly16 isolated full body sprites. Consistent size and proportions in all cells. Fixed cell center and foot baseline; generous empty gutters. Fit the complete long ears and both feet. No grid, text, symbols, motion streaks, shadows, exclamation marks, sparkles, background or props. Opaque cream fill inside the body; genuinely transparent outside. Avoid gradients, fuzzy glow, paper texture, furry texture, accessories, secondary characters. A crisp flat 2D anime sprite atlas, square2048x2048 if supported.
ROW-MAJOR poses with near-identical FACE:
0 neutral standing, arms relaxed; 1 brief gentle blink, neutral CLOSED mouth; 2 same neutral face, tiny weight shift with one paw slightly out; 3 SAME round eyes/brows, only a tiny 3-pixel-equivalent opening under the w mouth for talking.
4 short left step, opposite paw a little forward; 5 passing stance, face unchanged; 6 short right step; 7 other passing stance. Minimal ear tilt, identical ear length; feet actually different but body volume fixed.
8 notice good news by raising ONE tiny paw slightly, neutral face EXACTLY; 9 small anticipation crouch with knees/feet closer, neutral face; 10 short airborne hop, feet tucked only slightly, small arms outward, SAME eyes/eyebrows and CLOSED w mouth; 11 land calmly, paws lower, SAME normal face and upright ears.
12 brief still pause at bad news, SAME neutral face; 13 slight backward body lean and tiny paw pull-in, facial landmarks unchanged; 14 ONE small foot lifted for a light tap, arms close, SAME neutral face, no angry or sad expression; 15 normal standing recovery, same neutral face. No dramatic head squash. Make body/foot posture differences legible while keeping facial identity and expression stable.
Remember the main requested correction: replace the expressive 3rd/4th rows with Usagi's UNCHANGING everyday face. Do not invent emotional facial expressions.
```
