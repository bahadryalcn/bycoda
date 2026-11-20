import type { BackgroundLibraryImage } from "../../../model/backgroundLibrary";
import {
  readGeneratorValue,
  useGeneratorState,
  writeGeneratorValue,
} from "./themeGeneratorSession";
import {
  createAppearanceGeneration,
  themeSuggestionFailureDetail,
  type BackgroundImageProvider,
} from "./themeSuggestionRequest";

type JobTarget =
  | { kind: "themes"; name: string }
  | {
      kind: "image";
      name: string;
      provider: BackgroundImageProvider;
      batch: number;
      index: number;
    };

type JobState =
  | { status: "running"; cancel: () => void; cancelError?: string }
  | { status: "cancelling" }
  | { status: "saving" }
  | { status: "cancelled" }
  | { status: "failed"; detail: string; retry: () => void }
  | { status: "done"; image?: BackgroundLibraryImage };

export type ThemeGenerationJob = JobTarget & JobState & { id: string };

const KEY = "generationJobs";
const EMPTY: ThemeGenerationJob[] = [];
const RECENT_LIMIT = 6;

export function isActiveGeneration(job: ThemeGenerationJob) {
  return job.status === "running" || job.status === "cancelling" || job.status === "saving";
}

export function readGenerationJobs() {
  return readGeneratorValue(KEY, EMPTY);
}

export function useGenerationJobs() {
  return useGeneratorState(KEY, EMPTY)[0];
}

export function dismissGenerationJob(id: string) {
  writeGeneratorValue(KEY, (jobs) => jobs.filter((job) => job.id !== id), EMPTY);
}

/** Keep in-flight requests independent of the current suggestion list and Settings mount. */
export function beginGenerationJob(target: JobTarget, retry: () => void) {
  const generation = createAppearanceGeneration();
  const id = crypto.randomUUID();
  let cancellation: Promise<void> | undefined;
  let cancelled = false;
  const update = (state: JobState) =>
    writeGeneratorValue(
      KEY,
      (jobs) => {
        const updated: ThemeGenerationJob = { ...target, ...state, id };
        const index = jobs.findIndex((job) => job.id === id);
        if (index < 0) return jobs;
        const next = jobs.slice();
        if (isActiveGeneration(updated)) next[index] = updated;
        else {
          next.splice(index, 1);
          next.unshift(updated);
        }
        let recent = 0;
        return next.filter((job) => isActiveGeneration(job) || recent++ < RECENT_LIMIT);
      },
      EMPTY,
    );
  const cancel = () => {
    if (cancellation) return;
    update({ status: "cancelling" });
    cancellation = generation
      .cancel()
      .then((confirmed) => {
        cancelled = confirmed;
        if (confirmed) update({ status: "cancelled" });
        else update({ status: "running", cancel, cancelError: "" });
      })
      .catch((error: unknown) => {
        update({
          status: "running",
          cancel,
          cancelError: themeSuggestionFailureDetail(error),
        });
      })
      .finally(() => {
        cancellation = undefined;
      });
  };
  writeGeneratorValue(
    KEY,
    (jobs): ThemeGenerationJob[] => [{ ...target, id, status: "running", cancel }, ...jobs],
    EMPTY,
  );
  return {
    generation,
    async acceptResult() {
      while (cancellation) await cancellation;
      return !cancelled;
    },
    saving: () => update({ status: "saving" }),
    done: (image?: BackgroundLibraryImage) => update({ status: "done", image }),
    fail: (error: unknown) =>
      update({
        status: "failed",
        detail: themeSuggestionFailureDetail(error),
        retry: () => {
          dismissGenerationJob(id);
          retry();
        },
      }),
  };
}
