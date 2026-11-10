import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { RotateCcw } from "../../../shared/ui/icons";
import { Select } from "../../../shared/ui/Select";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { CrewRunView } from "../model/crewClient";
import { composerCanAssign, composerTitle } from "../model/crewComposer";
import {
  noteMembers,
  ownerRequestId,
  planAssignment,
  planNote,
  retryBlockedTask,
  retryableTasks,
  settleOwnerRequest,
} from "../model/crewOwnerActions";

export type CrewOwnerTools = {
  machineId: string;
  call: <T = unknown>(action: string, input: Record<string, unknown>) => Promise<T>;
  /** The Host runs crew tasks; without it a blocked task cannot be re-queued. */
  tasksSupported: boolean;
};

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** Runs one owner action; a failure keeps its request ID, so retrying the same input cannot duplicate. */
function useOwnerAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async (key: string | undefined, action: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await action();
      if (key) settleOwnerRequest(key);
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run };
}

/**
 * One message box for the whole work: to the lead it is a note; to a specialist or advisor
 * the owner chooses Assign (a task with the message as instructions) or Note. The Host's
 * required assignment title is the message's first line.
 */
function Composer({
  run,
  tools,
  memberId,
  onMemberChange,
}: {
  run: CrewRunView;
  tools: CrewOwnerTools;
  memberId: string;
  onMemberChange: (id: string) => void;
}) {
  const members = noteMembers(run);
  const member = members.find((agent) => agent.id === memberId);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<"assign" | "note">("assign");
  const [sent, setSent] = useState(false);
  const action = useOwnerAction();
  const mode = composerCanAssign(run, member) ? choice : "note";
  const title = composerTitle(text);
  const assignKey = JSON.stringify(["assign", run.id, memberId, title, text.trim()]);
  const noteKey = JSON.stringify(["note", run.id, memberId, text.trim()]);
  const key = mode === "assign" ? assignKey : noteKey;
  const plan =
    mode === "assign"
      ? planAssignment(run, { memberId, title, prompt: text, requestId: "" })
      : planNote(run, { memberId, note: text, requestId: "" });
  if (!members.length) return null;
  const send = () =>
    action
      .run(key, () => {
        if (mode === "assign") {
          const built = planAssignment(run, {
            memberId,
            title,
            prompt: text,
            requestId: ownerRequestId(key),
          });
          return built.ok
            ? tools.call("crews.assign", built.params)
            : Promise.reject(new Error("Invalid input"));
        }
        const built = planNote(run, { memberId, note: text, requestId: ownerRequestId(key) });
        return built.ok
          ? tools.call("crews.request", built.params)
          : Promise.reject(new Error("Invalid input"));
      })
      .then((ok) => {
        if (!ok) return;
        setText("");
        setSent(mode === "note");
      });
  return (
    <div className="mt-3 flex max-w-[46rem] flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <Select
            label={t("Send to")}
            value={memberId}
            options={members.map((agent) => ({ value: agent.id, label: agent.name }))}
            onValueChange={(id) => {
              onMemberChange(id);
              setSent(false);
            }}
          />
        </div>
        {composerCanAssign(run, member) ? (
          <SegmentedControl
            label={t("Message type")}
            value={mode}
            options={[
              { value: "assign", label: t("Assign") },
              { value: "note", label: t("Note") },
            ]}
            onValueChange={(value) => setChoice(value === "note" ? "note" : "assign")}
          />
        ) : null}
      </div>
      <TextareaField
        label={t("Message")}
        hideLabel
        placeholder={t("Write a message")}
        minRows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
      />
      {action.error ? <InlineMessage tone="danger">{action.error}</InlineMessage> : null}
      {sent ? <InlineMessage tone="success">{t("Note sent to the lead.")}</InlineMessage> : null}
      <div>
        <Button
          size="sm"
          variant="primary"
          disabled={!plan.ok}
          loading={action.pending}
          onClick={() => void send()}
        >
          {mode === "assign" ? t("Assign") : t("Send")}
        </Button>
      </div>
    </div>
  );
}

function RetryList({ run, tools }: { run: CrewRunView; tools: CrewOwnerTools }) {
  const action = useOwnerAction();
  const [retrying, setRetrying] = useState("");
  const blocked = tools.tasksSupported ? retryableTasks(run) : [];
  if (!blocked.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1">
      {blocked.map((task) => (
        <div key={task.id} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui-secondary">{task.title}</span>
          <Button
            size="sm"
            variant="secondary"
            startIcon={<RotateCcw className="icon-sm" />}
            disabled={action.pending}
            loading={action.pending && retrying === task.id}
            onClick={() => {
              setRetrying(task.id);
              void action
                .run(undefined, () => retryBlockedTask(tools.machineId, task.id))
                // A read through the crew client refreshes the work list with the re-queued task.
                .then(() => tools.call("crews.get", { runId: run.id }))
                .catch(() => undefined);
            }}
          >
            {t("Retry")}
          </Button>
        </div>
      ))}
      {action.error ? <InlineMessage tone="danger">{action.error}</InlineMessage> : null}
    </div>
  );
}

/** Owner controls for one work, each through an existing Host operation: message, assign, retry. */
export function CrewWorkOwnerActions({
  run,
  tools,
  memberId,
  onMemberChange,
}: {
  run: CrewRunView;
  tools: CrewOwnerTools;
  /** The member the message goes to; the team strip changes it. */
  memberId: string;
  onMemberChange: (id: string) => void;
}) {
  useLocale();
  if (run.status === "finished") return null;
  return (
    <>
      <RetryList run={run} tools={tools} />
      <Composer
        key={run.id}
        run={run}
        tools={tools}
        memberId={memberId}
        onMemberChange={onMemberChange}
      />
    </>
  );
}
