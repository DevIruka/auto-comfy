# RunPod / ComfyUI Pod 설치 요구사항

아래 세 워크플로우를 실행하기 위해 필요한 **모든** 체크포인트·모델·텍스트 인코더·LoRA·기타 에셋을 정리한 목록입니다.  
빠짐없이 이 목록대로 설치하면 동일 환경에서 워크플로우를 돌릴 수 있습니다.

--

## 2. SDXL 워크플로우 (sdxl-wai.json, sdxl-wai-hires.json)

### 2.1 체크포인트 (Checkpoints)

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **WAI-NSFW-illustrious-SDXL.safetensors** | `ComfyUI/models/checkpoints/` | 메인 SDXL 베이스 모델 (Efficient Loader) |

### 2.2 VAE

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **sdxl_vae.safetensors** | `ComfyUI/models/vae/` | SDXL VAE (Efficient Loader에서 지정) |

### 2.3 텍스트 인코더 (CLIP)

- **WAI-NSFW-illustrious-SDXL.safetensors**가 SDXL 체크포인트 한 파일에 CLIP이 포함된 형태라면, **별도 CLIP 파일은 필요 없습니다.**
- 만약 프로젝트에서 CLIP을 분리해서 쓰고 있다면, 그때 사용하는 CLIP 파일을 동일하게 `ComfyUI/models/clip/` 등에 두면 됩니다.

### 2.5 업스케일 모델 (sdxl-wai-hires 전용)

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **4xUltrasharp_4xUltrasharpV10.pt** | `ComfyUI/models/upscale_models/` | Ultimate SD Upscale 💬ED |

## 3. Wan 2.2 워크플로우 (wan-2.2.json)

### 3.1 VAE

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **wan_2.1_vae.safetensors** | `ComfyUI/models/vae/` | Wan 2.2용 VAE (VAELoader) |

### 3.2 텍스트 인코더 (CLIP) — Wan 전용

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **umt5_xxl_fp8_e4m3fn_scaled.safetensors** | `ComfyUI/models/clip/` (Wan용 CLIP이 있다면 그 하위 또는 문서 안내 경로) | CLIPLoader, type: wan |

### 3.3 UNET (확산 모델) — Wan 2.2

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **Smooth Mix Wan 2.2 high.safetensors** | `ComfyUI/models/unet/` 또는 WAN 노드에서 지정하는 diffusion/unet 경로 | 고해상도 구간용 UNET |
| **Smooth Mix Wan 2.2 low.safetensors** | 위와 동일 | 저노이즈 구간용 UNET |

### 3.4 CLIP Vision (Wan 비디오용)

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **clip_vision_h.safetensors** | `ComfyUI/models/clip_vision/` | CLIPVisionLoader (시작/끝 프레임 인코딩) |

### 3.5 LoRA (Wan 2.2용)

| 파일명 | 넣을 경로 | 용도 |
|--------|-----------|------|
| **gameb.safetensors** | `ComfyUI/models/loras/` | LoraLoaderModelOnly (high/low 둘 다) |
| **Live Wallpaper Style.safetensors** | `ComfyUI/models/loras/` | LoraLoaderModelOnly (high/low 둘 다) |

이 목록을 기준으로 같은 RunPod(또는 다른 Pod)에 한 번만 셋업해 두면, 세 워크플로우 모두 그대로 사용할 수 있습니다.
