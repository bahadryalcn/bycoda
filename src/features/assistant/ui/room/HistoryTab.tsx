import { AssistantHistory } from "../AssistantHistory";
import { AssistantNotificationRecovery } from "../AssistantNotificationRecovery";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { matches } from "./assistantRoomHelpers";
import { useAssistantRoom } from "./assistantRoomContext";

export function HistoryTab({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    projects,
    privacy,
    view,
    query,
    filter,
    setDetail,
    onOpenSession,
  } = room;

  return (
    <>
      {view === "History" && (
        <>
          <AssistantHistory
            filtered={Boolean(query.trim() || filter)}
            entries={snapshot.activity.filter(
              (item) =>
                matches(query, item.summary, item.kind) && (!filter || item.kind === filter),
            )}
            onOpenSession={onOpenSession}
            onJob={setDetail}
          />
          {environmentId && (
            <AssistantNotificationRecovery
              key={privacy.key}
              projects={projects}
              environmentId={environmentId}
              request={assistantRequest}
            />
          )}
        </>
      )}
    </>
  );
}
