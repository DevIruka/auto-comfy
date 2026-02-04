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
  text: string,
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
  seed?: number,
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
 * Update seed for randomization
 * @param workflow - The ComfyUI workflow object
 * @param nodeId - The node ID containing the seed (e.g., "3" for KSampler)
 * @param seed - The new seed value (use -1 for random)
 */
export function updateSeed(
  workflow: ComfyWorkflow,
  nodeId: string,
  seed: number,
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
  updates: Record<string, Record<string, any>>,
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
  baseUrl: string = "",
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
