import { ComfyWorkflow } from "../types/index.js";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Update a text prompt in a workflow
 * @param workflow - The ComfyUI workflow object
 * @param nodeId - The node ID containing the text prompt (e.g., "6" for CLIPTextEncode)
 * @param text - The new text prompt
 */
export function updateTextPrompt(
  workflow: ComfyWorkflow,
  nodeId: string,
  text: string
): ComfyWorkflow {
  if (!workflow[nodeId]) {
    throw new Error(`Node ${nodeId} not found in workflow`);
  }

  return {
    ...workflow,
    [nodeId]: {
      ...workflow[nodeId],
      inputs: {
        ...workflow[nodeId].inputs,
        text,
      },
    },
  };
}

/**
 * Create WAN 2.2 workflow with custom parameters
 */
export function createWanWorkflow(
  positivePrompt: string,
  negativePrompt?: string,
  image260?: string,
  image881?: string,
  seed?: number
): ComfyWorkflow {
  // Load base workflow
  const workflowPath = join(process.cwd(), "src", "workflows", "wan-2.2.json");
  const wanWorkflowBase = JSON.parse(readFileSync(workflowPath, "utf-8"));

  const workflow = { ...wanWorkflowBase } as ComfyWorkflow;

  // Positive prompt 업데이트 (노드 829)
  if (workflow["829"]) {
    workflow["829"] = {
      ...workflow["829"],
      inputs: {
        ...workflow["829"].inputs,
        text: positivePrompt,
      },
    };
  }

  // Negative prompt 업데이트 (노드 830) - 제공된 경우만
  if (negativePrompt && workflow["830"]) {
    workflow["830"] = {
      ...workflow["830"],
      inputs: {
        ...workflow["830"].inputs,
        text: negativePrompt,
      },
    };
  }

  // 이미지 260 업데이트 - 제공된 경우만
  if (image260 && workflow["260"]) {
    workflow["260"] = {
      ...workflow["260"],
      inputs: {
        ...workflow["260"].inputs,
        image: image260,
      },
    };
  }

  // 이미지 881 업데이트 - 제공된 경우만
  if (image881 && workflow["881"]) {
    workflow["881"] = {
      ...workflow["881"],
      inputs: {
        ...workflow["881"].inputs,
        image: image881,
      },
    };
  }

  // 시드 업데이트 (노드 926) - 제공된 경우만
  if (seed !== undefined && workflow["926"]) {
    workflow["926"] = {
      ...workflow["926"],
      inputs: {
        ...workflow["926"].inputs,
        seed: seed,
      },
    };
  }

  return workflow;
}

/**
 * Create Emotion WAN 2.2 workflow with custom parameters
 * Uses separate workflow file for emotion-based videos
 */
export function createEmotionWorkflow(
  positivePrompt: string,
  negativePrompt?: string,
  image260?: string,
  image881?: string,
  seed?: number
): ComfyWorkflow {
  // Load emotion-specific workflow
  const workflowPath = join(
    process.cwd(),
    "src",
    "workflows",
    "wan-2.2-emotion.json"
  );
  const emotionWorkflowBase = JSON.parse(readFileSync(workflowPath, "utf-8"));

  const workflow = { ...emotionWorkflowBase } as ComfyWorkflow;

  // Positive prompt 업데이트 (노드 829)
  if (workflow["829"]) {
    workflow["829"] = {
      ...workflow["829"],
      inputs: {
        ...workflow["829"].inputs,
        text: positivePrompt,
      },
    };
  }

  // Negative prompt 업데이트 (노드 830) - 제공된 경우만
  if (negativePrompt && workflow["830"]) {
    workflow["830"] = {
      ...workflow["830"],
      inputs: {
        ...workflow["830"].inputs,
        text: negativePrompt,
      },
    };
  }

  // 이미지 260 업데이트 - 제공된 경우만
  if (image260 && workflow["260"]) {
    workflow["260"] = {
      ...workflow["260"],
      inputs: {
        ...workflow["260"].inputs,
        image: image260,
      },
    };
  }

  // 이미지 881 업데이트 - 제공된 경우만
  if (image881 && workflow["881"]) {
    workflow["881"] = {
      ...workflow["881"],
      inputs: {
        ...workflow["881"].inputs,
        image: image881,
      },
    };
  }

  // 시드 업데이트 (노드 926) - 제공된 경우만
  if (seed !== undefined && workflow["926"]) {
    workflow["926"] = {
      ...workflow["926"],
      inputs: {
        ...workflow["926"].inputs,
        seed: seed,
      },
    };
  }

  return workflow;
}

/**
 * LoRA slot configuration for image generation
 */
export interface LoraSlotConfig {
  enabled: boolean;
  loraName: string;
  strengthModel: number;
  strengthClip: number;
}

/**
 * Create image generation workflow with dynamic LoRA chain
 * Based on the cunny funky workflow with nodes 175, 188, 189, 193
 */
export function createImageGenWorkflow(options: {
  loras: LoraSlotConfig[];
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  batchSize?: number;
}): ComfyWorkflow {
  const workflowPath = join(process.cwd(), "src", "workflows", "image-gen.json");
  const baseWorkflow = JSON.parse(readFileSync(workflowPath, "utf-8"));
  const workflow = { ...baseWorkflow } as ComfyWorkflow;

  const LORA_NODE_IDS = ["175", "188", "189", "193"];
  const CHECKPOINT_NODE = "4";
  const ORIGINAL_LAST_LORA = "193";

  let previousNode = CHECKPOINT_NODE;

  for (let i = 0; i < LORA_NODE_IDS.length; i++) {
    const nodeId = LORA_NODE_IDS[i];
    const config = options.loras[i];

    if (config && config.enabled && config.loraName) {
      workflow[nodeId] = {
        ...workflow[nodeId],
        inputs: {
          ...workflow[nodeId].inputs,
          lora_name: config.loraName,
          strength_model: config.strengthModel,
          strength_clip: config.strengthClip,
          model: [previousNode, 0],
          clip: [previousNode, 1],
        },
      };
      previousNode = nodeId;
    } else {
      delete workflow[nodeId];
    }
  }

  // Rewire all nodes that referenced the original last LoRA node
  if (previousNode !== ORIGINAL_LAST_LORA) {
    for (const [, node] of Object.entries(workflow)) {
      const inputs = node.inputs;
      if (!inputs) continue;
      for (const [key, value] of Object.entries(inputs)) {
        if (
          Array.isArray(value) &&
          value[0] === ORIGINAL_LAST_LORA
        ) {
          inputs[key] = [previousNode, value[1]];
        }
      }
    }
  }

  // Set positive prompt (node 165)
  if (workflow["165"]) {
    workflow["165"] = {
      ...workflow["165"],
      inputs: {
        ...workflow["165"].inputs,
        text: options.positivePrompt,
      },
    };
  }

  // Set negative prompt (node 153)
  if (workflow["153"]) {
    workflow["153"] = {
      ...workflow["153"],
      inputs: {
        ...workflow["153"].inputs,
        text: options.negativePrompt,
      },
    };
  }

  // Set seed (node 202)
  if (workflow["202"]) {
    workflow["202"] = {
      ...workflow["202"],
      inputs: {
        ...workflow["202"].inputs,
        seed: options.seed,
      },
    };
  }

  // Set batch size (node 23)
  if (options.batchSize && workflow["23"]) {
    workflow["23"] = {
      ...workflow["23"],
      inputs: {
        ...workflow["23"].inputs,
        batch_size: options.batchSize,
      },
    };
  }

  return workflow;
}

/**
 * Update seed for randomization
 * @param workflow - The ComfyUI workflow object
 * @param nodeId - The node ID containing the seed (e.g., "3" for KSampler)
 * @param seed - The new seed value (use -1 for random)
 */
export function updateSeed(
  workflow: ComfyWorkflow,
  nodeId: string,
  seed: number
): ComfyWorkflow {
  if (!workflow[nodeId]) {
    throw new Error(`Node ${nodeId} not found in workflow`);
  }

  return {
    ...workflow,
    [nodeId]: {
      ...workflow[nodeId],
      inputs: {
        ...workflow[nodeId].inputs,
        seed,
      },
    },
  };
}

/**
 * Update multiple node inputs at once
 * @param workflow - The ComfyUI workflow object
 * @param updates - Object mapping node IDs to their input updates
 */
export function updateMultipleNodes(
  workflow: ComfyWorkflow,
  updates: Record<string, Record<string, any>>
): ComfyWorkflow {
  const updatedWorkflow = { ...workflow };

  for (const [nodeId, inputs] of Object.entries(updates)) {
    if (!updatedWorkflow[nodeId]) {
      throw new Error(`Node ${nodeId} not found in workflow`);
    }

    updatedWorkflow[nodeId] = {
      ...updatedWorkflow[nodeId],
      inputs: {
        ...updatedWorkflow[nodeId].inputs,
        ...inputs,
      },
    };
  }

  return updatedWorkflow;
}

/**
 * Generate a random seed
 */
export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 1000000000000000);
}

/**
 * Extract image URLs from execution result
 * @param outputs - The outputs from workflow execution
 * @param baseUrl - The base URL of the backend API
 */
export function extractImageUrls(
  outputs: Record<string, any>,
  baseUrl: string = ""
): string[] {
  const imageUrls: string[] = [];

  for (const nodeOutput of Object.values(outputs)) {
    if (nodeOutput.images && Array.isArray(nodeOutput.images)) {
      for (const image of nodeOutput.images) {
        const params = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder || "",
          type: image.type || "output",
        });
        imageUrls.push(`${baseUrl}/api/comfy/image?${params}`);
      }
    }
  }

  return imageUrls;
}
