# Windows 다중 모니터 검토 — 0.2.2

검토일: 2026-10-20. 앱의 Electron 의존성은 **44.9.0**이다. Windows 실행 환경이 없어 **Windows 실기기 검증은 수행하지 않았다**. 아래 결과는 공식 문서·소스 검토와 모의 객체를 사용하는 자동 테스트 결과다.

## 좌표와 창 이동 근거

- Electron의 [`screen.getCursorScreenPoint()`](https://www.electronjs.org/docs/latest/api/screen#screengetcursorscreenpoint)와 [Display의 `bounds`·`workArea`](https://www.electronjs.org/docs/latest/api/structures/display)는 DIP 좌표를 사용한다. 모니터의 `scaleFactor`를 다시 곱하지 않는다.
- [Electron 44.9.0 `blink_converter.cc`](https://raw.githubusercontent.com/electron/electron/v44.9.0/shell/common/gin_converters/blink_converter.cc)의 `MouseConverterToV8`는 Blink의 `PositionInScreen()`을 `globalX`·`globalY`로 전달한다. [Chromium의 Windows 입력 변환](https://raw.githubusercontent.com/chromium/chromium/main/ui/events/blink/web_input_event_builders_win.cc)은 전역 물리 좌표에 `ScreenToDIPPoint()`를 적용한 뒤 `SetPositionInScreen()`을 호출한다. 따라서 이 네이티브 이벤트 좌표에도 추가 배율 변환을 적용하지 않았다.
- [Electron 44.9.0의 `DEPS`](https://raw.githubusercontent.com/electron/electron/v44.9.0/DEPS)는 Chromium **152.0.7977.167**을 지정한다. 해당 태그의 입력 변환 파일을 Chromium Gitiles와 GitHub 미러에서 각각 한 번 조회했지만 도구가 소스를 가져오지 못했다. 따라서 `ScreenToDIPPoint()` 근거는 확인 당시 **upstream `main` 소스**이며, 포함된 정확한 태그의 구현까지 동일하다고 검증한 것은 아니다.
- [Electron 44.9.0 `native_window_views.cc`](https://raw.githubusercontent.com/electron/electron/v44.9.0/shell/browser/native_window_views.cc)의 `SetBounds()`는 크기 조절이 금지된 창도 최소·최대 크기 제약을 갱신한 뒤 창 경계를 설정한다. 따라서 `resizable: false`를 이유로 프로그램의 `setBounds()` 이동을 제거할 필요는 없었다.

구현은 하나의 투명 창을 대상 모니터의 작업 영역으로 이동한다. 실제 콘텐츠 영역의 원점을 사용해 전역 DIP를 로컬 좌표로 변환하며, 대상 작업 영역이 달라질 때만 창 경계를 변경한다.

## 수정한 종료 처리

화면 정보 조회 실패 등으로 메인 프로세스의 드래그만 끝나고 렌더러에 최종 위치가 전달되지 않으면, 렌더러가 계속 드래그 중이라고 판단해 산책을 멈출 수 있었다.

- 위치 계산과 독립적인 `chii:pet-drag-ended` 메시지 `{sessionId, reason}`와 preload의 `onPetDragEnded()`를 추가했다. 메인 세션·타이머를 해제하고 마우스 클릭 통과를 복원한 다음 종료 메시지를 보낸다.
- 정상 종료는 최종 위치를 먼저 전달한다. 조회 오류, 화면 목록 소실, 창 숨김, 시간 초과 및 시작 거절도 해당 세션의 종료를 알린다. 렌더러 자체가 사라져 메시지를 받을 수 없다면 새 렌더러는 드래그 상태 없이 시작한다.
- 창 숨김·재로딩·렌더러 종료·창 닫힘·절전 때 대기 중인 마우스 누름 기록을 지운다. 빠르게 놓은 지점은 이후 마우스 이동으로 덮어쓰지 않는다.

## 검증 결과와 남은 범위

`node --test tests/pet-drag.test.js tests/pet-geometry.test.js` 결과: **29개 통과 — 드래그 18개, 좌표 11개**. `electron/main.js`와 `electron/preload.cjs`의 문법 검사도 통과했다.

테스트는 125%·150%·200% 배율을 섞은 배치, 오른쪽·위쪽 모니터, 음수 원점, 실제 콘텐츠 원점, 잡은 위치 유지, 마지막 네이티브 마우스 좌표 우선 적용, 모니터 제거, 지연된 이전 세션 종료, 시간 초과, 실패 후 재시작과 클릭 통과 복원을 포함한다.

이 결과는 Windows의 실제 DPI 전환, 포인터 캡처 및 투명 창 동작을 실행 검증한 결과가 아니다. Windows 배포물에서는 서로 다른 배율의 모니터 사이 왕복 드래그, 모니터 경계에서 놓기, 드래그 후 클릭 통과·산책 재개를 실기기에서 확인해야 한다.
