export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    details?: any;
    stack?: string;
  };
}

export interface ComfyNode {
  inputs: Record<string, any>;
  class_type: string;
  _meta?: {
    title?: string;
  };
}

export interface ComfyWorkflow {
  [nodeId: string]: ComfyNode;
}

export interface QueuePromptRequest {
  workflow: ComfyWorkflow;
}

export interface QueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, any>;
}

export interface ImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

export interface NodeOutput {
  images?: ImageOutput[];
  [key: string]: any;
}

export interface WorkflowOutput {
  [nodeId: string]: NodeOutput;
}

export interface ExecutionResult {
  prompt_id: string;
  outputs: WorkflowOutput;
}

export interface QueueStatus {
  queue_running: Array<[number, string, any]>;
  queue_pending: Array<[number, string, any]>;
}

export interface HistoryItem {
  outputs: WorkflowOutput;
  status: {
    status_str: string;
    completed: boolean;
    messages?: any[];
  };
  prompt: [number, string, ComfyWorkflow, any];
}

export interface WebSocketMessage {
  type: 'status' | 'progress' | 'executing' | 'executed' | 'execution_error' | 'execution_cached';
  data: any;
}
