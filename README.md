# Overlingo

화면의 일부 영역(채팅창, 영화 자막)을 지정하면 그 안의 글자를 실시간으로 읽어 번역하는 웹앱입니다.
화면 캡처, 글자 인식(OCR), 번역이 모두 사용자 브라우저 안에서 돌아가므로 서버 비용이 없습니다.

## 쓰는 법

1. 모드(채팅/자막)와 언어를 고르고 **화면 공유 시작**을 누릅니다. 전체 화면보다 해당 **창**을 공유하는 게 좋습니다. 그래야 창을 옮겨도 영역이 유지됩니다.
2. 미리보기에서 번역할 부분을 드래그하고 **번역 시작**을 누릅니다.
3. 항상 위에 떠 있는 PiP 창에 번역이 나옵니다. 메인 탭에는 기록과 통계가 보입니다.

화면을 공유하지 않고 먼저 써 보려면 **샘플 화면으로 체험**을 누르세요.

## 번역 엔진

| 엔진 | 비용 | 메모 |
|---|---|---|
| Chrome 내장 번역 (기본) | 무료 | 데스크톱 Chrome 138 이상. 언어쌍마다 처음 한 번 모델을 받고, 그다음엔 오프라인으로 동작 |
| Claude Haiku 5.5 | 사용자 키로 과금 | 설정에서 개인 API 키 등록(BYOK). 채팅의 슬랭과 맥락에 강함 |
| 번역 안 함 | 무료 | 인식한 글자만 표시 |

Claude 키는 브라우저에만 저장됩니다. 기본은 sessionStorage이고, "이 기기에 저장"을 고르면 localStorage에 둡니다. 키는 Anthropic API로만 전송되고 Overlingo 서버로는 가지 않습니다. 배포 빌드에는 외부 스크립트를 막는 CSP가 들어갑니다(`vite.config.ts`).

## 개발

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 핵심 로직 단위 테스트
npm run build      # 타입 검사 후 dist/ 생성 (CSP 포함)
npm run preview    # 배포 빌드 확인
```

Vercel에서는 Vite 프리셋으로 그대로 배포됩니다. 빌드 명령은 `npm run build`, 출력 폴더는 `dist`입니다.

## 구조

```
src/
  core/        플랫폼과 무관한 순수 로직 (데스크톱 버전에서도 재사용)
    changeDetect.ts  영역 변화 감지와 안정화 게이트
    textDiff.ts      채팅 새 줄 추출, 자막 변경 판단
    ocrText.ts       OCR 결과 정리 (일본어 공백 제거, | → I 보정, 잡음 제거)
    preprocess.ts    OCR 전처리 (흑백, 대비, 밝은 글자 반전)
    placement.ts     번역 상자 자동 배치 (위/아래/좌/우 비교), 데스크톱 오버레이용
  capture/     getDisplayMedia + Web Worker 프레임 처리, 샘플 화면
  ocr/         Tesseract.js 래퍼
  translate/   Chrome 내장 번역, Claude(BYOK, 지연 로드), 번역 안 함
  pipeline/    OCR → 변경 추적 → 캐시 → 번역 세션
  app/         캡처, OCR, 세션, PiP를 묶는 컨트롤러
  ui/          React 화면 (시작, 영역 지정, 실시간 번역, PiP, 설정)
```

## 알려진 한계

- Chrome과 Edge 전용입니다(MediaStreamTrackProcessor, Document PiP, Translator API).
- 웹 버전은 번역을 원문 옆이나 위에 겹쳐 그릴 수 없고, 항상 위 PiP 창에 표시합니다. 자동 배치 오버레이는 데스크톱(Tauri) 버전에서 `core/placement.ts`를 써서 구현할 예정입니다.
- 넷플릭스 같은 DRM 영상은 캡처하면 검은 화면이 됩니다.
- 무료 OCR(Tesseract)이라 장식이 많은 글꼴이나 작은 글자는 가끔 틀리게 읽습니다.
