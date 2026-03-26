import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function registerUtilityRoutes({ app, fs, path }) {
  app.post("/system/pick-folder", async (req, res) => {
    try {
      if (process.platform !== "win32") {
        return res.status(400).json({
          success: false,
          error: "This endpoint is only available on Windows.",
        });
      }

      const psScript = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
        "$dialog.Title = 'Select folder'",
        "$dialog.Filter = 'Folder selector|*.folder'",
        "$dialog.CheckFileExists = $false",
        "$dialog.CheckPathExists = $true",
        "$dialog.ValidateNames = $false",
        "$dialog.FileName = 'Select this folder'",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
        "  $selected = [System.IO.Path]::GetDirectoryName($dialog.FileName)",
        "  if (-not $selected) { $selected = $dialog.InitialDirectory }",
        "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "  $bytes = [System.Text.Encoding]::UTF8.GetBytes($selected)",
        "  Write-Output ([Convert]::ToBase64String($bytes))",
        "}",
      ].join("; ");

      const encodedCommand = Buffer.from(psScript, "utf16le").toString("base64");
      const cmd = `powershell.exe -NoProfile -STA -EncodedCommand ${encodedCommand}`;
      // windowsHide: false so the folder dialog is not hidden behind the browser
      const result = await execAsync(cmd, {
        windowsHide: false,
        maxBuffer: 1024 * 1024,
      });

      const encodedPath = (result.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      const selectedPath = encodedPath
        ? Buffer.from(encodedPath, "base64").toString("utf8")
        : "";

      if (!selectedPath) {
        return res.json({
          success: false,
          cancelled: true,
          error: "Folder selection was cancelled.",
        });
      }

      return res.json({ success: true, path: selectedPath });
    } catch (error) {
      const stderr = String(error?.stderr || "").trim();
      return res.status(500).json({
        success: false,
        error: "Failed to pick folder.",
        detail: stderr || undefined,
      });
    }
  });

  app.post("/system/open-folder", async (req, res) => {
    try {
      if (process.platform !== "win32") {
        return res.status(400).json({
          success: false,
          error: "This endpoint is only available on Windows.",
        });
      }

      const folderPath = String(req.body?.path || "").trim();
      if (!folderPath) {
        return res.status(400).json({ success: false, error: "path is required." });
      }

      const resolvedPath = path.resolve(folderPath);
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        return res.status(404).json({
          success: false,
          error: "Folder path does not exist.",
        });
      }

      const escapedPath = resolvedPath.replace(/"/g, '""');
      await execAsync(`explorer.exe "${escapedPath}"`);
      return res.json({ success: true, path: resolvedPath });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message || "Failed to open folder.",
      });
    }
  });
}
