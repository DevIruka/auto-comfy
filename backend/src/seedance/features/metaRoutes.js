export function registerMetaRoutes({ app }) {
  app.get("/health", (req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      service: "seedance-proxy",
    });
  });

  app.get("/", (req, res) => {
    res.json({
      message: "Seedance Proxy Server",
      version: "1.0.0",
      endpoints: {
        "POST /api/seedance/generate":
          "Generate video immediately (single or batch).",
        "POST /api/seedance/generate-queued":
          "Queue generation job (endpointIndex 1|2|3).",
        "GET /api/seedance/queues": "Get queue status.",
        "GET /api/seedance/job/:jobId": "Get job status/result.",
        "POST /api/automation/scan": "Scan automation input folder structure.",
        "POST /api/automation/run": "Register automation jobs.",
        "POST /api/save-video": "Save generated video to output folder.",
        "POST /api/system/pick-folder": "Open folder picker dialog (Windows only).",
        "POST /api/system/open-folder": "Open folder in Explorer (Windows only).",
        "GET /health": "Health check.",
      },
    });
  });
}
