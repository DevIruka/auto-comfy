# Changelog

## [Unreleased] - 2026-01-28

### Added

- **Multi-ComfyUI Instance Support**: 여러 ComfyUI 인스턴스를 동시에 관리하고 활용

  - `ComfyManagerService`: 다중 인스턴스 관리 서비스
  - `.env`에서 `COMFYUI_API_URL_1`, `COMFYUI_API_URL_2` 형태로 설정
  - UI에서 폴더 쌍마다 ComfyUI 인스턴스 선택 가능
  - API 엔드포인트: `GET /api/comfy-instances`

- **Emotion-based Video Generation System**: 감정 기반 대화/대기 영상 자동 생성
  - 파일명에서 자동 감정 인식 (예: `sit_neutral.png`, `stand_angry.png`)
  - nude 폴더 지원 (파일명에 Naked 태그 자동 추가)
  - `emotion-config.json`: 감정별 프롬프트 설정
  - 영상 생성 규칙:
    - **neutral**: 9개 영상 (Idle 3개 + SpeakNatural 6개)
    - **기타 감정** (angry, sad, happy, aroused): 6개 영상 (SpeakNatural만)
  - 출력 파일명: `{Pose}_{Type}_{Emotion}Transition_{Clothing}_{Number}.mkv`
    - 예: `Sit_Idle_Neutral_to_Neutral_Clothed_00001.mkv`
    - 예: `Stand_SpeakNatural_Angry_to_Angry_Naked_00002.mkv`
  - 새로운 UI 탭: "😊 Emotion Videos"
  - API 엔드포인트:
    - `POST /api/emotion-batch/scan`
    - `POST /api/emotion-batch/start`
    - `POST /api/emotion-batch/:jobId/pause`
    - `GET /api/emotion-batch/:jobId/status`

### Changed

- `ComfyService` 생성자가 이제 URL과 clientId를 파라미터로 받음 (다중 인스턴스 지원)
- WebSocket 설정에 감정 배치 서비스 broadcast 추가
- 프론트엔드 App 컴포넌트에 세 번째 탭 추가 (Emotion Videos)
- 예상 영상 수 및 소요 시간 계산 로직 개선 (감정별 영상 개수 차이 반영)

### Fixed

- 기존 성인용 포즈 배치 시스템 완전히 유지 (변경 없음)
- Single Generation 기능 그대로 유지
- 모든 기존 API 엔드포인트 하위 호환성 보장

## Technical Details

### Backend Files Added

- `src/services/comfy-manager.service.ts`: ComfyUI 인스턴스 관리
- `src/services/emotion-batch.service.ts`: 감정 비디오 배치 처리
- `src/routes/emotion-batch.routes.ts`: 감정 배치 API 라우트
- `src/routes/comfy-instances.routes.ts`: ComfyUI 인스턴스 목록 API
- `src/utils/emotion-helpers.ts`: 파일명 파싱 및 생성 유틸리티

### Frontend Files Added

- `src/api/emotion-batch-client.ts`: 감정 배치 API 클라이언트
- `src/components/EmotionBatchProcessor.tsx`: 감정 비디오 UI 컴포넌트
- `src/hooks/useEmotionBatchProgress.ts`: WebSocket 진행률 추적 훅

### Configuration Files

- `emotion-config.json`: 감정별 프롬프트 설정 (neutral만 idle 프롬프트 포함)
- `.env.example`: 다중 ComfyUI 인스턴스 설정 예시 추가
