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

**캐릭터 작업 폴더 (Google Drive for desktop 등):**

실사용 시 Drive가 마운트된 **절대 경로**를 지정하는 것을 권장합니다. 미설정이면 `backend/workspace`를 루트로 씁니다.

```env
PROJECT_DRIVE_ROOT=G:\My Drive\내프로젝트\캐릭터작업
```

앱 상단에서 캐릭터·스팟을 고르면 이 루트 아래 `캐릭터/스팟/성인용 이미지` 등 하위 경로가 자동으로 잡힙니다.

### 프론트엔드 (.env)

```env
VITE_API_URL=http://localhost:3002
```

facemask -> 용량이 커서 git에 업데이트 안 됨. 별도로 다운 받아서 설치해줄 필요 있음.

---

## 기능 상세 설명

### 1. 프리셋 기능

프리셋은 **캐릭터와 장소(스팟)별로 쓰는 설정을 한 번에 저장해 두었다가 불러오는 기능**입니다.

예를 들어 "아리나 - 학교 복도" 같은 프리셋을 만들어 두면, 그 안에는 다음이 들어갑니다.

- **캐릭터 외모**: 머리색, 눈 색, 체형 등
- **의상**: 입고 있는 옷
- **배경**: 학교 복도, 침실 등 장소 묘사
- **LoRA**: 캐릭터를 표현하는 데 쓰는 모델 설정
- **스타일/화풍**: 그림체, 분위기 관련 설정

이렇게 저장해 두면, 나중에 같은 캐릭터·장소로 작업할 때 프리셋을 선택해서 불러오기만 하면 됩니다.  
매번 설정을 다시 입력할 필요가 없어서 작업이 훨씬 편해집니다.

---

### 2. 성인용 이미지·썸네일 이미지 자동화

**Image Batch** 기능은 **포즈 설정(pose-config)에 정의된 여러 포즈를 골라서, 그에 맞는 이미지를 한꺼번에 자동으로 만들어 주는 기능**입니다.

- 포즈 종류(예: Cowgirl, Missionary, Oral 등)를 선택하면, 각 포즈마다 여러 장의 이미지가 자동 생성됩니다.
- 한 포즈당 3~5장 정도, 서로 다른 시드로 생성해 줘서 결과가 다양하게 나옵니다.
- 프리셋으로 불러온 캐릭터·배경 설정을 그대로 쓰고, 의상은 **Nude** 또는 **프리셋 의상 그대로** 중에서 선택할 수 있습니다.
- 썸네일이나 홍보용 이미지처럼, 같은 캐릭터·배경으로 여러 포즈를 한 번에 뽑아야 할 때 유용합니다.

---

### 3. 마스킹 인페인팅 기능

이 기능은 **원본 이미지의 얼굴(피부·눈)만 선택적으로 바꾸고, 나머지는 그대로 두는 방식**입니다.

**얼굴 마스킹 도구**는:

- 이미지에서 얼굴 영역(피부, 눈)을 자동으로 찾아서 **투명하게** 만듭니다.
- 머리카락은 그대로 유지됩니다.
- 여러 장의 이미지를 한 번에 처리할 수 있습니다.
- 애니메이션·일러스트 스타일 이미지에 맞춰 설계되어 있습니다.

**Emotion Pipeline**에서는 이 마스킹 결과를 활용합니다.

- 마스킹된 이미지의 **얼굴 부분만** 인페인팅으로 다시 그려서, **Happy, Aroused, Sad, Angry** 같은 감정별 표정을 만듭니다.
- 같은 캐릭터·포즈로 여러 감정 버전을 만들 때 사용합니다.
- 마스킹 → 인페인팅 → 업스케일까지 한 흐름으로 자동 처리됩니다.

번외 -> 뉴트럴은 따로 inpaint 없이 업스케일만 진행합니다. 

---

### 4. 썸네일 및 배너 이미지 자동화

**썸네일 및 배너 이미지** 기능은 **banner-config.json에 정의된 포즈와 제스처를 조합해서, 썸네일·배너용 이미지를 자동으로 만들어 주는 기능**입니다.

- **포즈(Pose)**: 서 있는 자세, 누워 있는 자세 등 기본 자세
- **제스처(Gesture)**: 유혹적인 손짓, 특정 포즈 등 추가 동작

이 두 가지를 조합해서:

- 포즈만 있는 이미지
- 포즈 + 제스처가 함께 있는 이미지

를 자동으로 생성합니다. 예를 들어 "Standing Pose" + "Seductive Gesture" 같은 조합이 됩니다.

- "Lying Down" 같은 눕는 포즈를 쓰면, 가로로 긴 배너 비율(1536×1024)로 자동 생성됩니다.
- 프리셋으로 불러온 캐릭터·배경 설정을 그대로 사용할 수 있어서, 일관된 스타일의 썸네일·배너를 대량으로 만들 수 있습니다.

