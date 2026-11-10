import type { CrewCandidate } from "../../src/features/crews/model/crew";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import { readCrewState } from "./crew-scheduler-projection";

/** Review-backed outcome counts of one member and candidate in a project's crew runs. */
export async function candidateObservations(
  store: HostStore,
  tasks: Pick<HostTasks, "list">,
  projectId: string,
  memberId: string,
  candidate: CrewCandidate,
) {
  const ids = new Set(
    (await readCrewState(store)).runs
      .filter((run) => run.projectId === projectId)
      .flatMap((run) =>
        run.assignments
          .filter(
            (a) =>
              a.memberId === memberId &&
              a.candidate.harness === candidate.harness &&
              a.candidate.model === candidate.model &&
              JSON.stringify(a.candidate.modelSettings) === JSON.stringify(candidate.modelSettings),
          )
          .map((a) => a.taskId),
      ),
  );
  const samples = (await tasks.list(projectId)).filter(
    (task) => ids.has(task.id) && task.verification?.review,
  );
  return {
    count: samples.length,
    accepted: samples.filter((task) => task.status === "done").length,
    passed: samples.filter(
      (task) =>
        task.verification?.review?.verdict === "pass" &&
        !task.reviewNotes?.some((note) => note.kind === "finding") &&
        !task.attemptHistory?.some((attempt) => attempt.verdict === "fail"),
    ).length,
  };
}
