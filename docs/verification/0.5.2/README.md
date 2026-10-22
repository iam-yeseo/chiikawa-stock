# 0.5.2 Mac 자체 서명 검증

검증일: 2026-10-22. Apple 개발자 계정·Developer ID·공증을 사용하지 않는 자체 서명 배포다.

| 범위 | 상태 |
| --- | --- |
| 단위·회귀 검사 | 140개 통과 |
| Apple Silicon·Intel ZIP | 압축 해제 후 strict/deep 서명 검사 통과, 리소스 봉인·앱 ID·버전·CPU·권한 확인 |
| Gatekeeper 사전 검사 | 두 ZIP 모두 미공증 자체 서명으로 거절됨(예상 결과). 서명 손상 오류 없음 |
| Apple Silicon 패키지 실행 | 임시 데모 프로필에서 설정·펫·표정·말풍선 검사 통과 |
| 산책 모드 | 세 캐릭터 대사·이동·금융 이벤트 차단·설정 재실행 복원 통과 |
| GitHub CI·공개 다운로드·첫 실행 승인 | 배포 후보 생성 후 검증 예정 |
| Intel Mac 실기기 실행 | 미확인 |

[ZIP 서명](mac-signatures-local.json), [패키지 실행](packaged-smoke-local.json), [산책 모드](companion-local.json).

macOS의 전체 Gatekeeper 설정을 바꾸거나 다운로드 격리 속성을 제거하지 않는다. 자체 서명 무결성 통과와 Apple 공증/Gatekeeper 자동 승인 여부는 별개이며, 이 버전은 최초 실행 승인이 필요하다. 검증 전에는 prerelease로 공개하고 실제 다운로드·실행 확인 후 안정 버전으로 승격한다.
