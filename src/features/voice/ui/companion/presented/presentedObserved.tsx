import { createElement, useContext } from "react";
import { useT } from "../../../../../shared/i18n";
import { Text } from "../../../../../shared/ui/Text";
import type { VoiceLiveResult } from "../../../model/voiceLiveWork";
import {
  ChangeResultBody,
  CheckResultBody,
  FailedCommandsBody,
  TestResultBody,
  VoiceActionsBody,
} from "../VoiceWorkResults";
import { PresentedHostContext, presentedView, type PresentedView } from "./presentedContext";
import { workResultEntries } from "./workResultEntries";

function NotObserved() {
  const t = useT();
  return (
    <Text as="p" tone="muted">
      {t("Not observed in this turn.")}
    </Text>
  );
}

/** The prop each work result entry names its child nodes with. */
const workChildKey: Record<string, string | undefined> = {
  WorkResults: "sections",
  WorkStatusCounts: "options",
};

function useObserved<Kind extends VoiceLiveResult["kind"]>(kind: Kind) {
  const { observed } = useContext(PresentedHostContext);
  return observed.find(
    (result): result is Extract<VoiceLiveResult, { kind: Kind }> => result.kind === kind,
  );
}

function TestResultView() {
  const result = useObserved("tests");
  return result ? <TestResultBody {...result} /> : <NotObserved />;
}
function CheckResultView({ kind }: { kind: "build" | "checks" }) {
  const result = useObserved(kind);
  return result ? <CheckResultBody kind={kind} status={result.status} /> : <NotObserved />;
}
function ChangeResultView() {
  const result = useObserved("changes");
  return result ? <ChangeResultBody {...result} /> : <NotObserved />;
}
function FailedCommandsView() {
  const result = useObserved("commands");
  return result ? <FailedCommandsBody count={result.count} /> : <NotObserved />;
}
function VoiceActionsView() {
  const result = useObserved("actions");
  return result ? (
    <VoiceActionsBody status={result.status} actions={result.actions} />
  ) : (
    <NotObserved />
  );
}

/**
 * Results the turn measured. They take no data from the model; an observed result that does not
 * exist says so rather than showing an invented one. The work result entries read their records
 * and filter from their own providers and take their child nodes under the name each was written with.
 */
export const presentedObservedViews: Record<string, PresentedView> = {
  TestResult: presentedView(TestResultView),
  CheckResult: presentedView(CheckResultView),
  ChangeResult: presentedView(ChangeResultView),
  FailedCommands: presentedView(FailedCommandsView),
  VoiceActions: presentedView(VoiceActionsView),
  ...Object.fromEntries(
    workResultEntries.map((entry) => [
      entry.spec.name,
      presentedView<Record<string, unknown>>(({ children, renderNode, nodes, ...props }) => {
        const key = workChildKey[entry.spec.name];
        return createElement(entry.render, {
          props: { ...props, ...(key ? { [key]: nodes } : {}) },
          renderNode: renderNode ?? (() => children),
        });
      }),
    ]),
  ),
};
