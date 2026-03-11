/**
 * ComfyUI Backend API Client
 * 프론트엔드에서 백엔드 API를 호출하기 위한 클라이언트
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
}

export interface ComfyWorkflow {
  [nodeId: string]: {
    inputs: Record<string, unknown>;
    class_type: string;
    _meta?: unknown;
  };
}

export interface ExecutionResult {
  prompt_id: string;
  outputs: {
    [nodeId: string]: {
      images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
    };
  };
}

export interface ComfyInstanceInfo {
  id: string;
  url: string;
  name: string;
  podId?: string | null;
  port?: string | null;
}

export function groupInstancesByPod(
  instances: ComfyInstanceInfo[],
): Array<{ podId: string | null; label: string; instances: ComfyInstanceInfo[] }> {
  const byPod = new Map<string | null, ComfyInstanceInfo[]>();
  for (const inst of instances) {
    const key = inst.podId ?? null;
    if (!byPod.has(key)) byPod.set(key, []);
    byPod.get(key)!.push(inst);
  }
  const result: Array<{
    podId: string | null;
    label: string;
    instances: ComfyInstanceInfo[];
  }> = [];
  byPod.forEach((insts, podId) => {
    const label =
      podId != null
        ? `Pod ${podId}`
        : "기타";
    result.push({ podId, label, instances: insts });
  });
  return result;
}

class ComfyClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * 워크플로우를 큐에 추가 (비동기)
   */
  async queueWorkflow(workflow: ComfyWorkflow): Promise<{ prompt_id: string; number: number }> {
    const response = await fetch(`${this.baseUrl}/api/comfy/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workflow }),
    });

    const result: ApiResponse<{ prompt_id: string; number: number }> = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to queue workflow');
    }

    return result.data!;
  }

  /**
   * 워크플로우를 실행하고 완료까지 대기 (동기)
   */
  async executeWorkflow(workflow: ComfyWorkflow): Promise<ExecutionResult> {
    const response = await fetch(`${this.baseUrl}/api/comfy/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workflow }),
    });

    const result: ApiResponse<ExecutionResult> = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to execute workflow');
    }

    return result.data!;
  }

  /**
   * 히스토리 조회
   */
  async getHistory(promptId?: string): Promise<unknown> {
    const url = promptId
      ? `${this.baseUrl}/api/comfy/history/${promptId}`
      : `${this.baseUrl}/api/comfy/history`;

    const response = await fetch(url);
    const result: ApiResponse = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get history');
    }

    return result.data;
  }

  /**
   * 큐 상태 조회
   */
  async getQueueStatus(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/comfy/queue`);
    const result: ApiResponse = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get queue status');
    }

    return result.data;
  }

  /**
   * 프롬프트 취소
   */
  async cancelPrompt(promptId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/comfy/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ promptId }),
    });

    const result: ApiResponse = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to cancel prompt');
    }
  }

  /**
   * 시스템 통계 조회
   */
  async getSystemStats(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/comfy/system-stats`);
    const result: ApiResponse = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get system stats');
    }

    return result.data;
  }

  /**
   * 이미지 URL 생성
   */
  getImageUrl(filename: string, subfolder: string = '', type: string = 'output'): string {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });
    return `${this.baseUrl}/api/comfy/image?${params}`;
  }

  /**
   * 실행 결과에서 이미지 URL 추출
   */
  extractImageUrls(result: ExecutionResult): string[] {
    const imageUrls: string[] = [];

    for (const nodeOutput of Object.values(result.outputs)) {
      if (nodeOutput.images) {
        for (const image of nodeOutput.images) {
          imageUrls.push(this.getImageUrl(image.filename, image.subfolder, image.type));
        }
      }
    }

    return imageUrls;
  }

  /**
   * 헬스 체크
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  /**
   * Get available LoRA files from a ComfyUI instance
   */
  async getLoraList(instanceId?: string): Promise<string[]> {
    const params = instanceId ? `?instanceId=${instanceId}` : '';
    const response = await fetch(`${this.baseUrl}/api/image-gen/loras${params}`);
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get LoRA list');
    }
    return result.data?.loras ?? result.loras ?? [];
  }

  /**
   * Generate images with dynamic LoRA configuration
   */
  async generateImage(params: {
    instanceId?: string;
    loras: Array<{
      enabled: boolean;
      loraName: string;
      strengthModel: number;
      strengthClip: number;
    }>;
    positivePrompt: string;
    negativePrompt: string;
    seed: number;
    batchSize?: number;
    outputPath?: string;
  }): Promise<{ prompt_id: string; images: Array<{ filename: string; subfolder: string; type: string }>; savedPaths?: string[] }> {
    const response = await fetch(`${this.baseUrl}/api/image-gen/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const result: ApiResponse<{
      prompt_id: string;
      images: Array<{ filename: string; subfolder: string; type: string }>;
      savedPaths?: string[];
    }> = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to generate image');
    }
    return result.data!;
  }

  /**
   * Get image URL from image-gen endpoint (supports multi-instance)
   */
  getImageGenUrl(filename: string, subfolder: string = '', type: string = 'output', instanceId?: string): string {
    const params = new URLSearchParams({ filename, subfolder, type });
    if (instanceId) params.set('instanceId', instanceId);
    return `${this.baseUrl}/api/image-gen/view?${params}`;
  }

  /**
   * Get available ComfyUI instances
   */
  async getComfyInstances(): Promise<ComfyInstanceInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/comfy-instances`);
    const result = await response.json();
    if (!result.success) {
      throw new Error('Failed to get ComfyUI instances');
    }
    return result.instances || [];
  }

  /**
   * Dynamically add a new ComfyUI instance
   */
  async addInstance(url: string, name?: string): Promise<ComfyInstanceInfo> {
    const response = await fetch(`${this.baseUrl}/api/comfy-instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to add instance');
    }
    return result.instance;
  }

  /**
   * Remove a ComfyUI instance
   */
  async removeInstance(instanceId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/comfy-instances/${instanceId}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to remove instance');
    }
  }

  /**
   * 이미지 업로드
   * @param file - 업로드할 이미지 파일
   * @param subfolder - 서브폴더 (선택사항)
   * @param type - 타입 (기본값: 'input')
   * @param overwrite - 덮어쓰기 여부 (기본값: true)
   */
  async uploadImage(
    file: File,
    subfolder: string = '',
    type: string = 'input',
    overwrite: boolean = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData();
    formData.append('image', file);
    
    if (subfolder) {
      formData.append('subfolder', subfolder);
    }
    
    formData.append('type', type);
    formData.append('overwrite', overwrite.toString());

    const response = await fetch(`${this.baseUrl}/api/upload/image`, {
      method: 'POST',
      body: formData,
    });

    const result: ApiResponse<{ name: string; subfolder: string; type: string }> = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to upload image');
    }

    return result.data!;
  }
}

// Export singleton instance
export const comfyClient = new ComfyClient();

// Export class for custom instances
export default ComfyClient;
