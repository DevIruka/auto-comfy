import { Router } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { registerAutomationRoutes } from "./features/automationRoutes.js";
import { registerUtilityRoutes } from "./features/utilityRoutes.js";
import { registerFileWorkflowRoutes } from "./features/fileWorkflowRoutes.js";
import { registerSeedanceRoutes } from "./features/seedanceRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Express Router mounted at /api/seedance — all routes are relative (e.g. /generate).
 */
export function createSeedanceRouter() {
  const router = Router();
  const BYTEPLUS_API_BASE =
    process.env.BYTEPLUS_API_BASE ||
    "https://ark.ap-southeast.bytepluses.com";
  const ARK_API_KEY = process.env.ARK_API_KEY;
  const MODEL_ID =
    process.env.SEEDANCE_MODEL_ID_1 ||
    process.env.SEEDANCE_MODEL_ID ||
    "ep-20260225103736-hbdt8";
  const SEEDANCE_MODEL_IDS = [
    process.env.SEEDANCE_MODEL_ID_1 || MODEL_ID,
    process.env.SEEDANCE_MODEL_ID_2 ||
      process.env.SEEDANCE_MODEL_ID_1 ||
      MODEL_ID,
    process.env.SEEDANCE_MODEL_ID_3 ||
      process.env.SEEDANCE_MODEL_ID_2 ||
      MODEL_ID,
  ];
  const MODEL_NAMES = {
    "ep-20250917110546-7qj7q": "seedance-1-0-lite-i2v-250428",
    "ep-20250917121327-nx4gp": "seedance-1-0-pro-250528",
    "ep-20260225103736-hbdt8": "seedance-1-5-pro-251215",
  };
  const MODEL_IDS_REVERSE = Object.fromEntries(
    Object.entries(MODEL_NAMES).map(([id, name]) => [name, id]),
  );
  const CURRENT_MODEL_NAME = MODEL_NAMES[MODEL_ID] || MODEL_ID;

  const emotionConfigPath = path.join(
    __dirname,
    "..",
    "..",
    "data",
    "emotion-config-optimized.json",
  );

  registerFileWorkflowRoutes({
    app: router,
    axios,
    fs,
    path,
  });

  const { runSeedanceJobWithModel } = registerSeedanceRoutes({
    app: router,
    axios,
    BYTEPLUS_API_BASE,
    ARK_API_KEY,
    MODEL_ID,
    CURRENT_MODEL_NAME,
    MODEL_NAMES,
    MODEL_IDS_REVERSE,
  });

  registerAutomationRoutes({
    app: router,
    fs,
    path,
    axios,
    setImmediate,
    runSeedanceJobWithModel,
    SEEDANCE_MODEL_IDS,
    ARK_API_KEY,
    emotionConfigPath,
  });

  registerUtilityRoutes({
    app: router,
    fs,
    path,
  });

  return router;
}
