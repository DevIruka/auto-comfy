import type { ComponentProps } from "react";
import { AutomationModePanel } from "../automation/AutomationModePanel";
import { SingleModePanel } from "../single/SingleModePanel";
import { GenerateActionButtons } from "./GenerateActionButtons";
import type { AppMode } from "../../types/app";

export type GeneratorPanelVariant = "singleOnly" | "automationOnly";

interface GeneratorMainPanelProps {
  panelVariant?: GeneratorPanelVariant;
  /** When false, generation buttons stay disabled (workspace not resolved). */
  workspaceReady?: boolean;
  automationPanelProps: ComponentProps<typeof AutomationModePanel>;
  singlePanelProps: ComponentProps<typeof SingleModePanel>;
  actionButtons: {
    loading: boolean;
    hasFirstFrameImage: boolean;
    onSingleGenerate: () => void | Promise<void>;
  };
  error: string;
}

export function GeneratorMainPanel({
  panelVariant = "automationOnly",
  workspaceReady = true,
  automationPanelProps,
  singlePanelProps,
  actionButtons,
  error,
}: GeneratorMainPanelProps) {
  const singleOnly = panelVariant === "singleOnly";
  const actionMode: AppMode = singleOnly ? "single" : "automation";

  return (
    <div className="generator-section">
      {panelVariant === "automationOnly" && (
        <AutomationModePanel {...automationPanelProps} />
      )}
      {singleOnly && <SingleModePanel {...singlePanelProps} />}

      <GenerateActionButtons
        mode={actionMode}
        loading={actionButtons.loading}
        hasFirstFrameImage={actionButtons.hasFirstFrameImage}
        onSingleGenerate={actionButtons.onSingleGenerate}
        workspaceBlocked={!workspaceReady}
      />

      {error && <div className="error-message">{error}</div>}
    </div>
  );
}
