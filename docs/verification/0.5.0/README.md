# 0.5.0 공개 검증 자료

2026-10-20 검증에서 생성한 결과 중 [QA.md](../../../QA.md)가 참조하는 자료를 선별했다. 로컬 실행 자료, 공개 서버 응답, 모의 배포 스크립트 검사는 아래 표에서 구분한다. Windows·macOS CI 결과는 [정식 태그 실행](https://github.com/iam-yeseo/chiikawa-stock/actions/runs/39375729834)에서 확인할 수 있다. 실제 이전 버전에서 새 버전으로 설치하는 전체 과정은 검증하지 않았다.

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
| [release-0.5.0.json](release-0.5.0.json) | 공개 릴리스의 9개 자산·Windows 설치 파일 다운로드 체크섬·실제 Mac 업데이트 조회 |
| [release-publisher-0.5.0.json](release-publisher-0.5.0.json) | 실제 워크플로 스크립트의 7가지 입력 검사, 모의 `gh`·로컬 파일 사용 |

이미지: [관심종목](brand-watchlist-0.5.0.png), [설정](brand-preferences-0.5.0.png), [수동 업데이트 안내](brand-update-manual-0.5.0.png), [세 캐릭터 모션 1.1초](character-art-0.5.0-1100ms.png).
