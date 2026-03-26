# Crawling → Auto-Comfy 플로우 보고서

캐릭터 컨셉 확정부터 **auto-comfy** 앱으로 이미지·영상을 만드는 작업 순서를 정리한 문서입니다.  

---

## 개요

1. **사전 단계(Phase A)**에서 크롤링·필터·시놉시스·plan·LoRA·폴더 구조를 준비합니다.  
2. **Auto-Comfy(Phase B)**에서 ComfyUI와 연동해 앵커 이미지 → 프리셋 → 성인용 이미지·배너·영상 → 마스킹·감정 인페인팅까지 진행합니다.  
3. RunPod에서 ComfyUI Pod를 띄우고, 앱 상단 **Pod Dashboard**에 API URL을 등록하면 여러 인스턴스를 대기열로 돌릴 수 있습니다. Pod **이미지/템플릿 제작** 자체는 앱 밖 작업이며, 향후 자동화 여지가 있는 부분으로 남깁니다.

---

## Phase A: 이 저장소에 없는 사전 작업

아래 항목은 **본 레포(`auto-comfy`)에 스크립트가 없거나**, 운영상 별도 환경에서 수행하는 작업입니다.

| 단계 | 설명 |
|------|------|
| 크롤링 | 예: `python crawl_risu 100` 형태로 캐릭터 후보를 수집(명령·스크립트는 이 레포 외부). |
| 필터링 | 크롤링 직후 자동 필터가 돌아가 남는 폴더만 다음 단계로 넘김(외부 파이프라인). |
| 시놉시스 | `generate_synopsis.py` 등으로 폴더별 시놉시스 생성(이 레포 미포함). |
| plan | 시놉시스 이후 plan 작성 → 캐릭터 외형·배경용 프롬프트 확정. |
| LoRA·화풍 | plan을 보고 LoRA/그림체를 고른 뒤, 예: **runpod에서 pod의 8888 포트 Jupyter**에서 `wget` 등으로 Pod의 `loras` 폴더에 배치. |
| RunPod Pod | 캐릭터 제작용 ComfyUI Pod 준비(템플릿·이미지 구성). **향후 auto-comfy에서 자동화할 여지가 있는 영역.** |
| 폴더 구조 | 캐릭터·스팟별 산출물 폴더를 미리 만든다(아래 예시 참고). |

### 폴더 구조 예시 (아리나, spot 2개)

스팟마다 동일한 하위 카테고리를 두는 방식이 일반적입니다.

```text
아리나/
├── spot 1 학교 복도/
│   ├── 감정별 이미지/
│   ├── 성인용 영상/
│   ├── 성인용 이미지/
│   └── 일반 영상/
├── spot 2 아리나의 집 거실/
│   ├── 감정별 이미지/
│   ├── 성인용 영상/
│   ├── 성인용 이미지/
│   └── 일반 영상/
└── 배너/
```

---

## Phase B: Auto-Comfy 앱 기능

프론트엔드 탭과 백엔드 서비스 대응 관계입니다.

| UI 탭 | 역할 |
|--------|------|
| 성인용 이미지 자동화 | `pose-config.json`에 정의된 포즈를 골라 이미지 배치 생성(Image Batch). |
| 썸네일 및 배너 이미지 | `banner-config.json`의 포즈·제스처 조합으로 배너/썸네일용 이미지 배치. |
| 앵커 이미지 제작 | 단일(또는 소량) 앵커 이미지 생성, 출력 경로 지정 저장. |
| 성인용 영상 자동화 | `성인용 이미지` 스타일 폴더(포즈별 하위 폴더)를 스캔해 영상 배치. |
| 마스킹 + 인페인팅 | facemask → (선택) 수동 마스크 → 감정별 인페인트·업스케일 파이프라인. |

**Pod Dashboard**(앱 상단): ComfyUI 인스턴스 URL 추가·삭제, 실행/대기 작업 확인, 정지·취소. 다중 Pod 병렬 시 `instanceQueueManager`로 작업이 분배됩니다.

### 1. 프리셋

- **저장 위치**: `backend/presets/*.json`  
- **API**: `/api/presets` (목록·저장·불러오기·삭제·갱신)  
- **주요 필드**(예: `비비안 spot 1 - 요마의 정원.json`):  
  `fixedPrefix`, `styleTrigger`, `character`, `outfit`, `backgroundPositive`, `fixedSuffix`, `fixedNegative`, `backgroundNegative`, `loraSlots`, `prefixPrompt`(영상용 접두·자연어 메모 겸용), 앵커 탭용 `compositionPose`, `anchorAspect`(portrait / landscape) 등.

이름 예: `비비안 spot 1 - 요마의 정원`.

`prefixPrompt` 자연어 예:

`A beautiful anime girl with pale pink-silver hair, amethyst purple eyes, pointed ears,`

대부분의 탭에서 **PresetPicker**로 동일 프리셋을 불러올 수 있습니다.

### 2. 앵커 이미지 제작

- plan의 캐릭터·배경 프롬프트 중 필요한 부분만 잘라 **긍정/부정**과 LoRA 슬롯에 넣고 생성합니다.  
- 결과가 마음에 들지 않으면 negative로 보정하거나 LoRA를 교체합니다.  
- 만족 시 프리셋으로 저장하고, 위와 같이 **자연어 `prefixPrompt`**를 함께 적어 두면 이후 영상 배치에서 재사용하기 좋습니다.

**Topless / naked 앵커(운영 메모)**

- clothed 앵커 후 topless·naked 버전을 별도로 뽑는 경우, 고정 프롬프트 예:  
  `topless, no bras, nipple visible, maebari, black maebari, small maebari,`  
  마에바리 색은 캐릭터에 맞게 조정.  
- LoRA 영향으로 실패하면 `bare breast` 등 단어를 조금씩 추가해 맞춥니다.

### 3. 성인용 이미지 자동화(Image Batch)

- 포즈 목록과 프롬프트는 루트의 [`pose-config.json`](pose-config.json)에서 로드됩니다.  
- **포즈당 동일 랜덤 시드로 돌리는 횟수는 코드 상수 `RUNS_PER_POSE = 3`** 입니다(포즈당 3회).  
- 일부 포즈(CumInMouth 계열, Handjob, Masturbation 등)는 UI에서 **손 보정(handFix)** 이 기본 켜지며, 같은 시드에 대해 보정 유/무 **두 종류**의 프롬프트로 생성할 수 있어 작업 수가 늘어날 수 있습니다.  
- **스팟 1에서는 Oral·Handjob만, 스팟 2에서는 전부** 같은 규칙은 코드에 없고, **포즈 체크박스로 매번 선택**하는 운영 관행으로 두면 됩니다.  
- 프리셋 불러오기 시 **의상**: `nude`(기본) 또는 프리셋 의상(`preset`) 선택 가능.

### 4. 썸네일 및 배너 이미지

- [`banner-config.json`](banner-config.json)의 `pose`·`gesture` 키로 조합을 만듭니다(포즈만 / 포즈+제스처).  
- **Lying Down** 포즈는 가로형 해상도(배너용)로 생성됩니다.  
- 조합당 실행 횟수는 `runsPerCombo`(기본 3)입니다.  
- 일반 서기·눕기·섹시 제스처 조합이 설정에 따라 자동 생성되므로, 최종 **검수** 위주로 운영하면 됩니다.

### 5. 성인용 영상 자동화(Batch)

- 입력 폴더의 **직계 하위 디렉터리 이름 = 포즈 이름**으로 간주하고, 각 폴더 안의 이미지(`png`, `jpg`, `jpeg`, `webp`)를 읽습니다.  
- 이미지당 **고정 시드 3개**로 영상을 만들고, 옵션으로 랜덤 시드를 켜면 **최대 5개**까지 확장됩니다.  
- 영상 프롬프트는 `pose-config.json`의 해당 포즈 항목 + 프리셋 **`prefixPrompt`** 를 사용합니다.  
- 성인용 이미지 검수가 끝난 뒤 같은 프리셋·경로 설정으로 넘기면 됩니다.

### 6. 마스킹 + 인페인팅(Emotion Pipeline)

- 작업 폴더(보통 `감정별 이미지`)를 지정합니다.  
- 옵션 **원본 서브폴더**(`원본`)만 스캔할 수 있습니다.  
- **마스크 출력 폴더 이름은 `masked`(소문자)** 입니다. `facemask` 프로젝트(레포에 용량 문제로 미포함 — 루트 README 참고)로 얼굴 영역을 투명 처리합니다.  
- 이미 **`masked` 폴더에 수동 마스크 PNG가 있으면** 자동 마스킹을 건너뛰고 그 파일을 짝지어 사용합니다.  
- 결과는 **`Emotions`** 폴더 아래에 감정별 하위 폴더로 저장됩니다:  
  `Neutral`, `Happy`, `Aroused`, `Sad`, `Angry`  
- **Neutral**: 인페인트 없이 **원본 이미지 업스케일만** 수행합니다.  
- **나머지 4감정**: 마스크 이미지로 **인페인트 → 업스케일** 순서입니다.  
- 라운드 수는 UI의 **upscaleSeedCount**(기본 3)이며, 백엔드에서는 `max(3, floor(값))`으로 최소 3라운드가 보장됩니다.  
- **감정 폴더당 최종 이미지 개수**는 대략  
  `(스캔에 포함된 원본 이미지 수) × (라운드 수)`  
  입니다. 예: 원본 2장 × 라운드 3 → 한 감정 폴더에 6장.

감정별 인페인트 텍스트는 프로젝트 루트의 **`img-emotion-config.json`** 에서 로드됩니다.
