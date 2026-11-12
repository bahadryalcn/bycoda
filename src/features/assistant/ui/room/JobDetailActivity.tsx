import { LoadingText } from "../../../../shared/ui/LoadingText";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { useEffect, useEffectEvent, useState } from "react";
import type { AssistantActivity } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Timeline } from "../../../../shared/ui/Timeline";
import { stripAssistantEventMarkers } from "../../model/assistantEventMarkers";
import styles from "./Jobs.module.css";
import type { OwnerRequest } from "./assistantRoomHelpers";
import { loadJobActivity } from "./jobActivityLoad";

type ActivityResult =
  | { status: "ready"; items: AssistantActivity[]; now: number }
  | { status: "error"; message: string };
type ActivityState = { status: "loading" } | ActivityResult;

/** The job's activity log: time, summary and any failure text, newest first. */
export function JobDetailActivity({ jobId, request }: { jobId: string; request: OwnerRequest }) {
  const [result, setResult] = useState<{ key: string; value: ActivityResult } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${jobId}:${attempt}`;
  const state: ActivityState = result?.key === key ? result.value : { status: "loading" };
  // The Room recreates `request` on every render and a read can render the Room again, so the
  // read runs per job and retry only; the event always calls the latest request helper.
  const load = useEffectEvent((id: string) => loadJobActivity(request, id));
  useEffect(() => {
    let live = true;
    load(jobId).then(
      (items) => {
        if (live) setResult({ key, value: { status: "ready", items, now: Date.now() } });
      },
      (cause: unknown) => {
        if (live)
          setResult({
            key,
            value: {
              status: "error",
              message: cause instanceof Error ? cause.message : String(cause),
            },
          });
      },
    );
    return () => {
      live = false;
    };
  }, [jobId, key]);

  if (state.status === "loading")
    return (
      <LoadingText delay={false} className={styles.muted}>
        {t("Loading...")}
      </LoadingText>
    );
  if (state.status === "error")
    return (
      <InlineError retry={{ onRetry: () => setAttempt((value) => value + 1) }}>
        {t(state.message)}
      </InlineError>
    );
  if (!state.items.length)
    return (
      <EmptyState
        size="inline"
        kind="empty"
        className={styles.muted}
        description={t("No activity yet")}
      />
    );
  return (
    <Timeline
      label={t("Activity")}
      now={state.now}
      events={state.items.map((item) => {
        const failed = /fail|error/i.test(item.kind);
        return {
          id: item.id,
          at: item.createdAt,
          title: stripAssistantEventMarkers(item.summary),
          meta: failed ? t("This step failed.") : undefined,
          tone: failed ? ("danger" as const) : ("neutral" as const),
        };
      })}
    />
  );
}
