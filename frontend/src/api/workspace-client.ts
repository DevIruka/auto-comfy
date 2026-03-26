const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

export interface ResolvedWorkspacePaths {
  root: string;
  character: string;
  spot: string;
  spotPath: string;
  bannerPath: string;
  imageAdult: string;
  videoAdult: string;
  emotionImages: string;
  generalVideo: string;
}

class WorkspaceClient {
  async getRoot(): Promise<string> {
    const res = await fetch(`${API_BASE}/api/workspace/root`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get workspace root");
    return json.data.root as string;
  }

  async listCharacters(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/api/workspace/characters`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to list characters");
    return json.data.characters as string[];
  }

  async listSpots(character: string): Promise<string[]> {
    const res = await fetch(
      `${API_BASE}/api/workspace/characters/${encodeURIComponent(character)}/spots`,
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to list spots");
    return json.data.spots as string[];
  }

  async resolve(character: string, spot: string): Promise<ResolvedWorkspacePaths> {
    const q = new URLSearchParams({ character, spot });
    const res = await fetch(`${API_BASE}/api/workspace/resolve?${q}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to resolve workspace");
    return json.data as ResolvedWorkspacePaths;
  }

  async createFolders(
    character: string,
    spots: string[],
  ): Promise<{ root: string; createdCount: number; created: string[] }> {
    const res = await fetch(`${API_BASE}/api/workspace/create-folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, spots }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to create folders");
    return json.data;
  }
}

export const workspaceClient = new WorkspaceClient();
