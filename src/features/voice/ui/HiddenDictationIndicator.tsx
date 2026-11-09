import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Square } from "../../../shared/ui/icons";
import { sessionDisplayTitle } from "../../sessions/public/session";
import { useSession } from "../../sessions/public/sessionsStore";
import { useActiveDictations, type ActiveDictation } from "../model/dictationActivity";

/**
 * Footer reminder for dictation that still listens after its message box left
 * the screen: names the session, returns to it and stops the microphone.
 */
export function HiddenDictationIndicator({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void;
}) {
  // Only runs whose message box is off screen: the owner may have forgotten them.
  const runs = useActiveDictations().filter((run) => !run.visible);
  return runs.map((run, index) => (
    <HiddenDictation key={run.sessionId ?? index} run={run} onOpenSession={onOpenSession} />
  ));
}

function HiddenDictation({
  run,
  onOpenSession,
}: {
  run: ActiveDictation;
  onOpenSession: (sessionId: string) => void;
}) {
  const t = useT();
  const { label, title } = useDictationLabel(run);
  const finishing = run.state === "finishing";
  return (
    <ButtonGroup aria-label={t("Dictation")} className="me-1 min-w-0">
      <Button
        variant="ghost"
        size="sm"
        tone="danger"
        className="max-w-64 min-w-0"
        startIcon={<StatusDot tone="danger" appearance="solid" size="sm" />}
        tooltip={title ? t("Return to the session that receives the text") : undefined}
        disabled={!run.sessionId}
        onClick={() => run.sessionId && onOpenSession(run.sessionId)}
      >
        <span className="truncate">{label}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Stop dictation")}
        disabled={finishing}
        onClick={run.stop}
      >
        <Square className="icon-sm" strokeWidth={2} />
      </Button>
    </ButtonGroup>
  );
}

/** What a dictation run is doing, naming the session that receives its text. */
export function useDictationLabel(run: ActiveDictation) {
  const t = useT();
  const session = useSession(run.sessionId);
  const title = session ? sessionDisplayTitle(session.title, session.harness) : undefined;
  const label =
    run.state === "finishing"
      ? t("Transcribing dictation…")
      : title
        ? t("Dictating in {p0}", { p0: title })
        : t("Dictation is listening");
  return { label, title };
}
