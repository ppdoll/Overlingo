# Overlingo

화면의 일부 영역(채팅창, 영화 자막)을 지정하면 그 안의 글자를 실시간으로 읽어 번역합니다.
화면 캡처와 글자 인식(OCR)은 사용자 PC 안에서 돌아가므로 서버 비용이 없습니다.

- **웹**: https://overlingo.vercel.app. 설치 없이 Chrome·Edge에서 쓰고, 번역은 항상 위 PiP 창에 나옵니다.
- **데스크톱(Windows)**: Tauri 앱. 번역을 원래 말풍선과 자막 바로 옆에 오버레이로 띄웁니다.
- **사용 방법(스크린샷 포함)**: https://overlingo.vercel.app/guide.html ([`guide.html`](guide.html))

## 쓰는 법

### 웹

1. 모드(채팅/자막)와 언어를 고르고 **화면 공유 시작**을 누릅니다. 전체 화면보다 해당 **창**을 공유하는 게 좋습니다. 그래야 창을 옮겨도 영역이 유지됩니다.
2. 미리보기에서 번역할 부분을 드래그하고 **번역 시작**을 누릅니다.
3. 항상 위에 떠 있는 PiP 창에 번역이 나옵니다. 메인 탭에는 기록과 통계가 보입니다.

채팅 모드는 말풍선 단위로 번역합니다. 여러 줄로 감긴 메시지도 한 문장으로 번역됩니다. PiP 창에서 보기 방식을 고를 수 있습니다.
- **나란히**: 원본 말풍선 옆에 번역을 표시합니다.
- **목록**: 번역만 메신저처럼 표시합니다.

화면을 공유하지 않고 먼저 써 보려면 **샘플 화면으로 체험**을 누르세요.

### 데스크톱

1. 설정에서 Gemini 무료 키(또는 Claude 키)를 등록합니다. 데스크톱 앱의 WebView2에는 Chrome 내장 번역 모델이 없습니다.
2. **화면 영역 지정**을 누르면 모든 모니터가 잠시 멈춘 화면으로 바뀝니다. 번역할 부분을 드래그합니다(취소는 Esc).
3. **번역 시작**을 누르면 받은 메시지는 말풍선 오른쪽, 보낸 메시지는 왼쪽, 자막은 아래에 번역이 뜹니다.

오버레이는 클릭이 통과하고 화면 캡처에서 빠지므로(`WDA_EXCLUDEFROMCAPTURE`) 앱이 자기 번역을 다시 읽지 않습니다. 채팅을 스크롤하는 동안에는 번역이 흐려졌다가, 다시 읽은 위치로 옮겨 갑니다. 메신저 없이 써 보려면 **샘플 채팅 창으로 체험**을 누르세요.

## 번역 엔진

| 엔진 | 비용 | 메모 |
|---|---|---|
| Chrome 내장 번역 (웹 기본) | 무료 | 데스크톱 Chrome 138 이상, 웹 전용. 언어쌍마다 처음 한 번 모델을 받고, 그다음엔 오프라인으로 동작 |
| Gemini Flash-Lite (데스크톱 기본) | 무료 키 | Google AI Studio에서 카드 없이 발급. 사용할 수 있는 최신 Flash-Lite 모델을 자동으로 고름. 무료 등급은 보낸 글이 Google 제품 개선에 쓰임 |
| Claude Haiku 5.5 | 사용자 키로 과금 | 채팅의 슬랭과 맥락에 강함 |
| 번역 안 함 | 무료 | 인식한 글자만 표시 |

API 키는 사용자가 직접 등록합니다(BYOK). 키는 브라우저(데스크톱은 앱의 WebView)에만 저장됩니다. 기본은 sessionStorage이고, "이 기기에 저장"을 고르면 localStorage에 둡니다. 키는 해당 회사의 API(Google, Anthropic)로만 전송되고 Overlingo 서버로는 가지 않습니다. 배포 빌드에는 외부 스크립트를 막는 CSP가 들어갑니다(`vite.config.ts`).

## 개발

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 핵심 로직 단위 테스트
npm run build      # 타입 검사 후 dist/ 생성 (CSP 포함)
npm run preview    # 배포 빌드 확인
```

Vercel에서는 Vite 프리셋으로 그대로 배포됩니다. 빌드 명령은 `npm run build`, 출력 폴더는 `dist`입니다. `guide.html`과 `public/guide/` 스크린샷도 함께 배포됩니다.

### 데스크톱 앱 (Tauri 2)

[Rust](https://rustup.rs)(MSVC 빌드 도구 포함)와 WebView2(Windows 11에는 기본 포함)가 필요합니다.

```bash
npm run tauri dev     # 개발 실행 (Vite 개발 서버 포함)
npm run tauri build   # src-tauri/target/release/bundle/nsis/ 에 설치 파일 생성
```

설치 파일은 코드 서명 전이라 처음 실행할 때 SmartScreen 경고가 뜹니다.

## 구조

```
src/
  core/        플랫폼과 무관한 순수 로직
    changeDetect.ts  영역 변화 감지와 안정화 게이트
    bubbles.ts       채팅 말풍선 감지, OCR 줄을 말풍선 단위로 묶기
    textDiff.ts      채팅 새 메시지 추출, 자막 변경 판단
    ocrText.ts       OCR 결과 정리 (일본어 공백 제거, | → I 보정, 잡음 제거)
    preprocess.ts    OCR 전처리 (흑백, 대비, 밝은 글자 반전)
    placement.ts     번역 상자 자동 배치 (위/아래/좌/우 비교)
    wrap.ts          줄바꿈 계산 (샘플 화면, 오버레이 라벨 크기)
  capture/     프레임 처리 워커. 웹은 getDisplayMedia, 데스크톱은 네이티브 영역 캡처
  ocr/         Tesseract.js 래퍼
  translate/   Chrome 내장 번역, Gemini, Claude(지연 로드), 번역 안 함
  pipeline/    OCR → 변경 추적 → 캐시 → 번역 세션
  app/         캡처, OCR, 세션, PiP/오버레이를 묶는 컨트롤러
  ui/          React 화면 (시작, 영역 지정, 실시간 번역, PiP, 설정)
  platform/    데스크톱(Tauri) 명령 호출
  overlay/     데스크톱 오버레이 창: 말풍선 옆 라벨 배치와 그리기
  selector/    데스크톱 영역 지정 창 (모니터마다 하나)
  demo/        데스크톱 샘플 채팅 창
  guide/       사용 방법 페이지 스타일
src-tauri/     Rust: 화면 캡처(xcap), 창 관리(오버레이, 영역 지정, 샘플 창)
```

## 알려진 한계

- 웹 버전은 Chrome과 Edge 전용입니다(MediaStreamTrackProcessor, Document PiP, Translator API).
- 웹 버전은 번역을 원문 옆에 겹쳐 그릴 수 없어서 PiP 창에 표시합니다. 원문 옆 오버레이는 데스크톱 앱에서 됩니다.
- 데스크톱 앱은 현재 Windows만 빌드합니다. Chrome 내장 번역을 쓸 수 없어서 Gemini나 Claude 키가 필요합니다.
- 넷플릭스 같은 DRM 영상은 캡처하면 검은 화면이 됩니다.
- 무료 OCR(Tesseract)이라 장식이 많은 글꼴이나 작은 글자는 가끔 틀리게 읽습니다.
