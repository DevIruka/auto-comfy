import cv2
import numpy as np
import shutil
import urllib.request
from pathlib import Path

import torch
from segment_anything import sam_model_registry, SamPredictor

YOLO_URL  = "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt"
YOLO_PATH = Path(__file__).parent / "face_yolov8m.pt"

SAM_MODEL_URL = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
SAM_MODEL_PATH = Path(__file__).parent / "sam_vit_b_01ec64.pth"

_yolo_model = None


def _download(url: str, path: Path, label: str):
    if path.exists():
        return
    print(f"{label} 다운로드 중...")
    urllib.request.urlretrieve(url, path)
    print(f"완료: {path}")


def _load_sam() -> SamPredictor:
    _download(SAM_MODEL_URL, SAM_MODEL_PATH, "SAM 모델 (~375MB)")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"SAM 실행 장치: {device}")
    sam = sam_model_registry["vit_b"](checkpoint=str(SAM_MODEL_PATH))
    sam.to(device)
    return SamPredictor(sam)


def _detect_faces(bgr_image: np.ndarray):
    global _yolo_model
    if _yolo_model is None:
        _download(YOLO_URL, YOLO_PATH, "face_yolov8m 모델 (~52MB)")
        from ultralytics import YOLO
        _yolo_model = YOLO(str(YOLO_PATH))

    rgb_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)
    results = _yolo_model(rgb_image, verbose=False)

    faces = []
    for box in results[0].boxes:
        conf = box.conf[0].item()
        if conf < 0.40:
            continue
        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
        faces.append((x1, y1, x2 - x1, y2 - y1))
    return faces


def _get_eye_positions(bgr_image, x, y, fw, fh):
    """
    눈 위치를 두 단계로 감지합니다.

    1단계: 전체 ROI에서 cascade(minNeighbors=3) 탐색
    2단계: 한 쪽만 검출된 경우, 반대쪽 절반 ROI에서 어두운 클러스터 탐색
           → iris/pupil은 주변보다 현저히 어두워 머리카락에 가려도 감지 가능
    Fallback: 둘 다 미검출 시 bbox 비율 기반 추정

    반환: [(cx, cy), (cx, cy)]  — 항상 두 눈의 중심 좌표
    """
    cx_face = x + fw // 2
    eye_y1  = y + int(fh * 0.20)
    eye_y2  = y + int(fh * 0.60)

    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")

    def _cascade_in_roi(roi_bgr, x_offset, y_offset, min_n=3, scale=1.1):
        gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
        raw  = cascade.detectMultiScale(gray, scaleFactor=scale, minNeighbors=min_n)
        result = []
        if len(raw) > 0:
            for (ex, ey, ew, eh) in raw:
                result.append((x_offset + ex + ew // 2, y_offset + ey + eh // 2))
        return result

    def _high_variance_eye_in_roi(roi_bgr, x_offset, y_offset):
        """
        ROI에서 로컬 분산이 가장 높은 위치를 눈 중심으로 반환합니다.
        눈은 어두운 iris/pupil과 밝은 sclera가 인접해 로컬 대비(분산)가 높습니다.
        머리카락은 균일하게 어두워 분산이 낮으므로 구별 가능합니다.
        """
        h_roi, w_roi = roi_bgr.shape[:2]
        if h_roi == 0 or w_roi == 0:
            return None

        gray   = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
        k      = 13   # 분산 계산 윈도우 크기
        mean   = cv2.blur(gray, (k, k))
        mean_sq = cv2.blur(gray ** 2, (k, k))
        var    = np.clip(mean_sq - mean ** 2, 0, None)

        # 스무딩으로 노이즈 제거 후 최고 분산 위치 탐색
        var_smooth = cv2.GaussianBlur(var, (9, 9), 0)
        _, _, _, max_loc = cv2.minMaxLoc(var_smooth)

        return (max_loc[0] + x_offset, max_loc[1] + y_offset)

    # 1단계: 전체 ROI cascade
    full_roi = bgr_image[eye_y1:eye_y2, x:x + fw]
    detected = _cascade_in_roi(full_roi, x, eye_y1, min_n=3, scale=1.1)

    if len(detected) >= 2:
        return detected[:2]

    # 2단계: 한 쪽만 검출 → 3/4뷰 원근 압축으로 반대쪽 눈 위치 추정
    #
    # 원리: 얼굴 중심 기준 근거리 눈의 가장자리-거리(near_dist)를
    #       원근 압축 계수(PERSPECTIVE_RATIO ≈ 0.35)로 스케일해
    #       원거리 눈의 가장자리-거리를 구한다.
    #       (ex. 오른쪽 눈이 오른쪽 가장자리에서 196px 이면
    #            왼쪽 눈은 왼쪽 가장자리에서 ≈ 196 × 0.35 = 69px)
    PERSPECTIVE_RATIO = 0.35

    if len(detected) == 1:
        dcx, dcy = detected[0]
        if dcx >= cx_face:
            # 오른쪽 눈 검출 → 왼쪽(원거리) 눈: 기하학적 추정 + variance 보조
            near_dist = (x + fw) - dcx
            x_far = x + int(near_dist * PERSPECTIVE_RATIO)
            y_far = dcy + int(fh * 0.04)
            geom  = (x_far, y_far)
            # variance 보조 위치 (eye iris/sclera 경계의 고대비 지점)
            opp_roi = bgr_image[eye_y1:eye_y2, x:cx_face]
            var = _high_variance_eye_in_roi(opp_roi, x, eye_y1)
        else:
            # 왼쪽 눈 검출 → 오른쪽(원거리) 눈: 기하학적 추정 + variance 보조
            near_dist = dcx - x
            x_far = (x + fw) - int(near_dist * PERSPECTIVE_RATIO)
            y_far = dcy + int(fh * 0.04)
            geom  = (x_far, y_far)
            opp_roi = bgr_image[eye_y1:eye_y2, cx_face:x + fw]
            var = _high_variance_eye_in_roi(opp_roi, cx_face, eye_y1)

        # 기하학적 + variance 두 위치 모두 eye SAM에 전달 (서로 다른 부분 커버)
        extra = [var] if var and var != geom else []
        return [detected[0], geom] + extra

    # 둘 다 미검출 → bbox 비율 fallback
    cy_eye = y + int(fh * 0.35)
    return [
        (cx_face - int(fw * 0.18), cy_eye),
        (cx_face + int(fw * 0.18), cy_eye),
    ]


def _predict_best(predictor, pos_pts, pos_labels, box, expected_area,
                  ratio_min=0.05, ratio_max=1.0):
    """SAM predict 후 면적 비율 기준으로 최적 마스크를 반환합니다."""
    h, w = predictor.original_size
    pos_pts = np.clip(pos_pts, [0, 0], [w - 1, h - 1])

    masks, scores, _ = predictor.predict(
        point_coords=pos_pts,
        point_labels=pos_labels,
        box=box,
        multimask_output=True,
    )
    best_mask, best_score = None, -1
    for mask, score in zip(masks, scores):
        ratio = mask.sum() / expected_area
        if ratio_min < ratio < ratio_max and score > best_score:
            best_score = score
            best_mask  = mask
    return (best_mask if best_mask is not None else masks[np.argmax(scores)]).astype(np.uint8) * 255


def _sam_skin_mask(predictor, x, y, fw, fh, eye_positions=None):
    """
    얼굴 피부 영역만 SAM으로 감지합니다.
    - box: 상단 10% 제거 (눈썹 위까지 포함)
    - positive: 볼, 코, 턱, 눈썹 위치 + 눈 위치(별도 전달 시 추가)
    - negative: bbox 상단 중앙만 (좌우 측면 negative 제거 → 눈 영역 차단 방지)
    """
    cx = x + fw // 2
    cy = y + int(fh * 0.62)   # 피부 중심: 눈 아래쪽 (볼~턱 범위)

    box = np.array([
        x + int(fw * 0.04),
        y + int(fh * 0.10),   # 상단 10%만 제거 (눈썹 영역 포함)
        x + fw - int(fw * 0.04),
        y + int(fh * 0.93),
    ], dtype=np.float32)

    pos_list = [
        [cx,                   cy           ],   # 코~입 중심
        [cx - fw // 5,         cy           ],   # 왼쪽 볼
        [cx + fw // 5,         cy           ],   # 오른쪽 볼
        [cx,                   cy + fh // 7 ],   # 턱
        [cx,                   cy - fh // 7 ],   # 코 위
        [cx - int(fw * 0.20),  y + int(fh * 0.28)],  # 왼쪽 눈썹
        [cx + int(fw * 0.20),  y + int(fh * 0.28)],  # 오른쪽 눈썹
    ]
    # 눈 위치를 피부 SAM positive point로 추가 (눈 포함 보장)
    if eye_positions:
        for (ecx, ecy) in eye_positions:
            pos_list.append([ecx, ecy])

    pos_pts    = np.array(pos_list, dtype=np.float32)
    pos_labels = np.ones(len(pos_pts), dtype=np.int32)

    # negative는 상단 중앙만 (좌우 측면 제거 → 왼쪽 눈 포함 가능하도록)
    neg_pts = np.array([
        [cx,   y + int(fh * 0.08)],   # 상단 중앙 (머리카락)
        [cx,   y + int(fh * 0.13)],   # 상단 중앙 보조
    ], dtype=np.float32)
    neg_labels = np.zeros(len(neg_pts), dtype=np.int32)

    all_pts    = np.vstack([pos_pts, neg_pts])
    all_labels = np.concatenate([pos_labels, neg_labels])

    return _predict_best(predictor, all_pts, all_labels, box,
                         expected_area=fw * fh, ratio_min=0.10, ratio_max=0.85)


def _sam_eye_mask(predictor, ecx, ecy, fw, fh):
    """
    눈 + 눈썹 영역을 SAM으로 정밀 감지합니다.
    - box를 위쪽으로 확장해 눈썹 영역까지 포함
    - positive: 눈 중심 + 눈썹 위치
    """
    ew = int(fw * 0.30)
    eh = int(fh * 0.28)

    brow_offset = int(fh * 0.11)   # 눈썹은 눈 중심에서 약 11% 위
    box = np.array([
        ecx - ew // 2,
        ecy - eh // 2 - brow_offset,   # 박스 상단을 눈썹 위까지 확장
        ecx + ew // 2,
        ecy + eh // 2,
    ], dtype=np.float32)

    brow_y = ecy - brow_offset
    pos_pts    = np.array([[ecx, ecy], [ecx, brow_y]], dtype=np.float32)
    pos_labels = np.array([1, 1], dtype=np.int32)

    return _predict_best(predictor, pos_pts, pos_labels, box,
                         expected_area=ew * eh, ratio_min=0.05, ratio_max=3.0)


def _sam_hair_mask(predictor, bgr_image, x, y, fw, fh):
    """
    헤어 영역을 SAM으로 감지합니다.
    - box  : 얼굴 bbox보다 위·좌우로 확장 (헤어가 얼굴 밖에도 있음)
    - positive : 얼굴 상단(뱅·정수리) + 좌우 측면 헤어
    - negative : 얼굴 피부 중심부 (코·볼·턱)
    반환된 마스크를 얼굴 마스크에서 빼면 헤어가 얼굴 위에 걸친 부분도 보존됩니다.
    """
    h_img, w_img = bgr_image.shape[:2]
    cx = x + fw // 2

    box = np.array([
        max(0,          x - int(fw * 0.30)),
        max(0,          y - int(fh * 0.70)),   # 머리 위쪽 헤어 포함
        min(w_img - 1,  x + fw + int(fw * 0.30)),
        y + int(fh * 0.22),                    # 눈썹 위까지만 (눈썹을 헤어로 오인 방지)
    ], dtype=np.float32)

    pos_pts = np.array([
        [cx,                      max(0, y - int(fh * 0.10))],  # 얼굴 바로 위 (헤어)
        [cx,                      y + int(fh * 0.05)         ],  # bbox 상단 내부 (뱅)
        [x + int(fw * 0.05),      y + int(fh * 0.10)         ],  # 좌측 헤어
        [x + fw - int(fw * 0.05), y + int(fh * 0.10)         ],  # 우측 헤어
    ], dtype=np.float32)
    pos_pts    = np.clip(pos_pts, [0, 0], [w_img - 1, h_img - 1])
    pos_labels = np.ones(len(pos_pts), dtype=np.int32)

    neg_pts = np.array([
        [cx,                  y + int(fh * 0.42)],   # 코 아래 (피부)
        [cx,                  y + int(fh * 0.58)],   # 볼·입 (피부)
        [cx - int(fw * 0.15), y + int(fh * 0.45)],   # 왼쪽 볼 (피부)
        [cx + int(fw * 0.15), y + int(fh * 0.45)],   # 오른쪽 볼 (피부)
        [cx - int(fw * 0.20), y + int(fh * 0.28)],   # 왼쪽 눈썹 (피부, 헤어 제외)
        [cx + int(fw * 0.20), y + int(fh * 0.28)],   # 오른쪽 눈썹 (피부, 헤어 제외)
    ], dtype=np.float32)
    neg_pts    = np.clip(neg_pts, [0, 0], [w_img - 1, h_img - 1])
    neg_labels = np.zeros(len(neg_pts), dtype=np.int32)

    all_pts    = np.vstack([pos_pts, neg_pts])
    all_labels = np.concatenate([pos_labels, neg_labels])

    return _predict_best(predictor, all_pts, all_labels, box,
                         expected_area=fw * fh, ratio_min=0.05, ratio_max=3.0)


def _build_face_mask(predictor, bgr_image, x, y, fw, fh):
    """
    얼굴 피부(SAM) + 양쪽 눈(SAM)을 별도 감지 후 합산합니다.
    이후 헤어 마스크(SAM)를 빼서 헤어가 얼굴에 걸친 부분을 보존합니다.
    """
    h, w = bgr_image.shape[:2]

    # 1) 눈 위치 파악 (기하학적 추정 + variance 보조)
    eye_positions = _get_eye_positions(bgr_image, x, y, fw, fh)

    # 2) 피부 마스크 (cascade 눈 위치 hint 전달)
    skin = _sam_skin_mask(predictor, x, y, fw, fh, eye_positions=eye_positions)

    # 3) 각 눈 별도 SAM
    eye_mask = np.zeros((h, w), dtype=np.uint8)
    for (ecx, ecy) in eye_positions:
        em = _sam_eye_mask(predictor, ecx, ecy, fw, fh)
        eye_mask = cv2.bitwise_or(eye_mask, em)

    # 3) 합산
    result = cv2.bitwise_or(skin, eye_mask)

    # 4) 후처리: 구멍 채우기
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    result = cv2.morphologyEx(result, cv2.MORPH_CLOSE, kernel, iterations=3)
    flood = result.copy()
    cv2.floodFill(flood, np.zeros((h + 2, w + 2), dtype=np.uint8), (0, 0), 128)
    result[flood == 0] = 255

    # 5) 헤어 마스크 차감 — 헤어가 얼굴 위에 걸친 부분은 투명화하지 않음
    hair = _sam_hair_mask(predictor, bgr_image, x, y, fw, fh)
    result = cv2.bitwise_and(result, cv2.bitwise_not(hair))

    # 6) 충분히 큰 영역만 유지
    min_area = int(fw * fh * 0.005)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(result, connectivity=8)
    clean = np.zeros_like(result)
    for label_id in range(1, num):
        if stats[label_id, cv2.CC_STAT_AREA] >= min_area:
            clean[labels == label_id] = 255
    result = clean

    # 7) 턱 아래 차단
    result[y + int(fh * 0.95):, :] = 0

    return result


def make_face_transparent(
    image_path: str,
    output_path: str,
    soft: bool = False,
    feather: int = 12,
    predictor=None,
) -> np.ndarray:
    """
    이미지 한 장의 얼굴 영역을 투명하게 만듭니다.

    predictor: 외부에서 미리 로드한 SamPredictor를 전달하면 재사용합니다.
               None이면 내부에서 SAM을 로드합니다.
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"이미지를 찾을 수 없습니다: {image_path}")

    bgr_image = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr_image is None:
        raise ValueError(f"이미지를 불러올 수 없습니다: {image_path}")

    rgba_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2BGRA)

    faces = _detect_faces(bgr_image)
    if len(faces) == 0:
        print("  얼굴을 감지하지 못했습니다.")
        cv2.imencode(".png", rgba_image)[1].tofile(str(output_path))
        return rgba_image, 0
    print(f"  감지된 얼굴 수: {len(faces)}")

    if predictor is None:
        predictor = _load_sam()
    predictor.set_image(cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB))

    for i, (x, y, fw, fh) in enumerate(faces):
        print(f"  얼굴 {i+1}: 피부 SAM + 눈 SAM + 헤어 SAM 실행 중...")
        face_mask = _build_face_mask(predictor, bgr_image, x, y, fw, fh)

        if soft:
            feather_size = feather * 2 + 1
            soft_mask = cv2.GaussianBlur(face_mask, (feather_size, feather_size), 0)
            rgba_image[:, :, 3] = np.where(
                soft_mask > 0,
                (255 - soft_mask).astype(np.uint8),
                rgba_image[:, :, 3],
            )
        else:
            rgba_image[face_mask == 255, 3] = 0

        print(f"  얼굴 {i+1}: 완료")

    cv2.imencode(".png", rgba_image)[1].tofile(str(output_path))
    return rgba_image, len(faces)


if __name__ == "__main__":
    import sys

    soft_mode = "--soft" in sys.argv

    input_dir  = Path("input")
    output_dir = Path("output")

    if not input_dir.exists():
        print(f"input 폴더가 없습니다: {input_dir.resolve()}")
        sys.exit(1)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir()

    extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    images = sorted(f for f in input_dir.iterdir() if f.suffix.lower() in extensions)

    if not images:
        print("input 폴더에 처리할 이미지가 없습니다.")
        sys.exit(1)

    print(f"처리할 이미지: {len(images)}장")

    predictor = _load_sam()

    for idx, img_path in enumerate(images, 1):
        output_path = output_dir / (img_path.stem + ".png")
        print(f"\n[{idx}/{len(images)}] {img_path.name} → {output_path.name}")
        try:
            _, face_count = make_face_transparent(str(img_path), str(output_path), soft=soft_mode, predictor=predictor)
            if face_count == 0:
                fail_path = output_dir / (img_path.stem + "_fail.png")
                output_path.rename(fail_path)
                print(f"  저장 완료 (미감지): {fail_path}")
            else:
                print(f"  저장 완료: {output_path}")
        except Exception as e:
            print(f"  오류 발생: {e}")

    print(f"\n전체 완료: {len(images)}장 처리됨 → {output_dir.resolve()}")
