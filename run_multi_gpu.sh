#!/bin/bash
cd ComfyUI
source venv/bin/activate

# 사용 가능한 GPU 개수만 감지 (nvidia-smi는 NVIDIA GPU만 반환)
GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l)
if [ "$GPU_COUNT" -eq 0 ]; then
  echo "No GPU found. Exiting."
  exit 1
fi

echo "Found $GPU_COUNT GPU(s). Starting ComfyUI on ports 8188-$((8188 + GPU_COUNT - 1))"

for i in $(seq 0 $((GPU_COUNT - 1))); do
  PORT=$((8188 + i))
  echo "Starting ComfyUI on GPU $i, port $PORT"
  CUDA_VISIBLE_DEVICES=$i python main.py --preview-method auto --listen --port "$PORT" &
done

echo "All ComfyUI instances started"
wait
