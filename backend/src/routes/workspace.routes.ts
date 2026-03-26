import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  createFolderStructure,
  getProjectDriveRoot,
  listCharacters,
  listSpots,
  resolveWorkspacePaths,
  validateWorkspace,
} from "../services/workspace.service.js";

const workspaceRouter = Router();

workspaceRouter.get(
  "/root",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: { root: getProjectDriveRoot() },
    });
  }),
);

workspaceRouter.get(
  "/characters",
  asyncHandler(async (_req: Request, res: Response) => {
    const characters = await listCharacters();
    res.json({ success: true, data: { characters } });
  }),
);

workspaceRouter.get(
  "/characters/:character/spots",
  asyncHandler(async (req: Request, res: Response) => {
    const spots = await listSpots(decodeURIComponent(req.params.character));
    res.json({ success: true, data: { spots } });
  }),
);

/**
 * GET /api/workspace/resolve?character=&spot=
 */
workspaceRouter.get(
  "/resolve",
  asyncHandler(async (req: Request, res: Response) => {
    const character = String(req.query.character ?? "").trim();
    const spot = String(req.query.spot ?? "").trim();
    if (!character || !spot) {
      return res.status(400).json({
        success: false,
        error: "character and spot query params are required",
      });
    }
    const validation = await validateWorkspace(character, spot);
    if (!validation.ok || !validation.paths) {
      return res.status(400).json({
        success: false,
        error: validation.error ?? "Invalid workspace",
      });
    }
    res.json({ success: true, data: validation.paths });
  }),
);

workspaceRouter.post(
  "/create-folders",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { character?: string; spots?: unknown };
    const character = typeof body.character === "string" ? body.character : "";
    const spots = Array.isArray(body.spots)
      ? body.spots.filter(
          (s): s is string => typeof s === "string" && s.trim() !== "",
        )
      : [];
    try {
      const result = await createFolderStructure(character, spots);
      res.json({
        success: true,
        data: {
          root: getProjectDriveRoot(),
          createdCount: result.created.length,
          created: result.created,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ success: false, error: msg });
    }
  }),
);

export default workspaceRouter;
