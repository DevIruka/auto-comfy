import { Router, Request, Response } from "express";
import { comfyManager } from "../services/comfy-manager.service.js";
import { instanceQueueManager } from "../services/instance-queue-manager.service.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  parseSshCommand,
  sshTunnelService,
} from "../services/ssh-tunnel.service.js";
import { loraDownloadService } from "../services/lora-download.service.js";

const comfyInstancesRouter = Router();

/**
 * GET /api/comfy-instances
 * Get all available ComfyUI instances
 */
comfyInstancesRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const instances = comfyManager.getAllInstances();

    res.json({
      success: true,
      instances,
      count: instances.length,
    });
  })
);

/**
 * GET /api/comfy-instances/dashboard
 * Returns all instances + their queue status (running/pending jobs)
 */
comfyInstancesRouter.get(
  "/dashboard",
  asyncHandler(async (_req: Request, res: Response) => {
    const instances = comfyManager.getAllInstances();
    const queueStatus = instanceQueueManager.getAllStatus();

    const dashboard = instances.map((inst) => {
      const status = queueStatus[inst.id] ?? { running: null, pending: [] };
      return {
        ...inst,
        running: status.running
          ? {
              entryId: status.running.entryId,
              jobId: status.running.jobId,
              serviceType: status.running.serviceType,
              label: status.running.label,
              createdAt: status.running.createdAt,
            }
          : null,
        pending: status.pending.map((e) => ({
          entryId: e.entryId,
          jobId: e.jobId,
          serviceType: e.serviceType,
          label: e.label,
          createdAt: e.createdAt,
        })),
      };
    });

    res.json({ success: true, dashboard });
  })
);

/**
 * POST /api/comfy-instances/dashboard/cancel/:entryId
 * Cancel a pending queue entry by entryId
 */
comfyInstancesRouter.post(
  "/dashboard/cancel/:entryId",
  asyncHandler(async (req: Request, res: Response) => {
    const { entryId } = req.params;
    const removed = instanceQueueManager.cancel(entryId);
    if (!removed) {
      return res.status(404).json({ success: false, error: "Entry not found or already running" });
    }
    res.json({ success: true });
  })
);

/**
 * POST /api/comfy-instances/dashboard/stop
 * Stop a running job by serviceType + jobId (delegates to the correct service)
 */
comfyInstancesRouter.post(
  "/dashboard/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const { serviceType, jobId } = req.body as { serviceType?: string; jobId?: string };
    if (!serviceType || !jobId) {
      return res.status(400).json({ success: false, error: "serviceType and jobId are required" });
    }

    let stopped = false;
    switch (serviceType) {
      case "image-batch": {
        const { imageBatchService } = await import("../services/image-batch.service.js");
        imageBatchService.stopJob(jobId);
        stopped = true;
        break;
      }
      case "banner-batch": {
        const { bannerBatchService } = await import("../services/banner-batch.service.js");
        bannerBatchService.stopJob(jobId);
        stopped = true;
        break;
      }
      case "anchor-image": {
        const { anchorImageService } = await import("../services/anchor-image.service.js");
        anchorImageService.stopJob(jobId);
        stopped = true;
        break;
      }
      case "batch": {
        const { batchService } = await import("../services/batch.service.js");
        await batchService.stopBatch(jobId);
        stopped = true;
        break;
      }
      case "emotion-batch": {
        const { emotionBatchService } = await import("../services/emotion-batch.service.js");
        emotionBatchService.stopBatch(jobId);
        stopped = true;
        break;
      }
      case "emotion-pipeline": {
        const { stopEmotionPipelineJob } = await import("../services/emotion-pipeline.service.js");
        stopped = stopEmotionPipelineJob(jobId);
        break;
      }
      case "runpod-stop": {
        const { runPodStopService } = await import("../services/runpod-stop.service.js");
        runPodStopService.stopJob(jobId);
        stopped = true;
        break;
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown serviceType: ${serviceType}` });
    }

    res.json({ success: true, stopped });
  })
);

/**
 * POST /api/comfy-instances
 * Dynamically add a new ComfyUI instance at runtime
 */
comfyInstancesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { url, name, remotePorts } = req.body as {
      url?: string;
      name?: string;
      remotePorts?: string;
    };
    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, error: "url is required" });
    }

    const input = url.trim();
    const parsedSsh = parseSshCommand(input);

    // Proxy / direct URL path (existing behavior).
    if (!parsedSsh) {
      const instance = comfyManager.addInstance(input, name?.trim());
      return res.json({ success: true, instance, instances: [instance] });
    }

    // SSH tunnel path.
    const ports = parseRemotePorts(remotePorts);
    const created: unknown[] = [];
    const openedLocalPorts: number[] = [];

    try {
      for (let i = 0; i < ports.length; i++) {
        const remotePort = ports[i];
        const tunnel = await sshTunnelService.startTunnel({
          user: parsedSsh.user,
          host: parsedSsh.host,
          sshPort: parsedSsh.sshPort,
          identityFile: parsedSsh.identityFile,
          remotePort,
        });
        openedLocalPorts.push(tunnel.localPort);

        const healthy = await sshTunnelService.verifyComfy(tunnel.localPort);
        if (!healthy) {
          throw new Error(
            `SSH 터널은 열렸지만 ComfyUI(127.0.0.1:${tunnel.localPort} → 원격 ${remotePort})에 연결되지 않습니다. Pod에서 ComfyUI가 해당 포트로 실행 중인지 확인하세요.`,
          );
        }

        const baseName = name?.trim() || `RunPod SSH ${parsedSsh.host}`;
        const displayName =
          ports.length > 1 ? `${baseName} :${remotePort}` : baseName;

        const instance = comfyManager.addInstance(
          `http://127.0.0.1:${tunnel.localPort}`,
          displayName,
          {
            connectionType: "ssh-tunnel",
            podId: tunnel.podId,
            sshTarget: tunnel.sshTarget,
            remotePort: String(remotePort),
          },
        );
        sshTunnelService.bindInstance(instance.id, tunnel.localPort);
        created.push(instance);
      }
    } catch (err) {
      // Roll back any tunnels opened in this request.
      for (const lp of openedLocalPorts) sshTunnelService.stopTunnel(lp);
      return res.status(502).json({
        success: false,
        error: err instanceof Error ? err.message : "SSH 터널 생성 실패",
      });
    }

    res.json({
      success: true,
      instance: created[0],
      instances: created,
    });
  })
);

/** Parse "8188" | "8188,8189" | undefined into a list of ports (default [8188]). */
function parseRemotePorts(raw?: string): number[] {
  if (!raw || !raw.trim()) return [8188];
  const ports = raw
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
  return ports.length > 0 ? Array.from(new Set(ports)) : [8188];
}

/**
 * POST /api/comfy-instances/:id/loras/download
 * Download a CivitAI LoRA onto the SSH-backed instance.
 */
comfyInstancesRouter.post(
  "/:id/loras/download",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { url } = req.body as { url?: string };

    if (!comfyManager.hasInstance(id)) {
      return res
        .status(404)
        .json({ success: false, error: `Instance '${id}' not found` });
    }

    try {
      const result = await loraDownloadService.downloadToInstance(id, url ?? "");
      res.json({ success: true, ...result });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "로라 다운로드 실패";
      const status =
        message.includes("CIVITAI_API_KEY") ||
        message.includes("필요합니다") ||
        message.includes("인식할 수 없") ||
        message.includes("올바른 URL") ||
        message.includes("CivitAI 링크만") ||
        message.includes("SSH로 등록")
          ? 400
          : 502;
      res.status(status).json({ success: false, error: message });
    }
  }),
);

/**
 * DELETE /api/comfy-instances/:id
 * Remove a ComfyUI instance
 */
comfyInstancesRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!comfyManager.hasInstance(id)) {
      return res.status(404).json({ success: false, error: `Instance '${id}' not found` });
    }
    // Tear down the SSH tunnel first if this instance is tunnel-backed.
    if (sshTunnelService.isTunnelInstance(id)) {
      sshTunnelService.stopByInstance(id);
    }
    comfyManager.removeInstance(id);
    res.json({ success: true });
  })
);

export default comfyInstancesRouter;
