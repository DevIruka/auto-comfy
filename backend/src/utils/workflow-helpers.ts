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
  width?: number;
  height?: number;
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

  // Set batch size and optional width/height (node 23 EmptyLatentImage)
  if (workflow["23"]) {
    const inputs23 = { ...workflow["23"].inputs };
    if (options.batchSize != null) inputs23.batch_size = options.batchSize;
    if (options.width != null) inputs23.width = options.width;
    if (options.height != null) inputs23.height = options.height;
    workflow["23"] = {
      ...workflow["23"],
      inputs: inputs23,
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

/** SDXL WAI prompt blocks: 구도(pose), 배경(background), and optional negative extra (배경/기타 수정) */
export interface SdxlWaiPromptBlocks {
  styleTrigger: string;
  character: string;
  pose: string;
  emotion: string;
  background: string;
  /** Negative 보조: 배경 및 자잘한 걸 고치기 위한 프롬프트 (고정 negative 뒤에 붙음) */
  negativeExtra?: string;
}

/** LoRA slot for SDXL WAI (node 1289): up to 9 slots, toggle + name + weights */
export interface SdxlWaiLoraSlot {
  enabled: boolean;
  loraName: string;
  modelStr?: number;
  clipStr?: number;
}

/** 접두 고정: 아티스트 태그 (항상 포함) */
const DEFAULT_FIXED_PREFIX =
  "(artist:tianliang duohe fangdongye:0.9), artist:ciloranko, artist:noyu, noyu23386566,ningen mame, (artist:sho:0.8264462809917354), (sho lwlw:0.9090909090909091),(artist:kedama_milk:0.5),(bee_\\(deadflow\\):0.7),artist:dino,(artist:fkey:0.8),(artist:wlop:1),year 2023,";
const DEFAULT_FIXED_SUFFIX =
  "depth of field,dynamic lighting,light particle, best quality, very aesthetic, highres, absurdres";

/** Negative 고정 (항상 포함). 그 뒤에 negativeExtra가 붙음 */
const DEFAULT_FIXED_NEGATIVE =
  "censored,censor,censor bar,negative_hand, NegfeetV2, bad anatomy,blurry,(worst quality:1.8),low quality,hands bad,face bad,(normal quality:1.3),bad hands,[extra fingers],mutated hands and fingers,extra legs,extra arms,duplicate,cropped,text,jpeg,artifacts,signature,watermark,username,blurry,artist name,trademark,title,multiple view,Reference sheet,long body,multiple breasts,mutated,bad anatomy,disfigured,bad proportions,duplicate,bad feet,artist name,ugly,text font ui,missing limb,monochrome,";

/**
 * Build SDXL WAI positive prompt (text_b) from blocks. Order: style fixed, then //프롬프트// = character, pose, emotion, background, then fixed suffix.
 */
function buildSdxlWaiTextB(blocks: SdxlWaiPromptBlocks): string {
  const promptMiddle = [blocks.character, blocks.pose, blocks.emotion, blocks.background]
    .filter(Boolean)
    .join("\n\n");
  return `//고정//\n${DEFAULT_FIXED_PREFIX}\n//선택//\n\n//프롬프트//\n\n${promptMiddle}\n\n//선택//\n\n//고정//\n${DEFAULT_FIXED_SUFFIX}`;
}

/**
 * Create SDXL WAI workflow for inpaint or upscale.
 * IMPORTANT: Call only with imageFilename that was just returned from uploadImage() on the same ComfyUI instance. Do not use arbitrary or stale filenames to avoid "image not found" errors.
 */
export function createSdxlWaiWorkflow(options: {
  /** Filename of the image on ComfyUI (must be uploaded to the target instance first) */
  imageFilename: string;
  seed: number;
  promptBlocks: SdxlWaiPromptBlocks;
  loraSlots?: SdxlWaiLoraSlot[];
  /** Inpaint: "🚫 Do not upscale". Upscale: e.g. "2x" or other Load Image 💬ED upscale_method value */
  upscaleMethod?: string;
  /** If set, patch 1291 image_width/image_height to match uploaded image (avoids Efficient Loader vae_decode path bugs) */
  imageWidth?: number;
  imageHeight?: number;
}): ComfyWorkflow {
  const workflowPath = join(process.cwd(), "src", "workflows", "sdxl-wai.json");
  const base = JSON.parse(readFileSync(workflowPath, "utf-8")) as ComfyWorkflow;
  const workflow = JSON.parse(JSON.stringify(base)) as ComfyWorkflow;

  const { imageFilename, seed, promptBlocks, loraSlots, upscaleMethod, imageWidth, imageHeight } = options;

  if (!imageFilename || typeof imageFilename !== "string") {
    throw new Error("SDXL WAI workflow requires imageFilename (use the name returned after uploading the image)");
  }

  // 1176 Load Image 💬ED — always "Do not upscale"; 2x upscale is done by node 320 (toggle path) in the full workflow
  if (workflow["1176"]) {
    workflow["1176"] = {
      ...workflow["1176"],
      inputs: {
        ...workflow["1176"].inputs,
        image: imageFilename,
      },
    };
  }

  // 1291 Efficient Loader (seed + optional image dimensions to match uploaded image and avoid vae_decode path bugs)
  if (workflow["1291"]) {
    const inputs1291: Record<string, unknown> = { ...workflow["1291"].inputs, seed };
    if (typeof imageWidth === "number" && imageWidth > 0) inputs1291.image_width = imageWidth;
    if (typeof imageHeight === "number" && imageHeight > 0) inputs1291.image_height = imageHeight;
    workflow["1291"] = {
      ...workflow["1291"],
      inputs: inputs1291,
    };
  }
  // 1298 KSampler (Efficient) seed
  if (workflow["1298"]) {
    workflow["1298"] = {
      ...workflow["1298"],
      inputs: { ...workflow["1298"].inputs, seed },
    };
  }

  // 1294 Simple Text A (고정: 아티스트 접두는 text_b 쪽에서 처리, 여기는 기본 품질 문구만)
  if (workflow["1294"]) {
    workflow["1294"] = {
      ...workflow["1294"],
      inputs: { ...workflow["1294"].inputs, text: "masterpiece, best quality, detailed eyes" },
    };
  }
  // 1295 Get Booru Tag (full prompt body)
  if (workflow["1295"]) {
    workflow["1295"] = {
      ...workflow["1295"],
      inputs: {
        ...workflow["1295"].inputs,
        text_b: buildSdxlWaiTextB(promptBlocks),
      },
    };
  }
  // 1296 Simple Text C (suffix, usually empty)
  if (workflow["1296"]) {
    workflow["1296"] = {
      ...workflow["1296"],
      inputs: { ...workflow["1296"].inputs, text: "" },
    };
  }

  // 1285 Simple Text (Negative): 고정 negative + negativeExtra
  if (workflow["1285"]) {
    const negativeExtra = (promptBlocks as { negativeExtra?: string }).negativeExtra?.trim() ?? "";
    const negativeText = negativeExtra ? `${DEFAULT_FIXED_NEGATIVE}\n${negativeExtra}` : DEFAULT_FIXED_NEGATIVE;
    workflow["1285"] = {
      ...workflow["1285"],
      inputs: { ...workflow["1285"].inputs, text: negativeText },
    };
  }

  // 1289 LoRA Stacker (optional)
  if (loraSlots && loraSlots.length > 0 && workflow["1289"]) {
    const inputs: Record<string, any> = { ...workflow["1289"].inputs };
    for (let i = 1; i <= 9; i++) {
      const slot = loraSlots[i - 1];
      const key = `lora_name_${i}` as keyof typeof inputs;
      if (slot?.enabled && slot.loraName) {
        inputs[key] = slot.loraName;
        if (slot.modelStr !== undefined) inputs[`model_str_${i}`] = slot.modelStr;
        if (slot.clipStr !== undefined) inputs[`clip_str_${i}`] = slot.clipStr;
        inputs[`lora_name_${i}_toggle`] = true;
      } else {
        inputs[key] = "None";
        inputs[`lora_name_${i}_toggle`] = i <= 3 ? i === 1 : true;
      }
    }
    workflow["1289"] = { ...workflow["1289"], inputs };
  }

  return workflow;
}

/** Save node ID in the Hires Fix workflow (output from Ultimate SD Upscale → Save). */
export const HIRES_SAVE_NODE_ID = "1046";

/**
 * Create SDXL WAI Hires Fix workflow (2x upscale via FaceDetailer → Ultimate SD Upscale).
 * Use for the upscale step after inpaint. Same image/prompt/LoRA patching as inpaint; seeds for 1291, 1288, 1280.
 */
export function createSdxlWaiHiresWorkflow(options: {
  imageFilename: string;
  seed: number;
  promptBlocks: SdxlWaiPromptBlocks;
  loraSlots?: SdxlWaiLoraSlot[];
  imageWidth?: number;
  imageHeight?: number;
}): ComfyWorkflow {
  const workflowPath = join(process.cwd(), "src", "workflows", "sdxl-wai-hires.json");
  const base = JSON.parse(readFileSync(workflowPath, "utf-8")) as ComfyWorkflow;
  const workflow = JSON.parse(JSON.stringify(base)) as ComfyWorkflow;

  const { imageFilename, seed, promptBlocks, loraSlots, imageWidth, imageHeight } = options;

  if (!imageFilename || typeof imageFilename !== "string") {
    throw new Error("SDXL WAI Hires workflow requires imageFilename (use the name returned after uploading the image)");
  }

  if (workflow["1176"]) {
    workflow["1176"] = {
      ...workflow["1176"],
      inputs: { ...workflow["1176"].inputs, image: imageFilename },
    };
  }

  if (workflow["1291"]) {
    const inputs1291: Record<string, unknown> = { ...workflow["1291"].inputs, seed };
    if (typeof imageWidth === "number" && imageWidth > 0) inputs1291.image_width = imageWidth;
    if (typeof imageHeight === "number" && imageHeight > 0) inputs1291.image_height = imageHeight;
    workflow["1291"] = { ...workflow["1291"], inputs: inputs1291 };
  }

  if (workflow["1288"]) {
    workflow["1288"] = {
      ...workflow["1288"],
      inputs: { ...workflow["1288"].inputs, seed },
    };
  }

  if (workflow["1280"]) {
    workflow["1280"] = {
      ...workflow["1280"],
      inputs: { ...workflow["1280"].inputs, seed },
    };
  }

  if (workflow["1294"]) {
    workflow["1294"] = {
      ...workflow["1294"],
      inputs: { ...workflow["1294"].inputs, text: "masterpiece, best quality, detailed eyes" },
    };
  }
  if (workflow["1295"]) {
    workflow["1295"] = {
      ...workflow["1295"],
      inputs: { ...workflow["1295"].inputs, text_b: buildSdxlWaiTextB(promptBlocks) },
    };
  }
  if (workflow["1296"]) {
    workflow["1296"] = {
      ...workflow["1296"],
      inputs: { ...workflow["1296"].inputs, text: "" },
    };
  }
  if (workflow["1285"]) {
    const negativeExtra = (promptBlocks as { negativeExtra?: string }).negativeExtra?.trim() ?? "";
    const negativeText = negativeExtra ? `${DEFAULT_FIXED_NEGATIVE}\n${negativeExtra}` : DEFAULT_FIXED_NEGATIVE;
    workflow["1285"] = {
      ...workflow["1285"],
      inputs: { ...workflow["1285"].inputs, text: negativeText },
    };
  }
  if (loraSlots && loraSlots.length > 0 && workflow["1289"]) {
    const inputs: Record<string, unknown> = { ...workflow["1289"].inputs };
    for (let i = 1; i <= 9; i++) {
      const slot = loraSlots[i - 1];
      const key = `lora_name_${i}`;
      if (slot?.enabled && slot.loraName) {
        (inputs as Record<string, unknown>)[key] = slot.loraName;
        if (slot.modelStr !== undefined) (inputs as Record<string, unknown>)[`model_str_${i}`] = slot.modelStr;
        if (slot.clipStr !== undefined) (inputs as Record<string, unknown>)[`clip_str_${i}`] = slot.clipStr;
        (inputs as Record<string, unknown>)[`lora_name_${i}_toggle`] = true;
      } else {
        (inputs as Record<string, unknown>)[key] = "None";
        (inputs as Record<string, unknown>)[`lora_name_${i}_toggle`] = i <= 3 ? i === 1 : true;
      }
    }
    workflow["1289"] = { ...workflow["1289"], inputs };
  }

  return workflow;
}
