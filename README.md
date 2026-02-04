# Auto-Comfy

RunPod에서 실행되는 ComfyUI 워크플로우 자동화 시스템

## 📋 프로젝트 구조

```
auto-comfy/
├── frontend/          # React + TypeScript + Vite 프론트엔드
├── backend/           # Node.js + Express + TypeScript 백엔드
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

```env
COMFYUI_API_URL=https://your-runpod-url-8188.proxy.runpod.net
PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5174
```

### 프론트엔드 (.env)

```env
VITE_API_URL=http://localhost:3002
```

## 📡 API 사용법

### 기본 워크플로우 실행

```typescript
import { comfyClient } from './api/comfy-client';

// 워크플로우 실행
const result = await comfyClient.executeWorkflow(yourWorkflow);

// 이미지 URL 추출
const imageUrls = comfyClient.extractImageUrls(result);
console.log(imageUrls);
```

### React 컴포넌트에서 사용

```typescript
import { comfyClient } from './api/comfy-client';
import { useState } from 'react';

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
      console.error('Failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={() => generateImage('beautiful landscape')}>
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

- `POST /api/comfy/queue` - 워크플로우 큐에 추가 (비동기)
- `POST /api/comfy/execute` - 워크플로우 실행 및 완료 대기 (동기)
- `GET /api/comfy/history/:promptId?` - 실행 히스토리 조회
- `GET /api/comfy/queue` - 큐 상태 조회
- `POST /api/comfy/cancel` - 실행 취소
- `GET /api/comfy/system-stats` - 시스템 통계
- `GET /api/comfy/image` - 생성된 이미지 다운로드

자세한 내용은 `backend/README.md`를 참조하세요.

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

## 📚 추가 리소스

- [ComfyUI GitHub](https://github.com/comfyanonymous/ComfyUI)
- [ComfyUI API Documentation](https://github.com/comfyanonymous/ComfyUI/wiki/API)
- [RunPod Documentation](https://docs.runpod.io/)

## 📄 라이선스

MIT
# auto-comfy
