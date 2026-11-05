import type {
  AssistantMessage,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";
import { pathKey } from "../../../shared/lib/paths";

export type VoiceHistoryScope = {
  projectIds: readonly string[];
  complete: boolean;
  liveProjectIds: () => ReadonlySet<string>;
  current: () => boolean;
};
type Project = { id: string; path: string };
/** Frozen accepted-turn directory; later visible additions cannot broaden it. */
export function captureVoiceHistoryScope(
  paths: readonly string[],
  projects: readonly Project[],
  visible: () => readonly string[],
): VoiceHistoryScope {
  const capturedPaths = new Set(paths.map(pathKey)),
    directory = projects.map((project) => ({ ...project }));
  const selected = directory.filter((project) => capturedPaths.has(pathKey(project.path)));
  const projectIds = Object.freeze([...new Set(selected.map((project) => project.id))]);
  const complete = [...capturedPaths].every((path) =>
    selected.some((project) => pathKey(project.path) === path),
  );
  const liveProjectIds = () => {
    const current = new Set(visible().map(pathKey));
    return new Set(
      selected.filter((project) => current.has(pathKey(project.path))).map((project) => project.id),
    );
  };
  return {
    projectIds,
    complete,
    liveProjectIds,
    // Directory coverage gates summaries and saved context, not microphone lifetime.
    // Even an unmatched path must still invalidate capture when it becomes hidden.
    current: () => {
      const current = new Set(visible().map(pathKey));
      return [...capturedPaths].every((path) => current.has(path));
    },
  };
}
export function voiceHistoryMessageVisible(
  message: { projectIds?: readonly string[] },
  scope: VoiceHistoryScope,
) {
  const live = scope.liveProjectIds();
  return (
    Array.isArray(message.projectIds) &&
    message.projectIds.every((id) => scope.projectIds.includes(id) && live.has(id))
  );
}
/** Only display/context projection; never rewrite canonical records or infer a
 * global source from an unscoped thread/summary. [] is explicit global proof. */
export function projectVoiceHistory<
  T extends { thread: AssistantThread; messages: AssistantMessage[] },
>(value: T, _global: boolean, scope: VoiceHistoryScope): T {
  const threadVisible =
    !value.thread.projectId ||
    (scope.projectIds.includes(value.thread.projectId) &&
      scope.liveProjectIds().has(value.thread.projectId));
  const summaryVisible =
    threadVisible &&
    scope.complete &&
    scope.current() &&
    !!value.thread.summaryProof &&
    voiceHistoryMessageVisible(value.thread.summaryProof, scope);
  return {
    ...value,
    thread: {
      ...value.thread,
      summary: summaryVisible ? value.thread.summary : "",
      ...(!summaryVisible ? { summaryProof: undefined } : {}),
    },
    messages: threadVisible
      ? value.messages.filter((message) => voiceHistoryMessageVisible(message, scope))
      : [],
  };
}
