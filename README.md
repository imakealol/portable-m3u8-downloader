# M3U8 Downloader (사내 GUI)

Electron 기반 M3U8 스트림 다운로더입니다. 내부에 `ffmpeg.exe`를 포함해 배포하며, Windows에서 포터블 실행 파일(`.exe`)로 빌드합니다.

## 사전 요구 사항

- **Node.js** 18.x 이상(LTS 권장) 및 **npm**
- **Windows x64** (현재 `electron-builder` 설정 기준)
- 프로젝트 루트에 **Windows용 `ffmpeg.exe`**  
  - 빌드 시 `resources/ffmpeg/ffmpeg.exe`로 같이 패키징됩니다.

## 시작하기

```bash
npm install
```

## 개발 모드 실행

로컬에서 UI와 동작을 바로 확인할 때:

```bash
npm start
```

- 개발 시 FFmpeg 경로: 프로젝트 루트의 `ffmpeg.exe` (`electron/main.js`의 비패키징 분기)
- 코드 수정 후 앱을 다시 띄우면 됩니다(핫 리로드는 없음). 메인/프리로드 변경 시 앱을 완전히 종료 후 재실행하세요.

## 프로젝트 구조

| 경로 | 설명 |
|------|------|
| `electron/main.js` | 메인 프로세스: 창, IPC, FFmpeg `spawn`, 폴더 선택 대화상자 |
| `electron/preload.js` | 렌더러에 노출하는 `window.api` 브리지 |
| `electron/renderer/` | 화면: `index.html`, `styles.css`, `renderer.js` |
| `package.json` | 스크립트 및 `electron-builder` 설정(`build` 필드) |
| `ffmpeg.exe` | 배포 시 `extraResources`로 포함(루트에 두어야 함) |

UI·문구·단순 동작은 주로 `electron/renderer/`만 고쳐도 됩니다. FFmpeg 인자·경로·IPC는 `main.js` / `preload.js`를 수정합니다.

## 배포용 빌드 (포터블 .exe)

```bash
npm run dist
```

- 결과물: **`dist/M3U8 Downloader-<버전>-portable.exe`**
- 압축 해제 없이 단일 파일로 배포 가능(실행 시 임시 폴더에 풀림).

### 빌드가 실패할 때 (Windows)

- **코드 서명 / winCodeSign / 7-Zip 심볼릭 링크 오류**  
  - 이 저장소에서는 `package.json` → `build.win.signAndEditExecutable: false` 로 실행 파일 수정·서명 단계를 생략합니다.  
  - 여전히 실패하면 Windows **개발자 모드** 켜기 또는 관리자 권한 터미널 등 환경을 확인하세요.
- **FFmpeg 누락**  
  - 루트에 `ffmpeg.exe`가 있는지 확인하세요. 없으면 `extraResources` 단계에서 실패하거나, 배포본에 FFmpeg가 빠질 수 있습니다.

### 버전 올리기

배포 파일 이름에 버전이 들어가므로, 릴리스 전에 `package.json`의 `"version"`을 올리는 것을 권장합니다.

## 보조 스크립트

| 명령 | 설명 |
|------|------|
| `npm start` | 개발 실행 |
| `npm run pack` | `dist/win-unpacked`에 앱만 풀어서 확인(설치/포터블 패키징 전 단계) |
| `npm run dist` | Windows 포터블 `.exe` 생성 |

## 라이선스·보안

- `license` 필드는 `UNLICENSED`(사내용)로 두었습니다. 배포 정책에 맞게 조정하세요.
- 서명되지 않은 실행 파일은 Windows SmartScreen에서 경고가 뜰 수 있습니다.

## 기능 요약 (동료용)

1. M3U8 URL 입력  
2. **저장 폴더**만 선택  
3. **다운로드** 클릭 시 해당 시각 기준으로 `recording_YYYYMMDD_HHMMSS.mp4` 파일명 생성 후 `ffmpeg -i … -c copy` 로 저장  
