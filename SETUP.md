# 🚀 Auto-Comfy 설정 가이드

## 필수 준비사항

1. **RunPod에서 ComfyUI 실행 중**
2. **Node.js 18+ 설치**
3. **npm 또는 yarn 설치**

## 📋 단계별 설정

### 1️⃣ 백엔드 설정 (필수)

```bash
# 백엔드 디렉토리로 이동
cd backend

# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env
```

**`.env` 파일 편집:**

```env
# RunPod의 ComfyUI URL을 입력하세요
COMFYUI_API_URL=https://xxxxx-8188.proxy.runpod.net

PORT=3002
NODE_ENV=development
FRONTEND_URL=http://localhost:5174
```

> 💡 **RunPod URL 찾는 방법:**
> 1. RunPod 대시보드에서 Pod 선택
> 2. "Connect" 버튼 클릭
> 3. HTTP Service 섹션에서 포트 8188의 URL 복사
> 4. 예: `https://xxxxxxxxxxxxx-8188.proxy.runpod.net`

**개발 서버 실행:**

```bash
npm run dev
```

서버가 `http://localhost:3002`에서 실행됩니다.

**연결 테스트:**

```bash
# 새 터미널에서
curl http://localhost:3002/health
```

성공 시: `{"status":"ok","timestamp":"..."}`

---

### 2️⃣ 프론트엔드 설정

```bash
# 프론트엔드 디렉토리로 이동
cd frontend

# 의존성 설치
npm install

# 환경변수 설정 (선택사항 - 기본값 사용 가능)
cp .env.example .env
```

**`.env` 파일 편집 (선택사항):**

```env
VITE_API_URL=http://localhost:3002
```

**개발 서버 실행:**

```bash
npm run dev
```

브라우저에서 `http://localhost:5174` 열기

---

## 🧪 테스트하기

### 1. 백엔드 연결 확인

프론트엔드 UI에서:
1. "💚 연결 테스트" 버튼 클릭
2. "✅ 백엔드 연결 정상" 메시지 확인

### 2. ComfyUI 워크플로우 준비

1. **RunPod ComfyUI 열기**
2. **워크플로우 만들기** (또는 기존 것 사용)
3. **메뉴 → "Save (API Format)" 클릭**
4. **JSON 파일 저장**

### 3. 워크플로우 사용하기

#### 방법 A: 데모 UI 사용 (간단)

프론트엔드 UI에서:
1. Prompt 입력
2. "🚀 이미지 생성" 버튼 클릭
3. 결과 이미지 확인

> ⚠️ **주의:** 데모 UI는 기본 워크플로우를 사용합니다. 
> 실제 RunPod ComfyUI에 해당 모델이 있어야 합니다.

#### 방법 B: 커스텀 워크플로우 사용 (권장)

**`frontend/src/components/ComfyDemo.tsx` 수정:**

```typescript
// createWorkflow 함수를 당신의 워크플로우 JSON으로 교체
const createWorkflow = (positivePrompt: string, negativePrompt: string): ComfyWorkflow => {
  // ComfyUI에서 export한 JSON을 여기에 붙여넣기
  return {
    // ... your workflow JSON
  };
};
```

---

## 🔧 문제 해결

### 백엔드 연결 실패

**증상:** "❌ 백엔드 연결 실패"

**해결:**
```bash
# 백엔드가 실행 중인지 확인
cd backend
npm run dev

# 다른 포트를 사용 중이라면
# .env에서 PORT 변경 후 재시작
```

### ComfyUI API 연결 실패

**증상:** "Failed to queue prompt" 또는 네트워크 에러

**확인 사항:**
1. RunPod Pod가 실행 중인가?
2. `.env`의 `COMFYUI_API_URL`이 정확한가?
3. RunPod URL에 접속 가능한가?

**테스트:**
```bash
# ComfyUI API 직접 테스트
curl https://your-runpod-url-8188.proxy.runpod.net/system_stats
```

### CORS 에러

**증상:** 브라우저 콘솔에 CORS 관련 에러

**해결:**
- 백엔드 `.env`에서 `FRONTEND_URL` 확인
- 백엔드 재시작

### 워크플로우 실행 실패

**증상:** "node_errors" 또는 실행 타임아웃

**확인 사항:**
1. ComfyUI에 필요한 모델이 설치되어 있는가?
2. 워크플로우 JSON이 API 형식으로 export되었는가?
3. 노드 ID와 입력 파라미터가 정확한가?

**디버깅:**
```typescript
// 브라우저 콘솔에서
const result = await comfyClient.queueWorkflow(yourWorkflow);
console.log('Result:', result);
```

---

## 📝 다음 단계

### ComfyUI 워크플로우 통합

1. ComfyUI에서 워크플로우를 "Save (API Format)"으로 저장
2. JSON 파일을 프로젝트에 추가:

```typescript
// frontend/src/workflows/my-workflow.json
export const myWorkflow = {
  // ... exported JSON
};
```

3. 컴포넌트에서 사용:

```typescript
import { myWorkflow } from '../workflows/my-workflow';
import { comfyClient } from '../api/comfy-client';

// 프롬프트 수정
const workflow = {
  ...myWorkflow,
  "6": {
    ...myWorkflow["6"],
    inputs: {
      ...myWorkflow["6"].inputs,
      text: "your custom prompt"
    }
  }
};

// 실행
const result = await comfyClient.executeWorkflow(workflow);
```

### 프로덕션 배포

**백엔드:**
```bash
cd backend
npm run build
npm start
```

**프론트엔드:**
```bash
cd frontend
npm run build
# dist 폴더를 호스팅
```

환경변수를 프로덕션 값으로 변경하는 것을 잊지 마세요!

---

## 💡 팁

1. **워크플로우를 JSON 파일로 관리하세요**
   - `frontend/src/workflows/` 폴더 생성
   - 각 워크플로우를 별도 파일로 저장

2. **환경변수를 활용하세요**
   - 개발/프로덕션 환경별로 분리
   - `.env.development`, `.env.production`

3. **에러 처리를 추가하세요**
   - try-catch로 에러 처리
   - 사용자에게 명확한 피드백

4. **로딩 상태를 표시하세요**
   - 이미지 생성은 시간이 걸림
   - 진행 상태를 보여주면 UX 향상

---

## 📚 추가 리소스

- [ComfyUI API 문서](https://github.com/comfyanonymous/ComfyUI/wiki/API)
- [RunPod 문서](https://docs.runpod.io/)
- [백엔드 API 문서](./backend/README.md)
- [프론트엔드 예시](./frontend/src/examples/workflow-example.ts)

---

질문이나 문제가 있으면 이슈를 생성해주세요! 🙌
