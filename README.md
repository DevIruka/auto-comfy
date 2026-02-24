# Auto-Comfy

ComfyUI 비디오 생성 자동화 시스템 (다중 인스턴스 지원)

## 주요 기능

- **Single Generation**: 개별 비디오 생성
- **Batch Processing**: 성인용 포즈 배치 생성 (이미지당 3-5개 영상)
- **Emotion Videos**: 감정 기반 대화/대기 영상 배치 생성 (이미지당 9개 영상)
- **Multi-ComfyUI Support**: 여러 ComfyUI 인스턴스를 동시에 활용

## 📋 프로젝트 구조

```
auto-comfy/
├── frontend/          # React + TypeScript + Vite 프론트엔드
├── backend/           # Node.js + Express + TypeScript 백엔드
├── pose-config.json   # 성인용 포즈 프롬프트 설정
├── emotion-config.json # 감정 기반 비디오 프롬프트 설정
└── README.md
```

## 🚀 빠른 시작

### 1. 백엔드 설정

```bash
cd backend
npm install

# .env 파일 생성
cp .env.example .env
# .env 파일을 편집하여 RunPod ComfyUI URL 입력

# 개발 서버 실행
npm run dev
```

### 2. 프론트엔드 설정

```bash
cd frontend
npm install

# .env 파일 생성 (선택사항)
cp .env.example .env

# 개발 서버 실행
npm run dev
```

## 🔧 환경 설정

### 백엔드 (.env)

**단일 ComfyUI 인스턴스:**

```env
COMFYUI_API_URL=https://your-runpod-url-8188.proxy.runpod.net
PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5174
DEFAULT_OUTPUT_FOLDER_PATH=./output
```

**다중 ComfyUI 인스턴스 (권장):**

```env
# 여러 인스턴스를 설정하면 병렬 처리 가능
COMFYUI_API_URL_1=https://pod1-8188.proxy.runpod.net
COMFYUI_NAME_1=ComfyUI Pod 1

COMFYUI_API_URL_2=https://pod2-8188.proxy.runpod.net
COMFYUI_NAME_2=ComfyUI Pod 2

COMFYUI_API_URL_3=https://pod3-8188.proxy.runpod.net
COMFYUI_NAME_3=ComfyUI Pod 3

PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5174
DEFAULT_OUTPUT_FOLDER_PATH=./output
```

### 프론트엔드 (.env)

```env
VITE_API_URL=http://localhost:3002
```

## 📡 API 사용법

### 기본 워크플로우 실행

```typescript
import { comfyClient } from "./api/comfy-client";

// 워크플로우 실행
const result = await comfyClient.executeWorkflow(yourWorkflow);

// 이미지 URL 추출
const imageUrls = comfyClient.extractImageUrls(result);
console.log(imageUrls);
```

### React 컴포넌트에서 사용

```typescript
import { comfyClient } from "./api/comfy-client";
import { useState } from "react";

function ImageGenerator() {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const generateImage = async (prompt: string) => {
    setLoading(true);
    try {
      const workflow = {
        // 여기에 ComfyUI 워크플로우 JSON
        // "Save (API Format)"으로 저장한 것을 사용
      };

      const result = await comfyClient.executeWorkflow(workflow);
      const urls = comfyClient.extractImageUrls(result);
      setImages(urls);
    } catch (error) {
      console.error("Failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={() => generateImage("beautiful landscape")}>
        Generate
      </button>
      {loading && <p>Loading...</p>}
      {images.map((url, i) => (
        <img key={i} src={url} alt={`Generated ${i}`} />
      ))}
    </div>
  );
}
```

## 📝 워크플로우 준비하기

1. RunPod에서 ComfyUI를 실행합니다
2. ComfyUI에서 원하는 워크플로우를 만듭니다
3. 메뉴에서 **"Save (API Format)"** 선택
4. JSON 파일을 저장합니다
5. 해당 JSON을 코드에서 사용합니다

## 🔌 API 엔드포인트

### ComfyUI 기본 API

- `POST /api/comfy/queue` - 워크플로우 큐에 추가
- `POST /api/comfy/execute` - 워크플로우 실행 및 완료 대기
- `GET /api/comfy/history/:promptId?` - 실행 히스토리 조회
- `GET /api/comfy/queue` - 큐 상태 조회

### 성인용 포즈 배치

- `POST /api/batch/scan` - 폴더 스캔
- `POST /api/batch/start` - 배치 시작
- `POST /api/batch/:jobId/pause` - 일시정지
- `GET /api/batch/:jobId/status` - 상태 조회

### 감정 비디오 배치 (NEW)

- `POST /api/emotion-batch/scan` - 감정 이미지 스캔
- `POST /api/emotion-batch/start` - 감정 배치 시작
- `POST /api/emotion-batch/:jobId/pause` - 일시정지
- `GET /api/emotion-batch/:jobId/status` - 상태 조회

### ComfyUI 인스턴스 관리 (NEW)

- `GET /api/comfy-instances` - 사용 가능한 ComfyUI 인스턴스 목록

## 🛠 기술 스택

### Frontend

- React 19
- TypeScript
- Vite
- CSS

### Backend

- Node.js
- Express
- TypeScript
- Axios
- WebSocket

## 🎬 배치 시스템

### 성인용 포즈 배치

폴더 내 이미지를 자동으로 처리하여 포즈별 영상 생성:

- 이미지당 3개 또는 5개 영상 (랜덤 시드 토글)
- 포즈별 프롬프트 자동 적용 (`pose-config.json`)
- 포즈별 폴더 자동 생성 (예: `Cowgirl/`, `Doggy/`)

### 감정 비디오 배치 (NEW)

감정 이미지를 기반으로 대화/대기 영상 자동 생성:

- 이미지당 9개 영상 (Idle 3개 + SpeakNatural 6개)
- 파일명에서 감정 자동 인식 (예: `sit_angry.png`, `stand_neutral.png`)
- nude 폴더 지원 (파일명에 Naked 태그 추가)
- 감정별 프롬프트 자동 적용 (`emotion-config.json`)

**출력 파일명 예시:**

```
Sit_Idle_Neutral_to_Neutral_Clothed_00001.mkv
Stand_SpeakNatural_Angry_to_Angry_Naked_00002.mkv
Sit_SpeakNatural_Sad_to_Neutral_Clothed_00003.mkv
```

### 다중 ComfyUI 인스턴스

여러 RunPod Pod를 동시에 활용하여 처리 속도 향상:

- 각 폴더 쌍마다 다른 ComfyUI 인스턴스 할당 가능
- 병렬 처리로 시간 단축
- UI에서 인스턴스별 작업 분배 설정

## 📚 추가 리소스

- [ComfyUI GitHub](https://github.com/comfyanonymous/ComfyUI)
- [ComfyUI API Documentation](https://github.com/comfyanonymous/ComfyUI/wiki/API)
- [RunPod Documentation](https://docs.runpod.io/)

## 📄 라이선스

MIT
