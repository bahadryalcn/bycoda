import { useContext, useLayoutEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { FailureState } from "../../../shared/ui/FailureState";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { OverlayParent } from "../../../shared/ui/overlay";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { loadSessionChangesDiff } from "../../../features/source-control";
import type { ToolsTab } from "../../../features/host-tools/toolsUiControl";
import type { Session } from "../../../features/sessions/public/session";
import type { VoiceWorkspaceTrackedWork } from "../../../features/voice/model/voiceWorkspaceTrackedWork";

const SessionChangesDiff = lazySurface(async () => ({
  default: (await loadSessionChangesDiff()).SessionChangesDiff,
}));

export type OpenVoiceTrackedWork = (work: VoiceWorkspaceTrackedWork) => boolean;
export type OpenVoiceWorkspace = (target: Pick<Session, "id" | "cwd">) => void;

export type VoiceToolsOutlet = {
  element: HTMLElement;
  sessionId: string;
  cwd: string;
  tab: ToolsTab;
  overlayParent: symbol | null;
  onError: (error: string) => void;
  onReady: () => void;
};

function VoiceToolsPanel({
  session,
  tab,
  present,
}: {
  session: Session;
  tab: ToolsTab;
  present: (outlet: VoiceToolsOutlet | undefined) => void;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const overlayParent = useContext(OverlayParent);
  const { id, cwd } = session;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Publishes the mounted DOM outlet and clears it when the panel leaves.
  useLayoutEffect(() => {
    if (!element) return;
    present({
      element,
      sessionId: id,
      cwd,
      tab,
      overlayParent,
      onError: setError,
      onReady: () => setReady(true),
    });
    return () => present(undefined);
  }, [element, id, cwd, tab, overlayParent, present]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {error && <FailureState context="panel" title={t("Tool panels")} error={error} />}
      {!error && !ready && <SurfaceLoading label={t("Tool panels")} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={setElement} />
    </div>
  );
}

export function VoiceWorkspacePanel({
  panel,
  session,
  present,
}: {
  panel: "changes" | ToolsTab;
  session: Session;
  present: (outlet: VoiceToolsOutlet | undefined) => void;
}) {
  if (panel === "changes")
    return <SessionChangesDiff key={session.id} cwd={session.cwd} sessionId={session.id} />;
  return (
    <VoiceToolsPanel
      key={JSON.stringify([session.id, session.cwd, panel])}
      session={session}
      tab={panel}
      present={present}
    />
  );
}
