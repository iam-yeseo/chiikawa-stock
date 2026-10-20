# 0.5.0 artwork provenance

Date: 2026-10-20. Generated with the built-in image_gen tool (imagegen skill), transparency requested for every image. Source character reference: `assets/character/references-0.4.0/official-character-lineup.png`; Korean lettering reference: `assets/character/references-0.5.0/daewon-korean-brand-reference.png`. See `docs/character-references-0.5.0.md` for recent animation observations and the limits of Korean speech research.

All final atlases have 16 poses. Two arms/two feet checked visually; renderer paints one opaque pose at a time to prevent ghost limbs. Chiikawa first attempt had uneven row counts and was rejected; a dedicated image edit corrected the 4-by-4 layout. No production raster pixels were changed with Python. Frame bounds were measured from global alpha components (alpha >= 32, two-pixel padding); original alpha is retained. Original char files and prior atlases remain unchanged. App icon unchanged.

Generated file directory: `/Users/callam4/.codex/generated_images/01a156b6-30ac-7390-92e4-b9cd21155266/`.

## Logo

Final path: `assets/brand/meonjakju-logo-v1.png`

Generated file: `exec-0027afaa-4b53-4c20-8b78-47ba4f339ef9.png`

Prompt:

```text
Use case: logo-brand. Create a transparent raster Korean wordmark for a desktop stock companion app. Input reference is the official Korean Chiikawa/먼작귀 brand card; use ONLY its top hand-lettering as a visual reference, do not copy characters or card scenery. Required exact text: "먼작주" (three Hangul syllables: 먼 / 작 / 주). It must read 먼작주, NOT 먼작귀. Warm dark chocolate brown #654a3c ink, charming thick rounded hand-drawn strokes with slight irregularity, broad squat syllables and a gently playful baseline reminiscent of the Korean reference lettering. Three syllables on ONE horizontal line. Clean continuous opaque strokes, excellent readability at 150px wide. Tight horizontal composition around the lettering with modest transparent padding. No subtitle, no English, no hearts, no character faces, no stock chart, no border, no white badge, no shadow. Truly transparent background. Output high-resolution horizontal logo artwork.
```

## Hachiware

Final path: `assets/character/hachiware-atlas-v2.png`

Generated file: `exec-94d7b904-221e-4565-8f0e-908ffc108282.png`

Prompt:

```text
Use case: stylized-concept. Production animation sprite atlas for HACHIWARE, the second character from the LEFT in supplied official Chiikawa lineup image. That lineup is the sole identity reference: short white rounded cat-like body, blue symmetrical top hair/ears with central white forehead arc, two small pointed ears, brown round eyes with tiny white shine, tiny cat mouth, pink cheek ovals with three brown hatch marks. Match official proportions and dark brown hand-drawn linework, flat fully opaque white and blue fills, not gradients or 3D. Rebuild cleanly from scratch.
Make EXACTLY sixteen separate full-body poses, arranged 4 columns x 4 rows with broad TRANSPARENT gutters, each entirely within its cell, equal scale and consistent face/body proportions. Background genuinely transparent; character interiors fully opaque. No floor, shadows, words, props, trails, duplicate outlines, emotion symbols.
CRITICAL ANATOMY: In EVERY pose there are EXACTLY TWO ARMS TOTAL and TWO FEET TOTAL. Each arm is a simple short rounded appendage with one attachment to body. When hands move to front/chest/cheeks or up, the SIDE of the body must be a SMOOTH UNBROKEN curve with NO leftover side-arm nubs. Never draw two front hands plus two side arms. No finger drawings, no claws, no tail. The wide head blends into a short rounded torso. Feet are two tiny nubs only.
Pose indices left-to-right/top-to-bottom:
0 neutral front relaxed TWO arms at sides;
1 same relaxed pose with closed blink eyes;
2 warm small closed-eye smile, same two side arms;
3 small natural speaking open mouth, TWO side arms;
4 small walking step left foot forward, TWO arms gently swung;
5 passing walking pose, TWO arms;
6 small walking step right foot forward, TWO arms gently swung;
7 passing walking pose opposite, TWO arms;
8 noticing something nice, tiny open mouth, ONLY TWO short arms raised partway attached at sides;
9 anticipation small crouch, ONLY TWO arms held inward, SMOOTH sides no extra nubs;
10 one small joyful hop, ONLY TWO arms raised outward at shoulders, two feet lifted slightly;
11 landing and warm smile, ONLY TWO arms relaxed at sides;
12 surprised but restrained downturn reaction, TWO arms down;
13 shoulders slightly lowered, small worried mouth, ONLY TWO arms down and NO hands on chest;
14 two tiny tears under eyes, ONLY TWO arms down, same simple body;
15 calm recovered reassuring small smile, TWO side arms.
Subtle optimistic curious personality from recent official animation: short steps, small glance pauses, two modest celebratory hops; brief worry then composure. No extreme face deformation or huge grin. Maintain consistent limb positions suitable for crisp sequential frame animation. Output square high resolution 4x4 atlas.
```

## Chiikawa first generation (layout rejected)

Final path: `not used`

Generated file: `exec-5cfdef6c-1af3-4801-89e6-961773e57854.png`

Prompt:

```text
Use case: stylized-concept. Production animation sprite atlas for CHIIKAWA, the FIRST character from the LEFT in supplied official Chiikawa lineup. Sole identity reference: white rounded body, two tiny round ears, brown round eyes with small white shine, short soft eyebrows, tiny w-like mouth, pink oval cheeks with three brown hatches. Original official broad round head flows directly into very short small body; not a tall human torso. Flat fully opaque white interior, uniform dark-brown handdrawn outlines, not3D.
Create exactly SIXTEEN isolated FULL-BODY poses in4columns x4rows on truly TRANSPARENT background, wide gutters, NO frame labels, no groundshadow or props. Same headsize/proportions and consistent baseline within each cell, everything includingears/feet inside cell. Every pose exactly TWO little arms and TWO tiny feet, no fingers. If arms are in front or raised, REMOVE original side-arm nubs completely: sides must be smooth. Never four arms.
Frames left-right top-bottom: 0 timid neutral attentive;1 same closed-eye blink;2 tiny quietly pleased smile;3 tiny surprised a-mouth, simple nonverbal utterance;4 slow short leftstep with2relaxedarms;5 passingstep;6 rightstep;7 passingstep;8 quiet happiness tinyopenmouth twoarmsraisedjustslightly;9 modestanticipationcrouch withtwoarmsdown;10 small shyhop withONLYtwoarmslifted outward;11 landingwarmrelief;12 stunneddeclinenotice smallworriedmouth;13 tearywateryeyes, shouldersdrawnin and ONLYtwohands heldnearcheeks, smoothsidesNOextralimbs;14 crying withtwostreamingtearsandtinyquiveringmouth ONLYtwohandsclose tocheeks smoothbody;15 stillsnifflingwithtwoarmsdownandtinytearstops. No extreme stretch, no enormous mouth, no spinning or aggressiveexpressions. Soft hesitant gestures and sustained sniffling like recent official anime. Exact same character identity in allframes, two arms/twofeet check everycell. Square high-resolution atlas.
```

## Chiikawa corrected final

Final path: `assets/character/chiikawa-atlas-v3.png`

Generated file: `exec-603e5455-2135-4f2c-8e63-b4d46bd1468d.png`

Prompt:

```text
Edit this Chiikawa sprite atlas to correct ONLY its layout, scale consistency and anatomy. Keep the same faithful official character identity, colors, drawing style and 16 intended poses. IMPORTANT: final sheet must be EXACTLY 4 columns in EACH of 4 rows (4+4+4+4), not the current 4+4+5+3. Reposition the surprised worried pose currently at right of row3 into row4 column1. Row4 should then be surprised/worried, watery eyes hands nearcheeks, crying two tears hands nearcheeks, recovering small tears armsdown. Keep all heads at the SAME size across the ENTIRE sheet. Crouch/hop only changes feet/bodyheight slightly; do not shrink row3characters. Every walking pose has TWO distinct visible tiny feet, no singlefoot or crossedonefoot. ExactlyTWOarms perpose; front/raisedarms replace sidearms completely. Place all fullbodies comfortably insideequalgridcells with large transparentgutters and noearclipping. There are exactly16poses,4perrow. Maintain transparentbackground and fullyopaquewhitecharacterinteriors. No lines, no grid, no numbers, no labels, no shadows, noextraposes. Output a square4x4atlas.
```

## Usagi

Final path: `assets/character/usagi-atlas-v3.png`

Generated file: `exec-df7a3a07-84bb-4036-87d6-b81abbb09edc.png`

Prompt:

```text
Use case: stylized-concept. Rebuild USAGI from Chiikawa for a desktop animation atlas, faithfully based ONLY on THIRD character from LEFT in attached officiallineup. Palecreamyellow round head/body, TWOlonguprightearswithpale pink interiors, round brownoutlined black/darkeyeswithtinywhiteshine, raisedarchedthinbrows,tinyclosedωcatlike mouth, ovalpinkcheeks with3hatches. No furtexture, no 3D, flat fullyopaque pastelinterior and darkbrown drawnoutline. Bodyshape officiallongearswideheadshorttorso.
Output exactly16isolated fullbodyposes in4columns x4rows on trueTRANSPARENCY. Equal proportions/scale, generous gutters; ears fullyINSIDEcell andneveroverlapneighbors. No shadows, words, props, motionlines or symbols. Anatomy EVERYpose exactlyTWOarms+TWOtinyfeet only. Frontarms or raisedarms replace sidearmstumps; keepbodyedges smooth NOextraarms.
Mostimportant: Usagi retains almost EXACTsame face inallawakeposes. Roundeyesnormal, raisedsoftbrows, tinyωmouth unchanged. No angryeyebrows, anguishedcrying, tears, giantopenmouth, humanemotionalgrin. The energy lives in posture and shortquicksteps instead.
Frame0 neutralfronttwosidearms;1blinkwithnarrowclosedeyes;2sameas0 tinyheadtilt;3sameeyesandtinynearlyclosedmouth;4leftquickshortstep, tinyarmswing;5passingstep;6rightstep;7passingstep;8noticingrise SAMEFACE armsgentlyoutward;9smallcrouchforhop SAMEFACE twosidearms;10modesthop SAMEFACE onlytwoarmsoutward,2feetlifted;11landing sameface;12briefstilldownturnreaction sameface;13slightbody lean sameface;14onefoottapsameface,only2arms2feet;15uprightneutralrecovered sameface. Face remainsstableevenonrise/fall. Earsconsistentlongroundedtips, tinyflexonly. Grounded stockyposebody ratherthanstretchedathlete. No extralimbs, inspectall16cells. Square highresolution atlas.
```
