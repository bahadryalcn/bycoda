import type { ReactNode } from "react";
import { errorText } from "../../../../shared/lib/errors";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { AssistantBriefingCard } from "../AssistantBriefingCard";
import { assistantJobVisible } from "../../model/assistantJobs";
import { AssistantOwnerQuestions } from "../AssistantOwnerQuestions";
import { useAssistantRoom } from "./assistantRoomContext";
import { TodayGlance } from "./TodayGlance";
import { TodayNotes } from "./TodayNotes";

/** Today's top: owner questions, the briefing, the glance charts and today's notes. Jobs follow in JobsTab. */
export function TodayTab({ snapshot, jobs }: { snapshot: AssistantSnapshot; jobs?: ReactNode }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    privacy,
    canSeeProject,
    canReadBriefing,
    setView,
    setFilter,
    setSetup,
    setSettings,
    canonicalSnapshot,
    refresh,
    props,
  } = room;

  const visibleJobs = snapshot.jobs.filter((job) => assistantJobVisible(job, canSeeProject));
  const hiddenJobIds = new Set(
    snapshot.jobs.filter((job) => !visibleJobs.includes(job)).map((job) => job.id),
  );
  return (
    <>
      {environmentId && (
        <AssistantOwnerQuestions
          questions={canonicalSnapshot?.ownerQuestions ?? []}
          environmentId={environmentId}
          visibleProjectIds={[...privacy.projectIds]}
          request={assistantRequest}
          onChanged={() => {
            refresh().catch((error: unknown) =>
              room.setError({ key: "refresh", text: errorText(error) }),
            );
          }}
        />
      )}
      {snapshot.briefing && (
        <AssistantBriefingCard
          snapshot={snapshot}
          environmentId={props.environmentId ?? environmentId}
          privacyKey={privacy.key}
          canSeeProject={canSeeProject}
          canReadBriefing={canReadBriefing}
          onDismiss={() =>
            assistantRequest({ op: "briefing.dismiss", id: snapshot.briefing!.id }).then(
              () => undefined,
            )
          }
          onOpenNotes={() => setView("Notes")}
          onOpenSession={props.onOpenSession}
          onOpenGoal={props.onOpenGoal}
          onSetupVoice={() => setSetup("voice")}
          onChooseLanguage={() => setSettings(true)}
        />
      )}
      {jobs}
      <TodayGlance
        jobs={visibleJobs}
        activity={snapshot.activity.filter(
          (entry) => !entry.jobId || !hiddenJobIds.has(entry.jobId),
        )}
        onOpenJobs={(status) => {
          setFilter(status);
          setView("Jobs");
        }}
        onOpenHistory={() => setView("History")}
      />
      <TodayNotes snapshot={snapshot} onOpenNotes={() => setView("Notes")} />
    </>
  );
}
