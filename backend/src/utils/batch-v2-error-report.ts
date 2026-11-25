import { appendFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";

export interface BatchV2Failure {
  poseName: string;
  imageName: string;
  targetFilename: string;
  error: string;
  stage?: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function reportTimestamp(date: Date): string {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("");
}

async function writeBatchFailureReport(params: {
  kind: "v1" | "v2";
  failures: BatchV2Failure[];
  inputPath: string;
  outputPath: string;
}): Promise<string | null> {
  if (params.failures.length === 0) return null;

  const now = new Date();
  const dir = join(process.cwd(), "error");
  await mkdir(dir, { recursive: true });
  const filePath = join(
    dir,
    `${params.kind}-failures-${reportTimestamp(now)}.md`,
  );

  const byPose = new Map<string, BatchV2Failure[]>();
  for (const failure of params.failures) {
    const list = byPose.get(failure.poseName) ?? [];
    list.push(failure);
    byPose.set(failure.poseName, list);
  }

  const title = params.kind === "v1" ? "V1 실패 리포트" : "V2 실패 리포트";
  const lines = [
    `# ${title}`,
    "",
    `- 시각: ${now.toISOString()}`,
    `- 입력: ${params.inputPath}`,
    `- 출력: ${params.outputPath}`,
    "",
  ];

  for (const [poseName, items] of byPose) {
    lines.push(`## ${poseName}`, "");
    for (const item of items) {
      const stage = item.stage ? `[${item.stage}] ` : "";
      lines.push(`- ${item.imageName} → ${item.targetFilename}`);
      lines.push(`  - ${stage}${item.error}`);
    }
    lines.push("");
  }

  await writeFile(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

export async function writeBatchV1FailureReport(params: {
  failures: BatchV2Failure[];
  inputPath: string;
  outputPath: string;
}): Promise<string | null> {
  return writeBatchFailureReport({ kind: "v1", ...params });
}

export async function writeBatchV2FailureReport(params: {
  failures: BatchV2Failure[];
  inputPath: string;
  outputPath: string;
}): Promise<string | null> {
  return writeBatchFailureReport({ kind: "v2", ...params });
}

/**
 * Append one interpolation failure to a job-scoped markdown file under error/.
 * Creates the file on the first call.
 */
export async function appendInterpolationFailureReport(params: {
  filePath?: string;
  failure: BatchV2Failure;
  inputPath: string;
  outputPath: string;
}): Promise<string> {
  const dir = join(process.cwd(), "error");
  await mkdir(dir, { recursive: true });

  let filePath = params.filePath;
  if (!filePath) {
    filePath = join(
      dir,
      `v1-interpolation-failures-${reportTimestamp(new Date())}.md`,
    );
    const header = [
      "# V1 프레임 보간 실패 리포트",
      "",
      `- 시각: ${new Date().toISOString()}`,
      `- 입력: ${params.inputPath}`,
      `- 출력: ${params.outputPath}`,
      "",
    ].join("\n");
    await writeFile(filePath, header, "utf-8");
  }

  const stage = params.failure.stage ? `[${params.failure.stage}] ` : "";
  const block = [
    `## ${params.failure.poseName}`,
    "",
    `- ${params.failure.imageName} → ${params.failure.targetFilename}`,
    `  - ${stage}${params.failure.error}`,
    "",
  ].join("\n");
  await appendFile(filePath, block, "utf-8");
  return filePath;
}
