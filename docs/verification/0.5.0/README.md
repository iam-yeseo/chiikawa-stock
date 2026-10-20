# 0.5.0 공개 검증 자료

2026-10-20 로컬 검증에서 생성한 결과 중 [QA.md](../../../QA.md)가 참조하는 자료만 선별했다. 새로운 실행 결과를 만든 것이 아니며, GitHub CI나 실제 Windows 업그레이드의 성공을 증명하는 자료도 아니다.

JSON은 `qa/`의 원본에서 사용자 절대 경로를 `<workspace>`, 임시 프로필 경로를 `<temporary-profile>`로 바꾼 사본이다. 테스트 결과·버전·시간·측정값·체크섬은 그대로다. JSON 내부의 `qa/` 이미지 목록은 원본 검사 시 생성한 로컬 파일 목록이며, 모든 원본 이미지를 공개한 것은 아니다.

스크린샷은 API 키 없이 실행한 데모 화면 세 장과 캐릭터만 표시한 모션 화면 한 장이다. 화면의 종목 가격과 보유 표시는 가상 데이터이며 실제 계좌 정보가 아니다. `brand-update-manual-0.5.0.png`의 0.5.1 알림은 화면 검증을 위한 합성 이벤트로, 0.5.1 배포를 뜻하지 않는다. 실제 사용자 프로필, API 키, 계좌 화면 또는 라이브 시세 스크린샷은 포함하지 않는다.

| 자료 | 범위 |
| --- | --- |
| [desktop-smoke.json](desktop-smoke.json) | 소스 Electron 기본 동작 |
| [portfolio-0.5.0.json](portfolio-0.5.0.json) | 합성 계좌 데이터와 IPC 검사 |
| [characters-0.5.0.json](characters-0.5.0.json) | 소스 캐릭터 선택·타임라인·canvas |
| [roaming-0.5.0.json](roaming-0.5.0.json) | 소스 산책과 연속 알림 |
| [brand-updates-0.5.0.json](brand-updates-0.5.0.json) | 소스 브랜드·글꼴·업데이트 UI/IPC |
| [packaged-smoke.json](packaged-smoke.json) | Mac Apple Silicon 패키지 기본 동작 |
| [characters-0.5.0-packaged.json](characters-0.5.0-packaged.json) | Mac 패키지 캐릭터 검사 |
| [brand-updates-0.5.0-packaged.json](brand-updates-0.5.0-packaged.json) | Mac 패키지 브랜드·업데이트 UI/IPC |
| [package-integrity.json](package-integrity.json) | 로컬 세 플랫폼 패키지 버전·파일 일치·SHA-256 |
| [atlas-measurements-0.5.0.json](atlas-measurements-0.5.0.json) | 생성 이미지 크기·crop 측정값 |
| [character-art-0.5.0.json](character-art-0.5.0.json) | 캐릭터 모션 캡처 시 상태 |

이미지: [관심종목](brand-watchlist-0.5.0.png), [설정](brand-preferences-0.5.0.png), [수동 업데이트 안내](brand-update-manual-0.5.0.png), [세 캐릭터 모션 1.1초](character-art-0.5.0-1100ms.png).
