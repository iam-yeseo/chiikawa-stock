# 0.5.1 검증 기록

- 140개 단위·회귀 테스트 통과. 기존 설정 마이그레이션, 모드 전환, API 요청 중단, 재연결 한도 초과 후 클라이언트 해제를 포함한다.
- 실제 Electron 기본 실행·산책·계좌·캐릭터·브랜드/업데이트 검사를 격리 프로필로 통과했다.
- [산책 모드 통합](companion-0.5.1.json): 실제 설정 토글, 세 캐릭터 이름·대사·모션, 저장된 roaming:false와 무관한 이동, 주식 이벤트 차단, 랜덤 재표시, 재실행·모드 복귀를 확인했다.
- [Mac 패키지 산책 모드](companion-0.5.1-packaged.json): 같은 전체 시나리오를 실제 app.asar 패키지에서 재검증, 렌더러 오류 없음. [설정 화면](companion-settings-0.5.1-packaged.png).
- [로컬 Mac 패키지](package-integrity-0.5.1.json): arm64·x64 app.asar의 버전과 32개 런타임 소스·번들·고지 파일 일치.

사용자 라이브 프로필·인증 정보는 검사에 사용하거나 변경하지 않았다. 모든 실행 검사는 임시 데모 프로필을 사용한다. 실제 이전 Windows 설치판에서 새 버전 설치 완료까지의 사용자 경로와 Intel Mac 실기기 실행은 별도 확인 범위다.

기본 실행·캐릭터·브랜드/업데이트 검사를 최종 Mac 패키지에서도 통과했다. `packaged-smoke.json`, `characters-0.5.1-packaged.json`, `brand-updates-0.5.1-packaged.json`에 결과를 보존한다.
