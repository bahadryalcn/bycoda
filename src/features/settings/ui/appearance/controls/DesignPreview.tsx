import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "../../../../../shared/i18n";
import { Text } from "../../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { chatBackgroundKind } from "../../../../../shared/lib/chatBackgroundKind";
import { CrewScene } from "../../../../sessions/public/CrewScene";
import { ChatBackgroundMedia } from "../../ChatBackgroundMedia";
import type { DesignDraft } from "../../../model/designs";
import { LiveBackgroundCanvas } from "../../LiveBackgroundCanvas";

/** The real renderer previews a draft while active preferences remain untouched. */
export function DesignPreview({ draft }: { draft: DesignDraft | null }) {
  return (
    <div
      {...surfaceAttributes({ frame: "pane", radius: "preview" }, "design-studio-preview")}
      data-creation-preview
    >
      {!draft ? (
        <EmptyState
          context="panel"
          title={t("Your preview appears here")}
          description={t("Describe a background or try the mountain lake example.")}
        />
      ) : draft.kind === "motion" ? (
        <div className="design-studio-motion">
          {draft.look.live && draft.look.live.scene !== "none" ? (
            <LiveBackgroundCanvas
              effect={draft.look.live.scene}
              intensity={draft.look.live.intensity}
              still={!draft.look.motion?.decorative}
              className="absolute inset-0"
            />
          ) : draft.look.motion?.showCrew ? (
            <CrewScene
              workingCount={3}
              paused={!draft.look.motion.decorative}
              preview={{ theme: draft.look.motion.crewTheme, growth: draft.look.motion.crewGrowth }}
            />
          ) : (
            <Text tone="muted">{t("Crew hidden")}</Text>
          )}
        </div>
      ) : draft.path ? (
        chatBackgroundKind(draft.path) === "image" ? (
          <img
            className="design-studio-preview-image"
            src={convertFileSrc(draft.path)}
            alt={t("Design preview")}
            decoding="async"
          />
        ) : (
          <ChatBackgroundMedia path={draft.path} />
        )
      ) : null}
    </div>
  );
}
