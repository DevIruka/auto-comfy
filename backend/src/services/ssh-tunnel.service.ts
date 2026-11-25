import { spawn, ChildProcess } from "child_process";
import net from "net";
import os from "os";
import path from "path";
import fs from "fs";

export interface ParsedSshCommand {
  user: string;
  host: string;
  /** SSH port (from -p), default 22 */
  sshPort: number;
  /** Identity file path from -i, if provided (already ~-expanded) */
  identityFile: string | null;
}

export interface StartTunnelParams {
  user: string;
  host: string;
  sshPort: number;
  identityFile: string | null;
  /** Remote ComfyUI port to forward (e.g. 8188) */
  remotePort: number;
}

export interface ActiveTunnel {
  localPort: number;
  remotePort: number;
  sshTarget: string;
  podId: string | null;
  process: ChildProcess;
  user: string;
  host: string;
  sshPort: number;
  identityFile: string;
}

/** Expand a leading ~ to the OS home directory. */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Parse a RunPod-style SSH command such as:
 *   ssh cg505wkcdmujxw-64410f6e@ssh.runpod.io -i ~/.ssh/id_ed25519
 *   ssh -p 22 user@host -i C:\keys\id_ed25519
 *   user@ssh.runpod.io
 * Returns null if the input is not an SSH command / target.
 */
export function parseSshCommand(input: string): ParsedSshCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Tokenize respecting simple double/single quotes.
  const tokens = trimmed.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!tokens) return null;

  let idx = 0;
  if (tokens[idx]?.toLowerCase() === "ssh") idx += 1;

  let userHost: string | null = null;
  let identityFile: string | null = null;
  let sshPort = 22;

  for (; idx < tokens.length; idx += 1) {
    let tok = tokens[idx];
    // Strip surrounding quotes
    tok = tok.replace(/^["']|["']$/g, "");

    if (tok === "-i") {
      const next = tokens[idx + 1]?.replace(/^["']|["']$/g, "");
      if (next) {
        identityFile = expandHome(next);
        idx += 1;
      }
      continue;
    }
    if (tok.startsWith("-i") && tok.length > 2) {
      identityFile = expandHome(tok.slice(2));
      continue;
    }
    if (tok === "-p") {
      const next = tokens[idx + 1]?.replace(/^["']|["']$/g, "");
      if (next && /^\d+$/.test(next)) {
        sshPort = Number(next);
        idx += 1;
      }
      continue;
    }
    if (tok.startsWith("-p") && /^\d+$/.test(tok.slice(2))) {
      sshPort = Number(tok.slice(2));
      continue;
    }
    // Ignore other flags and their potential arguments minimally
    if (tok.startsWith("-")) continue;

    if (!userHost && tok.includes("@")) {
      userHost = tok;
    }
  }

  if (!userHost) return null;
  const [user, host] = userHost.split("@");
  if (!user || !host) return null;

  return { user, host, sshPort, identityFile };
}

/**
 * Extract a RunPod pod ID from an SSH username.
 * Example: cg505wkcdmujxw-64410f6e -> cg505wkcdmujxw
 */
export function extractPodIdFromSshUser(user: string): string | null {
  const dash = user.indexOf("-");
  if (dash > 0) return user.slice(0, dash);
  return user || null;
}

/** Find the first common identity file if none was supplied. */
function resolveDefaultIdentityFile(): string | null {
  const candidates = [
    path.join(os.homedir(), ".ssh", "id_ed25519"),
    path.join(os.homedir(), ".ssh", "id_rsa"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Find a free TCP port starting from `start`. */
function findFreePort(start: number, attempts = 200): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    let tried = 0;

    const tryPort = (p: number) => {
      const server = net.createServer();
      server.once("error", () => {
        tried += 1;
        if (tried >= attempts) {
          reject(new Error("No free local port available for SSH tunnel"));
          return;
        }
        tryPort(p + 1);
      });
      server.once("listening", () => {
        server.close(() => resolve(p));
      });
      server.listen(p, "127.0.0.1");
    };

    tryPort(port);
  });
}

class SshTunnelService {
  /** localPort -> ActiveTunnel */
  private tunnels: Map<number, ActiveTunnel> = new Map();
  /** instanceId -> localPort */
  private instanceToPort: Map<string, number> = new Map();

  private readonly LOCAL_PORT_BASE = 18188;

  /**
   * Start an SSH local port-forward tunnel.
   * Resolves once the tunnel process is spawned; call verifyComfy() separately.
   */
  async startTunnel(params: StartTunnelParams): Promise<ActiveTunnel> {
    const identityFile =
      params.identityFile ?? resolveDefaultIdentityFile();
    if (!identityFile) {
      throw new Error(
        "SSH 키 파일을 찾을 수 없습니다. 명령에 -i 경로를 포함하거나 ~/.ssh/id_ed25519 를 준비하세요.",
      );
    }
    if (!fs.existsSync(identityFile)) {
      throw new Error(`SSH 키 파일이 존재하지 않습니다: ${identityFile}`);
    }

    const localPort = await findFreePort(this.nextLocalPortStart());
    const sshTarget = `${params.user}@${params.host}`;
    const podId = extractPodIdFromSshUser(params.user);

    const args = [
      "-N",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${params.remotePort}`,
      "-p",
      String(params.sshPort),
      "-i",
      identityFile,
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "BatchMode=yes",
      sshTarget,
    ];

    const child = spawn("ssh", args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    let stderrBuf = "";
    if (child.stderr) {
      child.stderr.on("data", (d: Buffer) => {
        stderrBuf += d.toString();
        // Keep only the tail to avoid unbounded growth
        if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
      });
    }

    // Fail fast if the process exits almost immediately (bad key/host).
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onExit = (code: number | null) => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `SSH 터널을 여는 데 실패했습니다 (exit ${code}). ${stderrBuf.trim() || "ssh가 설치되어 있고 키/호스트가 올바른지 확인하세요."}`,
          ),
        );
      };
      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `SSH 실행 실패: ${err.message}. OpenSSH 클라이언트(ssh)가 PATH에 있는지 확인하세요.`,
          ),
        );
      };
      child.once("exit", onExit);
      child.once("error", onError);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
        resolve();
      }, 1500);
    });

    const tunnel: ActiveTunnel = {
      localPort,
      remotePort: params.remotePort,
      sshTarget,
      podId,
      process: child,
      user: params.user,
      host: params.host,
      sshPort: params.sshPort,
      identityFile,
    };

    child.once("exit", () => {
      this.tunnels.delete(localPort);
    });

    this.tunnels.set(localPort, tunnel);
    return tunnel;
  }

  /**
   * Poll the forwarded ComfyUI /system_stats until it responds or times out.
   */
  async verifyComfy(localPort: number, timeoutMs = 20000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const url = `http://127.0.0.1:${localPort}/system_stats`;
    while (Date.now() < deadline) {
      if (!this.tunnels.has(localPort)) return false;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (res.ok) return true;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /** Associate an already-open tunnel with a comfy instance id. */
  bindInstance(instanceId: string, localPort: number): void {
    this.instanceToPort.set(instanceId, localPort);
  }

  isTunnelInstance(instanceId: string): boolean {
    return this.instanceToPort.has(instanceId);
  }

  /**
   * Run a command on the remote host using the same credentials as the
   * instance's tunnel. Separate from the -N port-forward process.
   */
  execRemote(
    instanceId: string,
    remoteCommand: string,
    timeoutMs = 15 * 60 * 1000,
  ): Promise<{ stdout: string; stderr: string }> {
    const localPort = this.instanceToPort.get(instanceId);
    if (localPort == null) {
      throw new Error(
        "SSH 터널 인스턴스가 아닙니다. Pod Dashboard에서 SSH로 등록한 인스턴스만 원격 명령을 실행할 수 있습니다.",
      );
    }
    const tunnel = this.tunnels.get(localPort);
    if (!tunnel) {
      throw new Error("SSH 터널이 열려 있지 않습니다. 인스턴스를 다시 등록하세요.");
    }

    const args = [
      "-p",
      String(tunnel.sshPort),
      "-i",
      tunnel.identityFile,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      tunnel.sshTarget,
      remoteCommand,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
        if (stdout.length > 8000) stdout = stdout.slice(-8000);
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`원격 SSH 명령이 ${Math.round(timeoutMs / 60000)}분 안에 끝나지 않았습니다.`));
      }, timeoutMs);

      child.once("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`SSH 실행 실패: ${err.message}`));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          new Error(
            `원격 명령이 실패했습니다 (exit ${code}). ${stderr.trim() || stdout.trim() || "출력 없음"}`,
          ),
        );
      });
    });
  }

  /** Stop the tunnel associated with a comfy instance id. */
  stopByInstance(instanceId: string): void {
    const localPort = this.instanceToPort.get(instanceId);
    if (localPort == null) return;
    this.stopTunnel(localPort);
    this.instanceToPort.delete(instanceId);
  }

  stopTunnel(localPort: number): void {
    const tunnel = this.tunnels.get(localPort);
    if (!tunnel) return;
    try {
      tunnel.process.kill();
    } catch {
      /* ignore */
    }
    this.tunnels.delete(localPort);
  }

  stopAll(): void {
    for (const tunnel of this.tunnels.values()) {
      try {
        tunnel.process.kill();
      } catch {
        /* ignore */
      }
    }
    this.tunnels.clear();
    this.instanceToPort.clear();
  }

  private nextLocalPortStart(): number {
    let max = this.LOCAL_PORT_BASE - 1;
    for (const port of this.tunnels.keys()) {
      if (port > max) max = port;
    }
    return max + 1;
  }
}

export const sshTunnelService = new SshTunnelService();
