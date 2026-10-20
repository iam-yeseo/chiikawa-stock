# 먼작주 업데이트와 릴리스

0.5.0부터 `iam-yeseo/chiikawa-stock`의 공개 GitHub Releases를 사용한다. GitHub 토큰이나 Toss API 키를 앱에 넣지 않는다.

현재 0.5.0의 로컬 빌드와 패키지 검증은 완료했고 원격 CI·정식 릴리스 확인은 대기 중이다. 실제 배포 여부와 운영체제별 실행 결과는 [QA.md](../QA.md)를 기준으로 확인한다.

## 사용자 동작

- 앱 시작 15초 뒤 및 6시간마다 안정 버전을 확인한다. 중복 확인은 합치고 30초 쿨다운을 둔다.
- 새 버전은 소리 없는 OS 알림, 트레이 메뉴, 설정 화면의 업데이트 안내로 표시한다.
- Windows NSIS 설치판: 사용자가 다운로드 → 재시작 설치를 선택한다. 자동 다운로드와 종료 시 강제 설치는 사용하지 않는다. ZIP은 설치판으로 옮기는 용도로 제공하며 NSIS 설치판 사용을 권장한다.
- Mac: 사용자가 인증서 없음으로 수동 다운로드 방식을 선택했다. 최신 정식 버전의 CPU별 ZIP만 열며 다운로드 후 앱 교체가 필요하다. Intel과 Apple Silicon 파일을 혼동하지 않는다.
- 개발 실행과 `--demo-preview`에서는 업데이트 네트워크를 사용하지 않는다.
- 0.4.x에서 0.5.0으로 최초 이동은 직접 설치한다.

## 릴리스 구성

`package.json`의 version, lockfile 버전, build output, UI 브라우저 fallback 버전을 함께 변경한다. 동일한 배포 버전을 다시 덮어써 사용자에게 다른 코드를 제공하지 않는다. 후속 수정은 버전을 올린다.

```sh
npm ci
npm test
npm run build
npm run test:desktop
npm run test:roaming
npm run test:portfolio
npm run test:characters
node scripts/smoke-brand-updates.mjs
```

`vX.Y.Z` 태그를 push하면 `.github/workflows/build-desktop.yml`이 Windows와 macOS에서 검증하고 패키징한다. 두 작업이 성공한 뒤 ZIP/EXE/blockmap/`latest*.yml`을 릴리스에 함께 업로드하고 공개한다. 이미 공개된 같은 태그가 있으면 업로드 전에 중단하며, 미공개 draft만 재시도할 수 있다. 수동 workflow 실행은 검증용 아티팩트만 생성한다. 릴리스 파일은 코드 저장소에 커밋하지 않는다.

Windows 피드에는 `latest.yml`, 그 안의 정확한 EXE, SHA-512, blockmap이 필요하다. 공식 NSIS updater가 다운로드 무결성을 검사한다. 현재 Windows 인증서도 없어 Authenticode 검증은 구성하지 않았으며, OS 보안 기능을 끄거나 다운로드 체크섬 검증을 우회하지 않는다. 인증서를 도입할 때 `verifyUpdateCodeSignature`와 publisher 설정을 함께 갱신한다.

Mac 알림은 GitHub REST의 최신 정식 릴리스만 확인한다. `Meonjakju-X.Y.Z-mac-arm64.zip` 또는 `Meonjakju-X.Y.Z-mac-x64.zip`의 이름·저장소·태그·정확한 HTTPS 다운로드 주소를 검증한다. 외부 임의 URL이나 prerelease/downgrade는 허용하지 않는다.

## Mac 자동 설치를 도입할 때

[Electron 공식 안내](https://www.electronjs.org/docs/latest/api/auto-updater)와 [electron-builder 26 안내](https://www.electron.build/v26/docs/features/auto-update/)에 따라 일관된 Developer ID 서명과 공증을 구성해야 한다. 현재 수동 경로를 자동 설치라고 표시하지 않는다. 인증서가 준비되면 `UpdateController`의 darwin 경로를 MacUpdater로 전환하고 서명된 이전/새 버전 간 실제 업데이트를 검증한다.

브랜드를 바꿔도 `app.setName('Chiikawa Stocks')`, 기존 userData 위치와 `im.chii.stocks`를 유지한다. 이는 기존 Keychain 암호화 키와 사용자 설정의 호환을 위한 내부 식별자다.

번들·helper·실행 파일의 내부 이름은 `Meonjakju`이고, Mac `CFBundleDisplayName`과 화면 제목은 `먼작주`다. 사용자에게 보이는 브랜드와 실행 파일 이름을 구분한다.

## 검증 한계

가짜 HTTP/updater 이벤트 테스트는 버전·URL·동시 요청·오류·설치 재시도를 검증한다. 이것만으로 Windows에서 실제 이전 버전 → 새 버전 설치가 검증된 것은 아니다. 패키지·CI·실제 업데이트 검증 결과는 `QA.md`에 별도로 기록한다.
