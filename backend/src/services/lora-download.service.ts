import { sshTunnelService } from "./ssh-tunnel.service.js";

const LORA_DIR = "/workspace/ComfyUI/models/loras";
const CIVITAI_API = "https://civitai.com/api/v1";
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

const ALLOWED_HOSTS = new Set(["civitai.com", "civitai.red"]);

interface ParsedCivitaiLink {
  modelId?: string;
  versionId?: string;
  fileId?: string;
  downloadOrigin?: string;
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function parseCivitaiUrl(raw: string): ParsedCivitaiLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("올바른 URL이 아닙니다.");
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error("CivitAI 링크만 사용할 수 있습니다. (civitai.com, civitai.red)");
  }

  const fileId = url.searchParams.get("fileId") ?? undefined;
  const downloadMatch = url.pathname.match(/\/api\/download\/models\/(\d+)/);
  if (downloadMatch) {
    return {
      versionId: downloadMatch[1],
      fileId,
      downloadOrigin: url.origin,
    };
  }

  const modelMatch = url.pathname.match(/\/models\/(\d+)/);
  if (modelMatch) {
    const versionFromQuery =
      url.searchParams.get("modelVersionId") ?? undefined;
    return {
      modelId: modelMatch[1],
      versionId: versionFromQuery,
      fileId,
    };
  }

  throw new Error(
    "인식할 수 없는 CivitAI 링크입니다. 모델 페이지 또는 다운로드 URL을 넣어 주세요.",
  );
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "").trim();
  const cleaned = base.replace(/[^\w.\-() \[\]\uac00-\ud7a3]/g, "_");
  if (!cleaned) {
    throw new Error("파일명을 확인할 수 없습니다.");
  }
  return cleaned;
}

function pickFilename(
  files: Array<{ name?: string; type?: string }> | undefined,
): string {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("이 모델 버전에서 다운로드할 파일을 찾지 못했습니다.");
  }
  const safetensors = files.find((f) =>
    (f.name ?? "").toLowerCase().endsWith(".safetensors"),
  );
  const chosen = safetensors ?? files[0];
  if (!chosen.name) {
    throw new Error("파일명을 확인할 수 없습니다.");
  }
  return sanitizeFilename(chosen.name);
}

async function civitaiGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${CIVITAI_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`CivitAI API 오류 (${res.status})`);
  }
  return (await res.json()) as T;
}

async function resolveVersion(
  link: ParsedCivitaiLink,
  apiKey: string,
): Promise<{ versionId: string; filename: string }> {
  if (link.versionId) {
    const version = await civitaiGet<{
      id: number;
      files?: Array<{ name?: string; type?: string }>;
    }>(`/model-versions/${link.versionId}`, apiKey);
    return {
      versionId: String(version.id),
      filename: pickFilename(version.files),
    };
  }

  if (!link.modelId) {
    throw new Error("모델 또는 버전 ID를 확인할 수 없습니다.");
  }

  const model = await civitaiGet<{
    modelVersions?: Array<{
      id: number;
      files?: Array<{ name?: string; type?: string }>;
    }>;
  }>(`/models/${link.modelId}`, apiKey);

  const latest = model.modelVersions?.[0];
  if (!latest) {
    throw new Error("이 모델에 사용 가능한 버전이 없습니다.");
  }
  return {
    versionId: String(latest.id),
    filename: pickFilename(latest.files),
  };
}

class LoraDownloadService {
  async downloadToInstance(
    instanceId: string,
    rawUrl: string,
  ): Promise<{ filename: string; path: string }> {
    const apiKey = process.env.CIVITAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "CIVITAI_API_KEY가 설정되지 않았습니다. 백엔드 .env를 확인하세요.",
      );
    }
    if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
      throw new Error("CivitAI 링크가 필요합니다.");
    }
    if (!sshTunnelService.isTunnelInstance(instanceId)) {
      throw new Error(
        "SSH로 등록된 인스턴스만 로라를 받을 수 있습니다. 프록시 URL 인스턴스는 지원하지 않습니다.",
      );
    }

    const parsed = parseCivitaiUrl(rawUrl);
    let resolved: { versionId: string; filename: string };
    try {
      resolved = await resolveVersion(parsed, apiKey);
    } catch (err) {
      if (!parsed.versionId) throw err;
      resolved = {
        versionId: parsed.versionId,
        filename: sanitizeFilename(`lora_${parsed.versionId}.safetensors`),
      };
      console.warn(
        `[LoraDownload] CivitAI API에서 파일명을 못 가져와 version ${parsed.versionId}로 저장합니다.`,
      );
    }
    const dest = `${LORA_DIR}/${resolved.filename}`;
    const origin = parsed.downloadOrigin ?? "https://civitai.com";
    const download = new URL(
      `${origin}/api/download/models/${resolved.versionId}`,
    );
    download.searchParams.set("token", apiKey);
    if (parsed.fileId) {
      download.searchParams.set("fileId", parsed.fileId);
    }
    const downloadUrl = download.toString();

    const remote = [
      `mkdir -p ${shSingleQuote(LORA_DIR)}`,
      `if command -v wget >/dev/null 2>&1; then wget -O ${shSingleQuote(dest)} ${shSingleQuote(downloadUrl)}; else curl -L --fail -o ${shSingleQuote(dest)} ${shSingleQuote(downloadUrl)}; fi`,
    ].join(" && ");

    console.log(
      `[LoraDownload] ${instanceId} → ${dest} (version ${resolved.versionId})`,
    );

    try {
      await sshTunnelService.execRemote(instanceId, remote, DOWNLOAD_TIMEOUT_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        redactSecret(redactSecret(message, apiKey), encodeURIComponent(apiKey)),
      );
    }

    return { filename: resolved.filename, path: dest };
  }
}

export const loraDownloadService = new LoraDownloadService();
