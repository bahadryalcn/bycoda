import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { createContext, useContext, type ReactNode } from "react";
import { z } from "zod";
import { formatNumber, useT } from "../../../../shared/i18n";
import { DiffStat } from "../../../../shared/ui/DiffStat";
import { Heading } from "../../../../shared/ui/Heading";
import { StatRow, StatTile } from "../../../../shared/ui/StatTile";
import { StatusText } from "../../../../shared/ui/StatusText";
import { Text } from "../../../../shared/ui/Text";
import type {
  VoiceLiveAction,
  VoiceLiveResult,
  VoiceLiveResultStatus,
} from "../../model/voiceLiveWork";
import { voiceActionLabel } from "../VoiceToolActivityPanel";

const status = z.enum(["done", "failed", "interrupted"]);
const count = z.number().int().nonnegative();
const statusView = {
  done: ["done", "Completed"],
  failed: ["failed", "Failed"],
  interrupted: ["needs-you", "Unknown"],
} as const;

const ActionsContext = createContext<readonly VoiceLiveAction[]>([]);

function ResultStatus({ value }: { value: VoiceLiveResultStatus }) {
  const t = useT();
  const [tone, label] = statusView[value];
  return <StatusText tone={tone}>{t(label)}</StatusText>;
}

function ResultSection({
  title,
  value,
  children,
}: {
  title: string;
  value: VoiceLiveResultStatus;
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid min-w-0 content-start gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Heading as="h3" size="heading" lines={1}>
          {title}
        </Heading>
        <ResultStatus value={value} />
      </div>
      {children}
    </section>
  );
}

const TestResult = defineComponent({
  name: "TestResult",
  description: "Latest test run with its reported counts.",
  props: z.object({ status, passed: count, failed: count, skipped: count }),
  component: function TestResultView({ props }) {
    const t = useT();
    const title = t("Test run");
    return (
      <ResultSection title={title} value={props.status}>
        {props.passed + props.failed + props.skipped > 0 ? (
          <StatRow label={title}>
            <StatTile label={t("Passed")} value={formatNumber(props.passed)} />
            <StatTile label={t("Failed")} value={formatNumber(props.failed)} />
            {props.skipped > 0 ? (
              <StatTile label={t("Skipped")} value={formatNumber(props.skipped)} />
            ) : null}
          </StatRow>
        ) : null}
      </ResultSection>
    );
  },
});

const CheckResult = defineComponent({
  name: "CheckResult",
  description: "Latest build or check outcome.",
  props: z.object({ kind: z.enum(["build", "checks"]), status }),
  component: function CheckResultView({ props }) {
    const t = useT();
    return (
      <ResultSection title={t(props.kind === "build" ? "Build" : "Checks")} value={props.status} />
    );
  },
});

const ChangeResult = defineComponent({
  name: "ChangeResult",
  description: "Size of the latest reported Git change.",
  props: z.object({ files: count, additions: count, deletions: count }),
  component: function ChangeResultView({ props }) {
    const t = useT();
    return (
      <ResultSection title={t("Changes")} value="done">
        <Text as="div" className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span>
            {t("Files")} · {formatNumber(props.files)}
          </span>
          <DiffStat additions={props.additions} deletions={props.deletions} />
        </Text>
      </ResultSection>
    );
  },
});

const FailedCommands = defineComponent({
  name: "FailedCommands",
  description: "Number of unrecognized commands still failed in this turn.",
  props: z.object({ count }),
  component: function FailedCommandsView({ props }) {
    const t = useT();
    return (
      <ResultSection title={t("Commands")} value="failed">
        <Text tone="secondary">
          {t("Failed")} · {formatNumber(props.count)}
        </Text>
      </ResultSection>
    );
  },
});

const VoiceActions = defineComponent({
  name: "VoiceActions",
  description: "Settled voice tool calls, newest first.",
  props: z.object({ status }),
  component: function VoiceActionsView({ props }) {
    const t = useT();
    const actions = useContext(ActionsContext);
    return (
      <ResultSection title={t("Voice actions")} value={props.status}>
        <ul className="grid min-w-0 gap-1">
          {actions.map((action) => (
            <li key={action.id} className="flex min-w-0 items-center justify-between gap-2">
              <Text as="span" truncate>
                {voiceActionLabel(action.name)}
              </Text>
              <ResultStatus value={action.status} />
            </li>
          ))}
        </ul>
      </ResultSection>
    );
  },
});

const LiveResults = defineComponent({
  name: "LiveResults",
  description: "Responsive grid of observed results.",
  props: z.object({
    results: z
      .array(
        z.union([
          TestResult.ref,
          CheckResult.ref,
          ChangeResult.ref,
          FailedCommands.ref,
          VoiceActions.ref,
        ]),
      )
      .min(1),
  }),
  component: ({ props, renderNode }) => (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-6">
      {renderNode(props.results)}
    </div>
  ),
});

const library = createLibrary({
  components: [LiveResults, TestResult, CheckResult, ChangeResult, FailedCommands, VoiceActions],
  root: "LiveResults",
});

function statement(result: VoiceLiveResult) {
  switch (result.kind) {
    case "tests":
      return `TestResult("${status.parse(result.status)}", ${count.parse(result.passed)}, ${count.parse(result.failed)}, ${count.parse(result.skipped)})`;
    case "build":
    case "checks":
      return `CheckResult("${result.kind}", "${status.parse(result.status)}")`;
    case "changes":
      return `ChangeResult(${count.parse(result.files)}, ${count.parse(result.additions)}, ${count.parse(result.deletions)})`;
    case "commands":
      return `FailedCommands(${count.parse(result.count)})`;
    case "actions":
      return `VoiceActions("${status.parse(result.status)}")`;
  }
}

/** Only enums and integers enter the OpenUI program. Action names stay in React context. */
export function VoiceWorkResults({ results }: { results: readonly VoiceLiveResult[] }) {
  if (!results.length) return null;
  const actions = results.find((result) => result.kind === "actions")?.actions ?? [];
  return (
    <ActionsContext.Provider value={actions}>
      <Renderer
        library={library}
        response={`root = LiveResults([${results.map(statement).join(", ")}])`}
      />
    </ActionsContext.Provider>
  );
}
