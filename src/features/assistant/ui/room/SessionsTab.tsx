import sessionStyles from "../AssistantSessions.module.css";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { AssistantSessions } from "../AssistantSessions";
import { ManualSessionSupervision } from "../ManualSessionSupervision";
import { useAssistantRoom } from "./assistantRoomContext";

export function SessionsTab({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    projects,
    view,
    setView,
    setSettings,
    query,
    setQuery,
    filter,
    setFilter,
    manual,
    onOpenSession,
    props,
    projectName,
  } = room;

  return (
    <>
      {view === "Sessions" && (
        <div className={sessionStyles.layout}>
          <ManualSessionSupervision
            key={environmentId ?? "unknown"}
            controller={manual}
            projects={projects}
            environmentId={environmentId}
            query={query}
            onSettings={() => setSettings(true)}
            onOpenSession={onOpenSession}
          />
          <AssistantSessions
            jobs={snapshot.jobs}
            query={query}
            filter={filter}
            environmentId={props.environmentId ?? environmentId}
            contextSettings={snapshot.profile}
            projectName={projectName}
            onOpenSession={onOpenSession}
            onJobs={() => {
              setView("Jobs");
              setQuery("");
              setFilter("");
            }}
            onReset={() => {
              setQuery("");
              setFilter("");
            }}
          />
        </div>
      )}
    </>
  );
}
