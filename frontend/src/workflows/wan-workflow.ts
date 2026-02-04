/**
 * WAN 2.2 Workflow
 * 애니메이션 생성을 위한 고급 워크플로우
 */

import type { ComfyWorkflow } from '../api/comfy-client';
import wanWorkflowBase from './wan-2.2.json';

/**
 * WAN 2.2 워크플로우를 생성하고 프롬프트를 커스터마이즈합니다
 * 
 * @param positivePrompt - 원하는 이미지/비디오 설명
 * @param negativePrompt - 제외할 요소 (선택사항)
 * @param image260 - 노드 260에 사용할 이미지 파일명 (선택사항)
 * @param image881 - 노드 881에 사용할 이미지 파일명 (선택사항)
 * @param seed - 시드 값 (선택사항)
 * @returns 실행 가능한 ComfyUI 워크플로우
 */
export function createWanWorkflow(
  positivePrompt: string,
  negativePrompt?: string,
  image260?: string,
  image881?: string,
  seed?: number
): ComfyWorkflow {
  const workflow = { ...wanWorkflowBase } as ComfyWorkflow;

  // Positive prompt 업데이트 (노드 829)
  if (workflow['829']) {
    workflow['829'] = {
      ...workflow['829'],
      inputs: {
        ...workflow['829'].inputs,
        text: positivePrompt
      }
    };
  }

  // Negative prompt 업데이트 (노드 830) - 제공된 경우만
  if (negativePrompt && workflow['830']) {
    workflow['830'] = {
      ...workflow['830'],
      inputs: {
        ...workflow['830'].inputs,
        text: negativePrompt
      }
    };
  }

  // 이미지 260 업데이트 - 제공된 경우만
  if (image260 && workflow['260']) {
    workflow['260'] = {
      ...workflow['260'],
      inputs: {
        ...workflow['260'].inputs,
        image: image260
      }
    };
  }

  // 이미지 881 업데이트 - 제공된 경우만
  if (image881 && workflow['881']) {
    workflow['881'] = {
      ...workflow['881'],
      inputs: {
        ...workflow['881'].inputs,
        image: image881
      }
    };
  }

  // 시드 업데이트 (노드 926) - 제공된 경우만
  if (seed !== undefined && workflow['926']) {
    workflow['926'] = {
      ...workflow['926'],
      inputs: {
        ...workflow['926'].inputs,
        seed: seed
      }
    };
  }

  return workflow;
}

/**
 * 기본 WAN 워크플로우를 반환합니다
 */
export function getBaseWanWorkflow(): ComfyWorkflow {
  return { ...wanWorkflowBase } as ComfyWorkflow;
}

/**
 * 기본 negative prompt
 */
export const DEFAULT_WAN_NEGATIVE_PROMPT = 
  "Avoid incomplete turning, partial turn, or stopping mid-turn. No turning too fast or too slow - should be smooth and natural. " +
  "No jerky, mechanical, or robotic turning motion. No turning in the wrong direction or inconsistent turning. " +
  "No head turning without body movement or body turning without head movement. No standing up, lying down, or different pose - must remain sitting. " +
  "No excessive head movement, dramatic head turning, or violent head shaking during the turn. No body completely frozen, stiff body, or rigid torso. " +
  "No eye size changing, eyes getting bigger or smaller, or inconsistent eye shape. No eyes staying closed or eyes never blinking. " +
  "No looking away from viewer completely or avoiding eye contact. No facial expression morphing, face distortion, or changing facial features. " +
  "No angry, sad, crying, or negative expression. No expressionless face, blank stare, or emotionless look. " +
  "No mouth staying completely still, closed, or frozen during speech. No hands moving excessively or wild hand gestures during the turn. " +
  "No camera movement, moving camera, camera panning, camera rotation, camera zooming in or out, camera shake, camera wobble, " +
  "dynamic camera, handheld camera effect, unstable camera, camera drift, camera shift, camera angle changing, camera tilting, dolly zoom. " +
  "No background moving, moving background, background shift, background panning, background rotation, background zooming, " +
  "environment moving, scenery moving, scenery shifting, dynamic background, animated background, background drift.";

/**
 * 기본 positive prompt 템플릿
 */
export const DEFAULT_WAN_POSITIVE_PROMPT =
  "A beautiful teenage anime girl in jirai kei fashion with black eyes, blunt bangs, black twintails, black hair ribbon, " +
  "black ear piercing, black earrings, nail polish, medium breasts, standing in a natural, relaxed posture. " +
  "She begins by facing the viewer with a gentle, friendly expression and maintains eye contact. " +
  "She then smoothly turns her body to the right, rotating her torso and shoulders in a natural, fluid motion. " +
  "As she turns, her hair flows gracefully with the movement, creating a beautiful cascading effect. " +
  "The animation is high quality with smooth, fluid motion and realistic movement following natural physics.";
