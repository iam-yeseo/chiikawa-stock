# 0.5.0 검증 기록

검증일: 2026-10-20. 코드 리뷰의 1~10번 수정을 먼저 검증한 뒤 먼작주 브랜드, 캐릭터 이미지·말투, 업데이트 기능을 적용했다. 이전 기록은 로컬 파일 `qa/QA-0.4.1.md`에 보존했다.

공개 검증 자료는 [docs/verification/0.5.0](docs/verification/0.5.0/README.md)에 선별 보관했다. 데모·합성 응답 결과만 포함하며 JSON의 사용자 절대 경로와 임시 프로필 경로는 가렸다. 실제 계좌 화면은 포함하지 않는다.

## 현재 확인 상태

| 범위 | 결과 | 근거·남은 확인 |
| --- | --- | --- |
| 단위·회귀 테스트 | 통과 | `npm test`: 130개 통과, 실패 0 |
| 프런트엔드 빌드 | 통과 | 최종 로고·세 캐릭터·글꼴 포함 |
| 소스 Electron 실행 | 통과 | desktop / portfolio / characters / roaming 및 브랜드·업데이트 IPC 검사 |
| Mac Apple Silicon 패키지 | 로컬·네이티브 CI 통과 | 기본 실행·브랜드·캐릭터·펫 알림 검사, 일반 모드에서 기존 키로 LIVE 연결 확인 |
| Mac Intel 패키지 | 최종 빌드·무결성 통과 | Intel 실기기 실행 미확인 |
| Windows x64 패키지 | 네이티브 CI 통과 | 저장 경합 수정 후 소스·패키지 실행·캐릭터·브랜드·업데이트 IPC 검사 통과 |
| GitHub 코드·정식 릴리스 | 공개 완료 | `v0.5.0` → `297f4a1e6a0499cd6c05ab7a99446c4bdbba9b64`, [정식 릴리스](https://github.com/iam-yeseo/chiikawa-stock/releases/tag/v0.5.0), 업데이트 피드 공개 |
| Google Drive 코드 백업 | 업로드 확인 | 사용자가 지정한 개인 Drive 폴더에 소스 ZIP 보관, 파일 이름·크기·상위 폴더 확인 |

[최종 수동 CI](https://github.com/iam-yeseo/chiikawa-stock/actions/runs/39375014436)와 [정식 태그 CI](https://github.com/iam-yeseo/chiikawa-stock/actions/runs/39375729834)가 Windows·macOS 모두 성공했다. 태그 CI의 publish 단계도 완료됐다. 이후 main에 추가한 검증 기록과 배포 파일 선별 규칙은 앱 실행 코드·이미지를 바꾸지 않으며, 공개된 태그와 설치 파일은 교체하지 않았다.

## 코드 리뷰 수정

- **시세 부분 실패 격리:** `/prices`를 20종목씩 요청하고 `404 stock-not-found`일 때만 이분 탐색한다. 미제공 종목은 이후 REST·전일 종가·WS 대상에서 제외하고 나머지 연결을 유지한다. 화면의 `시세 미제공` 표시로 원인 종목을 구분한다. 명시적 시작 또는 관심종목 변경 시 다시 확인한다. 100종목 중 하나만 실패하는 경우, 21종목 청크 경계, 제외 목록 재사용 및 401/403/429/500 경로를 회귀 테스트했다.
- **계좌 선택 유지:** 동일 모드의 stop/start·재연결에서 선택 ID만 유지하고 금액·보유 데이터는 비운다. 데모/라이브 전환은 ID도 초기화하며 서버 목록에서 사라진 계좌는 첫 계좌로 복구한다.
- **80~300px 크기:** 설정·검증·펫·드래그의 공통 범위를 사용한다. 80·290·300px 실제 렌더링과 300px 말풍선·화면 경계·드래그를 검사했다.
- **설정 저장 합치기:** 최초 시세 수신 가격을 등록가로 저장하는 기존 의미는 유지한다. REST/데모 루프는 한 번, WS는 기존 120ms 상태 전송에 맞춰 저장 이벤트를 합친다.
- **상태 복제 줄이기:** 서비스의 state payload를 재사용한다. IPC 조회와 인자 없는 publish는 새 스냅샷을 만들며 절전 중 stale 표시는 유지한다.
- **검색 목록 복구:** 거래소별 성공 목록을 유지하고 실패 후 60초 동안 재시도를 제한한다. `3/7 거래소` 진행 상태와 부분 목록 사용 상태를 표시한다.
- **스펙 정합성:** 보유 자산의 가상 `account-not-found` 분기를 제거했다. 실제 400/404 오류에서 민감한 서버 메시지를 노출하지 않는지 검사했다. WS rate limit은 연결을 유지한 채 약 1초 후 전체 구독을 다시 선언하고 연속 편집은 300ms로 합친다. 반복 실패와 server-shutdown의 복구 경로는 유지한다. 토큰 발급에는 220ms AUTH 간격을 적용했다.
- **펫 정리:** 산책 설정이 실제 바뀔 때만 중지 상태를 정리하고 대체 정기 알림의 최소 간격을 0.1분으로 맞췄다.

전일 종가 날짜 계산, 기존 요청 그룹 간격, 보유 자산 필드·통화 매핑, WS PING/pong·토픽 형식과 비동기 revision 가드는 유지했다. safeStorage·CSP·격리 및 IPC 발신 창 검증도 유지한다.

## Windows CI에서 발견한 저장 경합

최초 Windows 네이티브 CI는 `session.json`으로 20개 저장이 동시에 진행되는 테스트에서 `rename`의 `EPERM` 오류로 실패했다. Mac에서 통과했던 동일 테스트가 실제 Windows 파일 교체 경합을 드러냈다.

`atomicWrite`에 대상 경로별 저장 큐를 두어 호출 순서대로 처리하고 마지막으로 큐에 넣은 값이 남게 수정했다. 실패한 저장 뒤에도 다음 저장을 진행하며 다른 대상 파일은 독립적으로 저장한다. Windows의 `EPERM`·`EACCES`·`EBUSY`만 25/50/100/200/400ms 간격으로 최대 5회 재시도한다. 기존 파일을 삭제한 뒤 쓰거나 평문으로 우회하지 않는다.

최종 순서·임시 파일 정리, 실패 후 큐 복구, 기존 파일 보존, 재시도 한도, 비-Windows/영구 오류의 즉시 실패를 검증했다. 저장 테스트 8개와 전체 테스트 **130개**가 로컬과 Windows·macOS CI에서 통과했다.

## 캐릭터와 UI

최근 공식 한국어 AniBox 239·241·248화의 실제 플레이어 화면과 일본 공식 재공개 영상을 확인했다. 이번 제작에는 1화를 참고하지 않았다. 한국어 음성을 직접 청취·전사한 검증은 하지 못했으므로, 하치와레 문장 리듬은 공식 영상 댓글과 공개 커뮤니티의 말투 재현을 보조 근거로 만든 앱용 표현이다. 관찰 시점·자료별 한계는 [참고 기록](docs/character-references-0.5.0.md)에 구분했다.

- `chiikawa-atlas-v3.png`, `hachiware-atlas-v2.png`, `usagi-atlas-v3.png`를 각 16포즈로 다시 생성했다. 모두 1254×1254 RGBA이며 원본과 이전 이미지는 보존했다.
- 각 포즈의 팔 두 개·발 두 개를 육안 확인했다. 손을 앞으로 올렸을 때 옆팔이 더 남지 않게 구성하고 렌더러가 서로 다른 포즈를 겹쳐 그리지 않게 수정했다. 이동·회전은 계속 부드럽게 보간한다.
- 치이카와는 짧은 감탄사와 작은 걸음·눈물, 하치와레는 친근한 한국어 발견·질문과 짧은 뜀·회복, 우사기는 짧은 외침과 거의 고정된 얼굴·빠른 발 움직임을 사용한다. 가격과 등락률은 대사와 별도 영역에 표시한다.
- 전체 alpha 영역을 측정해 여백을 둔 crop을 적용했다. 실제 canvas, 작은/큰 크기, 밝고 어두운 배경과 0.1~3초 모션 화면을 확인했다. [측정값](docs/verification/0.5.0/atlas-measurements-0.5.0.json), [모션 상태](docs/verification/0.5.0/character-art-0.5.0.json), [제작 프롬프트](assets/character/PROVENANCE-0.5.0.md).
- 새 먼작주 로고, TmoneyRoundWind Regular/ExtraBold, 40px 분홍 제목 표시줄과 `먼작주 0.5.0`을 확인했다. 가격·입력·선택·버튼·펫 말풍선에도 같은 글꼴을 적용했다. 장식 문구와 알림기록 탭을 제거하고 하단에 읽을 수 있는 투자 판단 책임 안내를 둔다. 앱 아이콘은 유지했다.

[세 캐릭터 모션 화면](docs/verification/0.5.0/character-art-0.5.0-1100ms.png)은 1.1초 시점의 데모 렌더링이다. 생성 이미지는 공식 애니메이션 프레임의 추출물이 아니며 공식 원본과 픽셀 단위로 동일하다는 의미가 아니다.

## 소스 Electron 실행 결과

모두 macOS Apple Silicon에서 임시 데모 프로필로 실행했다. 실제 API 키·계좌 데이터는 열거나 바꾸지 않았으며 검사 후 임시 프로필을 삭제했다.

| 명령 | 확인 내용 | 결과 파일 |
| --- | --- | --- |
| `npm run test:desktop` | 설정·펫 두 창, 항상 위/투명 펫, 20개 데모 시세, 검색·필터, 말풍선 크기 저장·복원, 상승/하락 | [desktop-smoke.json](docs/verification/0.5.0/desktop-smoke.json) |
| `npm run test:portfolio` | 계좌 마스킹, KRW/USD 분리, 자동 관심종목, 새로고침, 주기 안내·IPC 거부 | [portfolio-0.5.0.json](docs/verification/0.5.0/portfolio-0.5.0.json) |
| `npm run test:characters` | 반복 선택, 9개 반응 타임라인, canvas 색상·경계, 동작 줄이기, 재실행 복원 | [characters-0.5.0.json](docs/verification/0.5.0/characters-0.5.0.json) |
| `npm run test:roaming` | 연속 알림 중 이동, 산책 끄기·재개, 실제 시간 이동 | [roaming-0.5.0.json](docs/verification/0.5.0/roaming-0.5.0.json) |
| `node scripts/smoke-brand-updates.mjs` | 네이티브 제목·버전, 글꼴·로고, 삭제한 UI, 면책 문구, 업데이트 IPC·화면·펫 안내 말풍선 | [brand-updates-0.5.0.json](docs/verification/0.5.0/brand-updates-0.5.0.json) |

산책 검사에서 약 **3.0초** 안에 첫 이동을 확인했고, 30초간 시작점 대비 최대 이동은 약 **285px**였다. 말풍선 표시 중에도 이동했다. 각 실행 검사의 renderer 오류는 0개다.

최종 화면은 진입 애니메이션이 끝난 뒤 촬영했다: [관심종목](docs/verification/0.5.0/brand-watchlist-0.5.0.png), [설정](docs/verification/0.5.0/brand-preferences-0.5.0.png), [수동 업데이트 안내](docs/verification/0.5.0/brand-update-manual-0.5.0.png). 업데이트 안내 이미지는 합성 이벤트로 표시한 UI 검증이다.

## 업데이트와 패키지

Windows는 NSIS 설치판의 다운로드·재시작 설치를 사용자 동작으로 실행하도록 구성했다. Mac은 사용자가 선택한 수동 ZIP 다운로드·앱 교체 방식이다. 인증서 없는 Mac 빌드를 자동 설치라고 표시하지 않는다.

시작 15초 후와 6시간 주기 확인, 안정 버전·정확한 저장소/태그/다운로드 URL 검증, 중복 확인 합치기, 오류·재시도 처리를 테스트했다. 설정 창만 업데이트 IPC를 호출할 수 있고 펫 창 호출은 거부했다. 데모에서는 실제 업데이트 네트워크·다운로드·설치를 막는다. 수동 안내·자동 다운로드 진행률·명시적 설치 버튼은 합성 이벤트로 검사했다. **실제 이전 버전에서 새 버전으로 설치되는 전체 과정은 아직 검증하지 않았다.**

업데이트 상태는 펫에도 전달하여 새 버전 안내 말풍선을 표시한다. 서명 없는 Mac에서 OS 알림이 표시되지 않아도 앱 자체 안내를 볼 수 있다. Windows 알림의 AppUserModelId도 지정했다. 펫의 새 버전 말풍선은 소스 Electron 검사에서 합성 업데이트 이벤트로 확인했으며, 펫이 다운로드·설치 IPC를 직접 호출할 수 없다는 제한은 유지한다.

초기 Mac 패키지의 `SIGTRAP` 종료를 확인했다. 번들 및 helper의 내부 이름을 ASCII `Meonjakju`로 구성하고 `CFBundleDisplayName`은 `먼작주`로 유지한 뒤 최종 패키지가 정상 실행됐다. 업데이트 모듈의 오류로 확인된 것은 아니다. `app.setName('Chiikawa Stocks')`, 기존 userData 위치와 `im.chii.stocks`는 이전 설정·Keychain 호환을 위해 유지한다.

저장 경합·펫 업데이트 안내 보완을 포함한 최종 Mac Apple Silicon 패키지의 기본 실행과 브랜드 검사를 다시 수행했다.

- [기본 실행](docs/verification/0.5.0/packaged-smoke.json): 버전 0.5.0, 설정·펫 두 창, 항상 위 펫, 160% 말풍선 화면 내 배치, renderer 오류 없음.
- [브랜드·업데이트 IPC](docs/verification/0.5.0/brand-updates-0.5.0-packaged.json): 제목·글꼴·로고·삭제 UI·안전한 업데이트 동작과 OS 알림에 의존하지 않는 펫 업데이트 말풍선 검사 통과.
- [캐릭터 검사](docs/verification/0.5.0/characters-0.5.0-packaged.json): 로컬 패키지에서 세 캐릭터 선택·타임라인·canvas·동작 줄이기·재실행 복원 통과. 약 29.4초. 최종 태그 CI에서도 Windows와 Mac 패키지의 같은 검사가 통과했다.

`release/0.5.0/`에 다음 파일을 생성했다.

- `Meonjakju-0.5.0-mac-arm64.zip`
- `Meonjakju-0.5.0-mac-x64.zip`
- `Meonjakju-0.5.0-win-x64.exe`
- `Meonjakju-0.5.0-win-x64.zip`

[최종 패키지 무결성 검사](docs/verification/0.5.0/package-integrity.json)에서 세 플랫폼 app.asar 버전이 모두 0.5.0이고 각각 **31개 코드·자산·고지 파일**이 최종 소스와 일치했다. 저장 경합·알림 보완을 포함한 재빌드 ZIP/EXE의 크기와 SHA-256도 갱신했다. 이 로컬 체크섬은 이후 CI가 다시 만든 파일의 체크섬을 대신하지 않는다.

Apple Developer ID 서명·공증과 Windows 인증서 서명은 미완료다. Windows 네이티브 실행은 CI에서 확인했으며, 실제 버전 간 업그레이드와 Intel Mac 실기기 실행은 미확인이다.

## 공개 릴리스와 업데이트 피드

[공개 서버 검증 결과](docs/verification/0.5.0/release-0.5.0.json)는 GitHub의 실제 응답을 사용했다. 정식 릴리스의 파일은 Mac ZIP 두 개, Windows 설치 EXE·ZIP, blockmap 세 개, `latest.yml`·`latest-mac.yml`의 9개다.

- 공개 Windows EXE 전체를 내려받아 `latest.yml`의 SHA-512 두 필드 및 GitHub 자산의 SHA-256과 일치하는지 확인했다. 설치 파일을 실행한 검사는 아니다.
- 실제 `UpdateController`를 구버전 문자열 `0.4.9`로 실행해 arm64·x64 Mac 모두 `0.5.0`을 새 버전으로 인식하고 정확한 CPU용 ZIP 주소를 여는지 확인했다. 브라우저 실행은 기록용 함수로 대체했고 Mac ZIP을 내려받아 설치하지 않았다.
- 현재 버전 `0.5.0`에서는 `current` 상태를 확인했다.

처음 게시할 때 재귀 파일 패턴에 들어간 내부 `Meonjakju.exe`·`elevate.exe` 두 개는 릴리스에서 제거했다. 정식 설치 파일·업데이트 피드는 변경하지 않았다. 이후 배포는 정확한 버전별 9개 파일을 각각 하나씩 확인하고 비어 있거나 누락·중복이면 게시 전에 중단하도록 보완했다. [배포 스크립트 검사](docs/verification/0.5.0/release-publisher-0.5.0.json)의 정상 게시·draft 재시도·누락·중복·빈 파일·이미 공개된 릴리스·잘못된 태그 7가지 검사는 실제 워크플로 스크립트와 모의 `gh`로 실행했다.

## 실사용 확인 범위

저장 경합·알림 보완을 포함한 최종 Mac 패키지를 일반 모드로 실행한 뒤 네이티브 화면의 `먼작주 0.5.0`, LIVE 연결 상태와 기존 API 키를 다시 입력하지 않고 시세를 수신하는 것을 확인했다. 계좌 번호·보유 수량·평가금액 등 금융값은 이 기록에 포함하지 않았다.

실제 키를 사용하는 상장폐지 종목 혼합 조회, 실제 두 번째 계좌의 절전 복귀, 100개 실제 관심종목의 설정 파일 저장 횟수 관찰은 이번 자동 검증에 포함하지 않았다. 해당 오류·복구 경로는 합성 API 응답과 회귀 테스트로 확인했다. 사용자 라이브 프로필과 인증 정보는 보존했다.
