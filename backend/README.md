# Auto-Comfy Backend

ComfyUI 워크플로우 자동화를 위한 백엔드 API 서버

## 🚀 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
# ComfyUI Server Configuration
COMFYUI_API_URL=https://your-runpod-url-8188.proxy.runpod.net

# Server Configuration
PORT=3002
NODE_ENV=development

# CORS Configuration (Frontend URL)
FRONTEND_URL=http://localhost:5174
```

### 3. 개발 서버 실행

```bash
npm run dev
```

### 4. 프로덕션 빌드

```bash
npm run build
npm start
```

## 📡 API 엔드포인트

### 워크플로우 실행

#### POST `/api/comfy/queue`
워크플로우를 큐에 추가 (비동기)

**Request Body:**
```json
{
  "workflow": {
    // ComfyUI workflow JSON (API format)
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "prompt_id": "xxxx-xxxx-xxxx",
    "number": 1
  }
}
```

#### POST `/api/comfy/execute`
워크플로우를 실행하고 완료까지 대기 (동기)

**Request Body:**
```json
{
  "workflow": {
    // ComfyUI workflow JSON (API format)
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "prompt_id": "xxxx-xxxx-xxxx",
    "outputs": {
      "9": {
        "images": [
          {
            "filename": "ComfyUI_00001_.png",
            "subfolder": "",
            "type": "output"
          }
        ]
      }
    }
  }
}
```

### 히스토리 & 큐 관리

#### GET `/api/comfy/history/:promptId?`
실행 히스토리 조회

#### GET `/api/comfy/queue`
현재 큐 상태 조회

#### POST `/api/comfy/cancel`
실행 중인 프롬프트 취소

**Request Body:**
```json
{
  "promptId": "xxxx-xxxx-xxxx"
}
```

### 시스템 정보

#### GET `/api/comfy/system-stats`
ComfyUI 시스템 통계 조회

#### GET `/api/comfy/object-info`
사용 가능한 노드 및 모델 정보 조회

#### GET `/api/comfy/info`
백엔드 API 정보 조회

### 이미지

#### GET `/api/comfy/image?filename=xxx&subfolder=&type=output`
생성된 이미지 다운로드

## 🔧 사용 예시

### JavaScript/TypeScript 클라이언트

```typescript
// 워크플로우 실행
const response = await fetch('http://localhost:3002/api/comfy/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    workflow: yourWorkflowJSON
  })
});

const { data } = await response.json();
console.log('Prompt ID:', data.prompt_id);

// 이미지 가져오기
const imageUrl = `http://localhost:3002/api/comfy/image?filename=${data.outputs['9'].images[0].filename}`;
```

## 📝 ComfyUI 워크플로우 준비하기

1. ComfyUI에서 워크플로우를 만듭니다
2. 메뉴에서 **"Save (API Format)"** 클릭
3. JSON 파일을 저장합니다
4. 해당 JSON을 API 요청 body에 포함시킵니다

## 🛠 기술 스택

- **Node.js** + **TypeScript**
- **Express** - REST API 프레임워크
- **Axios** - HTTP 클라이언트
- **WebSocket** - 실시간 진행상황 모니터링
- **dotenv** - 환경변수 관리

## 📂 프로젝트 구조

```
backend/
├── src/
│   ├── server.ts              # Express 서버 진입점
│   ├── routes/
│   │   └── comfy.routes.ts    # ComfyUI API 라우트
│   ├── services/
│   │   └── comfy.service.ts   # ComfyUI API 클라이언트
│   └── middleware/
│       └── errorHandler.ts    # 에러 핸들링
├── .env                        # 환경변수 (git에 포함 안 됨)
├── .env.example               # 환경변수 예시
├── package.json
└── tsconfig.json
```

## 🔐 보안

- `.env` 파일은 절대 커밋하지 마세요
- RunPod API 키나 민감한 정보는 환경변수로 관리하세요
- 프로덕션 환경에서는 HTTPS를 사용하세요

## 📄 라이선스

MIT
