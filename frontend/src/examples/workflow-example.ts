/**
 * ComfyUI 워크플로우 사용 예시
 * 
 * 이 파일은 백엔드 API를 사용하여 ComfyUI 워크플로우를 실행하는 방법을 보여줍니다.
 */

import { useState } from 'react';
import { comfyClient } from '../api/comfy-client';
import type { ComfyWorkflow } from '../api/comfy-client';

/**
 * 예시 1: 기본 text-to-image 워크플로우 실행
 */
export async function exampleBasicTextToImage() {
  // ComfyUI에서 "Save (API Format)"으로 저장한 워크플로우 JSON
  const workflow: ComfyWorkflow = {
    "3": {
      "inputs": {
        "seed": Math.floor(Math.random() * 1000000000000000),
        "steps": 20,
        "cfg": 8,
        "sampler_name": "euler",
        "scheduler": "normal",
        "denoise": 1,
        "model": ["4", 0],
        "positive": ["6", 0],
        "negative": ["7", 0],
        "latent_image": ["5", 0]
      },
      "class_type": "KSampler"
    },
    "4": {
      "inputs": {
        "ckpt_name": "sd_xl_base_1.0.safetensors"
      },
      "class_type": "CheckpointLoaderSimple"
    },
    "5": {
      "inputs": {
        "width": 1024,
        "height": 1024,
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage"
    },
    "6": {
      "inputs": {
        "text": "beautiful landscape, mountains, sunset, highly detailed",
        "clip": ["4", 1]
      },
      "class_type": "CLIPTextEncode"
    },
    "7": {
      "inputs": {
        "text": "text, watermark, low quality",
        "clip": ["4", 1]
      },
      "class_type": "CLIPTextEncode"
    },
    "8": {
      "inputs": {
        "samples": ["3", 0],
        "vae": ["4", 2]
      },
      "class_type": "VAEDecode"
    },
    "9": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": ["8", 0]
      },
      "class_type": "SaveImage"
    }
  };

  try {
    console.log('🚀 워크플로우 실행 중...');
    const result = await comfyClient.executeWorkflow(workflow);
    
    console.log('✅ 실행 완료!');
    console.log('Prompt ID:', result.prompt_id);
    
    // 이미지 URL 추출
    const imageUrls = comfyClient.extractImageUrls(result);
    console.log('생성된 이미지:', imageUrls);
    
    return imageUrls;
  } catch (error) {
    console.error('❌ 워크플로우 실행 실패:', error);
    throw error;
  }
}

/**
 * 예시 2: 프롬프트를 동적으로 변경하여 실행
 */
export async function exampleDynamicPrompt(
  positivePrompt: string,
  negativePrompt: string = 'text, watermark, low quality'
) {
  const workflow: ComfyWorkflow = {
    // ... (위와 동일한 구조)
    "6": {
      "inputs": {
        "text": positivePrompt,  // 동적으로 변경
        "clip": ["4", 1]
      },
      "class_type": "CLIPTextEncode"
    },
    "7": {
      "inputs": {
        "text": negativePrompt,  // 동적으로 변경
        "clip": ["4", 1]
      },
      "class_type": "CLIPTextEncode"
    },
    // ... 나머지 노드
  };

  return await comfyClient.executeWorkflow(workflow);
}

/**
 * 예시 3: 여러 이미지를 배치로 생성
 */
export async function exampleBatchGeneration(prompts: string[]) {
  const results = [];

  for (const prompt of prompts) {
    console.log(`생성 중: "${prompt}"`);
    const result = await exampleDynamicPrompt(prompt);
    results.push(result);
    
    // API 과부하 방지를 위한 딜레이
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

/**
 * 예시 4: 큐에 추가만 하고 비동기로 처리
 */
export async function exampleQueueOnly(workflow: ComfyWorkflow) {
  try {
    const { prompt_id } = await comfyClient.queueWorkflow(workflow);
    console.log('큐에 추가됨:', prompt_id);
    
    // 나중에 히스토리에서 결과 확인
    setTimeout(async () => {
      const history = await comfyClient.getHistory(prompt_id);
      console.log('실행 결과:', history);
    }, 10000);
    
    return prompt_id;
  } catch (error) {
    console.error('큐 추가 실패:', error);
    throw error;
  }
}

/**
 * 예시 5: 시스템 상태 모니터링
 */
export async function exampleMonitoring() {
  try {
    // 큐 상태 확인
    const queueStatus = await comfyClient.getQueueStatus();
    console.log('큐 상태:', queueStatus);
    
    // 시스템 통계 확인
    const stats = await comfyClient.getSystemStats();
    console.log('시스템 통계:', stats);
    
    return { queueStatus, stats };
  } catch (error) {
    console.error('모니터링 실패:', error);
    throw error;
  }
}

/**
 * React Hook 예시
 */
export function useComfyWorkflow() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  const executeWorkflow = async (workflow: ComfyWorkflow) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await comfyClient.executeWorkflow(workflow);
      const imageUrls = comfyClient.extractImageUrls(result);
      setImages(imageUrls);
      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { executeWorkflow, loading, error, images };
}
