import { useAppController } from "./features/generator/useAppController";
import { GeneratorMainPanel } from "./features/generator/GeneratorMainPanel";
import { GeneratedVideosSection } from "./features/video/GeneratedVideosSection";
import completionSound from "./assets/12_3.mp3";
import "./seedance-panel.css";

export type SeedanceHostView = "single" | "automation";

interface SeedanceHostProps {
  view: SeedanceHostView;
}

/**
 * Single useAppController instance for both Seedance tabs; stays mounted while either tab is active.
 */
export function SeedanceHost({ view }: SeedanceHostProps) {
  const {
    generatorMainPanelPropsSingle,
    generatorMainPanelPropsAutomation,
    generatedVideosSectionProps,
  } = useAppController({ soundSrc: completionSound });

  const isSingle = view === "single";

  return (
    <div className="seedance-panel-host">
      <header className="header">
        <h1>{isSingle ? "단일 일반 영상" : "일반 영상 자동화"}</h1>
        <p>
          {isSingle
            ? "BytePlus Seedance — 첫 프레임 기준 단일(또는 소량 배치) 영상 생성"
            : "폴더 스캔 자동화 — 작업 공간 선택 시 입력은 감정별 이미지/Emotions, 출력은 일반 영상으로 맞춰집니다."}
        </p>
      </header>

      <div className="main">
        {isSingle ? (
          <GeneratorMainPanel {...generatorMainPanelPropsSingle} />
        ) : (
          <GeneratorMainPanel {...generatorMainPanelPropsAutomation} />
        )}

        <GeneratedVideosSection {...generatedVideosSectionProps} />
      </div>

      <footer className="footer">
        <p>Powered by BytePlus ModelArk Seedance (auto-comfy 통합)</p>
      </footer>
    </div>
  );
}
