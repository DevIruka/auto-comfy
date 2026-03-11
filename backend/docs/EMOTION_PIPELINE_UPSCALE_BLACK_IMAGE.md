# Emotion Pipeline: 첫 이미지만 업스케일 정상, 두 번째부터 검정 이미지

## 현상

- **첫 번째** 업스케일 결과: 정상
- **두 번째** 이후: ComfyUI에서도 검정 이미지로 출력

로그 예:

```
Efficiency Nodes ED: using saved ultra_bbox_detector cache - bbox/face_yolov8m.pt
Efficiency Nodes ED: using saved sam_model cache - sam_vit_b_01ec64.pth
...
/workspace/ComfyUI/custom_nodes/comfyui-impact-pack/modules/impact/utils.py:155: RuntimeWarning: invalid value encountered in cast
  return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(0), 0, 255).astype(np.uint8))
```

- **캐시 재사용**: bbox/SAM이 "saved ... cache"로 이전 run 결과를 그대로 사용.
- **검은 화면 직접 원인 후보**: Impact Pack의 `impact/utils.py`에서 이미지 텐서를 `uint8`로 캐스팅할 때 **invalid value (NaN/Inf)** 가 있어서 `RuntimeWarning` 발생. NaN이 포함된 영역은 `astype(np.uint8)` 시 0(검정)으로 떨어지거나 비정상 값이 되어 **검정 픽셀**로 보일 수 있음. 즉, 잘못된 bbox/영역 → 빈/이상 latent → VAE decode에서 NaN → 캐스트 시 검정.

## 조사 요약 (웹 검색 + 코드)

### 1. Efficiency Nodes ED 캐시 가설 (가능성 높음)

- `ultra_bbox_detector` / `sam_model` 을 **캐시**해서 재사용함.
- **첫 실행**: 새 이미지로 bbox/SAM 실행 → 정상 출력.
- **두 번째 실행**: 다른 이미지를 넣어도 **이전 실행의 캐시(마스크/bbox)** 가 그대로 쓰이거나, 캐시 키가 이미지별로 구분되지 않아 **잘못된 영역**에 디테일링/업스케일이 적용됨 → 빈 latent 또는 잘못된 영역 → **검정 출력**.

즉, “첫 장만 정상, 이후 검정”은 **두 번째부터 입력 이미지는 바뀌는데, 디테일러/업스케일 경로에서 쓰는 bbox/SAM 결과는 첫 번째 것이라서** 생기는 현상일 수 있음.

### 2. FaceDetailer + 배치 (ComfyUI 문서/이슈)

- FaceDetailer 등 **디테일러 노드**는 **배치** 입력 시 두 번째 이미지부터 **빈/검정 latent** 가 나오는 이슈가 보고됨.
- 권장: **Rebatch Latents** 로 배치 크기 1로 나누거나, **이미지별로 따로 실행**.
- 우리 파이프라인은 **이미지당·라운드당 별도 API 호출**로 한 장씩 보내므로, “한 프롬프트 안의 배치”보다는 **서버 쪽 노드 캐시**가 run 간에 유지되는 쪽이 더 유력함.

### 3. 우리 코드

- 업스케일 시: `getFirstImageFromOutput(..., HIRES_SAVE_NODE_ID)` 로 **항상 첫 번째 이미지만** 사용.
- 매 라운드마다 **새 이미지 업로드 → 새 프롬프트 큐** 이므로, “같은 배치에서 두 번째 슬롭” 문제는 아님.
- 따라서 **ComfyUI / Efficiency Nodes ED 내부에서 run 간 상태(캐시)** 가 유지되는지가 핵심.

## 대응 방향

1. **Efficiency Nodes ED 쪽**
   - bbox/SAM **캐시 비활성화** 또는 **캐시 키를 이미지/프롬프트별로** 쓰는 옵션이 있는지 확인.
   - [NyaamZ/efficiency-nodes-ED](https://github.com/NyaamZ/efficiency-nodes-ED) 이슈에 위 로그와 “first image OK, second run black” 현상으로 문의/버그 리포트.

2. **워크플로우**
   - HiRes Fix 워크플로우에서 **FaceDetailer / 디테일러**를 쓰는 경우, “배치 1장만” 넘기거나, Rebatch Latents로 1장씩만 들어가게 구성해 보기.

3. **실험**
   - **동일 이미지**로 업스케일을 **연속 두 번** 돌렸을 때: 둘 다 정상이면 “캐시가 첫 번째 결과를 재사용해서 두 번째만 검정” 가설이 약해짐.
   - **서로 다른 이미지**로 연속 두 번 돌렸을 때만 두 번째가 검정이면, **캐시가 이미지별로 갱신되지 않는 문제** 가능성이 높음.

4. **임시 우회**
   - ComfyUI를 **프로세스 재시작**하거나, 업스케일 전에 **캐시를 비우는** 방법이 있다면(노드 옵션/스크립트) 그걸 사용해 보기.

---

정리: **Efficiency Nodes ED의 ultra_bbox_detector / sam_model 캐시**가 run 간에 초기화되지 않아, 두 번째 실행부터 잘못된 영역/빈 latent로 검정 이미지가 나오는 가능성이 큼. 노드 옵션·이슈 트래커 확인 및 필요 시 캐시 비활성화/이미지별 캐시 키 사용을 요청하는 것이 좋음.
