# 0.5.2 Mac 자체 서명·공개 다운로드 검증

검증일: 2026-10-22. Apple 개발자 계정·Developer ID·공증을 사용하지 않는 자체 서명 배포다. 릴리스 바이너리는 태그 `v0.5.2`, 커밋 `b6b7004f39da91e3e7fcaed8ae0ff2cb8a2529d7`에서 생성했다.

| 범위 | 결과 |
| --- | --- |
| 단위·회귀 검사 | 140개 통과. Mac·Windows CI 전체 성공 |
| Apple Silicon·Intel ZIP | 압축 해제 후 strict/deep 서명, 리소스 봉인, 앱 ID, 버전, CPU, 권한 검사 통과 |
| Gatekeeper 사전 검사 | 미공증 자체 서명으로 거절됨(예상 결과). 서명 손상 오류 없음 |
| 공개 다운로드 | 공개된 10개 파일 전부 GitHub SHA-256 일치. Mac ZIP·Windows EXE의 업데이트 피드 SHA-512 일치 |
| Chrome → macOS 첫 실행 | arm64 ZIP 실제 다운로드·기본 압축 해제·응용 프로그램 설치. 사용자가 보안 설정에서 허용한 뒤 실행 성공 |
| 실행된 파일 확인 | 네이티브 창 제목·화면에서 0.5.2 확인. 실행 중 앱, 설치 앱, 브라우저 다운로드 앱의 실행 파일·app.asar 해시가 모두 같고 strict 서명 검사 통과 |
| 다운로드한 arm64 앱 | 격리 데모에서 설정·펫 창 표시, 버전, 하치와레 산책 대사, 렌더러 오류 없음 확인 |
| 다운로드한 Intel 앱 | Apple Silicon의 Rosetta에서 x64 프로세스·설정·펫 창 표시·산책 모드 확인 |
| Windows | 네이티브 CI에서 소스·패키지의 기본 UI·캐릭터·산책·업데이트 IPC 검사 통과 |

다운로드 ZIP과 압축 해제 앱의 Chrome 격리 속성을 확인했다. 이를 지우지 않았고, 실행 허용 후에도 앱의 격리 속성은 남아 있다. macOS 전체 Gatekeeper는 검사 전후 모두 `assessments enabled`였다. 보안 설정의 허용과 인증은 사용자가 직접 수행했고, 사용자의 “설정 - 보안 가서 허용하니까 열렸음” 보고 후 실행 중인 파일과 화면을 별도로 검증했다.

첫 실행 화면은 기존 사용자 프로필의 산책 모드였다. 계좌·API 화면을 열거나 설정을 저장하지 않았다. 추가 기능 검사는 별도 임시 데모 프로필을 사용했다. 공개 증거에는 계좌 정보나 API 키를 포함하지 않았다.

검증 환경은 Apple Silicon, macOS 27.0.1(26A434)이다. 기존 버전이 설치됐던 Mac이므로 깨끗한 새 계정의 첫 실행과 같다고 주장하지 않는다. Intel 실기기, 다른 macOS 버전, 회사 관리 Mac의 정책, Windows 이전 설치판에서의 전체 업데이트 설치 완료는 미확인이다. Apple 공증을 받은 배포가 아니며 받는 사람도 최초 실행을 허용해야 할 수 있다.

- [Chrome 다운로드·사용자 승인·실행 파일 대조](browser-first-launch.json) · [실제 실행 화면](native-first-launch.png)
- [공개 파일 10개 SHA-256](published-integrity.json) · [업데이트 피드 SHA-512](feed-integrity.json)
- [배포 CI](ci-final.json) · [CI ZIP 서명](mac-signatures-ci.json) · [로컬 ZIP 서명](mac-signatures-local.json)
- [다운로드 arm64 실행](downloaded-arm64.json) · [다운로드 x64/Rosetta 실행](downloaded-x64.json)
- [Mac 패키지 산책 모드](companion-ci-macos-packaged.json) · [Windows 패키지 산책 모드](companion-ci-windows-packaged.json)
- [Mac 패키지 브랜드·업데이트](brand-updates-ci-macos-packaged.json) · [Windows 패키지 브랜드·업데이트](brand-updates-ci-windows-packaged.json)
- [배포·안정 버전 감지](release-stable.json)

검증 전에는 prerelease로 공개해 안정 버전 업데이트에 노출하지 않고, 실제 다운로드·실행 확인 후 정식 최신 버전으로 승격한다. [Mac 실행 안내](../../mac-install.txt)를 릴리스에 함께 제공한다.
