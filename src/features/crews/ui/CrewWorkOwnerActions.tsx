import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { RotateCcw } from "../../../shared/ui/icons";
import { Select } from "../../../shared/ui/Select";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import type { CrewRunView } from "../model/crewClient";
import {
  assignableMembers,
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

function AssignForm({ run, tools }: { run: CrewRunView; tools: CrewOwnerTools }) {
  const members = assignableMembers(run);
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const action = useOwnerAction();
  const key = JSON.stringify(["assign", run.id, memberId, title.trim(), prompt.trim()]);
  const plan = planAssignment(run, { memberId, title, prompt, requestId: "" });
  if (!members.length) return null;
  return (
    <Disclosure className="mt-3" size="sm" summary={t("Assign to member")}>
      <div className="mt-2 flex max-w-[46rem] flex-col gap-2">
        <Select
          label={t("Member")}
          value={memberId}
          options={members.map((agent) => ({ value: agent.id, label: agent.name }))}
          onValueChange={setMemberId}
        />
        <TextField label={t("Title")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextareaField
          label={t("Instructions")}
          minRows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {action.error ? <InlineMessage tone="danger">{action.error}</InlineMessage> : null}
        <div>
          <Button
            size="sm"
            variant="primary"
            disabled={!plan.ok}
            loading={action.pending}
            onClick={() =>
              void action
                .run(key, () => {
                  const built = planAssignment(run, {
                    memberId,
                    title,
                    prompt,
                    requestId: ownerRequestId(key),
                  });
                  return built.ok
                    ? tools.call("crews.assign", built.params)
                    : Promise.reject(new Error("Invalid input"));
                })
                .then((ok) => {
                  if (!ok) return;
                  setTitle("");
                  setPrompt("");
                })
            }
          >
            {t("Assign")}
          </Button>
        </div>
      </div>
    </Disclosure>
  );
}

function NoteForm({ run, tools }: { run: CrewRunView; tools: CrewOwnerTools }) {
  const members = noteMembers(run);
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const action = useOwnerAction();
  const key = JSON.stringify(["note", run.id, memberId, note.trim()]);
  const plan = planNote(run, { memberId, note, requestId: "" });
  if (!members.length) return null;
  return (
    <Disclosure className="mt-3" size="sm" summary={t("Send note to member")}>
      <div className="mt-2 flex max-w-[46rem] flex-col gap-2">
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("The note goes to the lead, who passes it to the member.")}
        </p>
        <Select
          label={t("Member")}
          value={memberId}
          options={members.map((agent) => ({ value: agent.id, label: agent.name }))}
          onValueChange={setMemberId}
        />
        <TextareaField
          label={t("Note")}
          minRows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
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
            onClick={() =>
              void action
                .run(key, () => {
                  const built = planNote(run, { memberId, note, requestId: ownerRequestId(key) });
                  return built.ok
                    ? tools.call("crews.request", built.params)
                    : Promise.reject(new Error("Invalid input"));
                })
                .then((ok) => {
                  if (!ok) return;
                  setNote("");
                  setSent(true);
                })
            }
          >
            {t("Send note")}
          </Button>
        </div>
      </div>
    </Disclosure>
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

/** Owner controls for one work, each through an existing Host operation: assign, note, retry. */
export function CrewWorkOwnerActions({ run, tools }: { run: CrewRunView; tools: CrewOwnerTools }) {
  useLocale();
  if (run.status === "finished") return null;
  return (
    <>
      <RetryList run={run} tools={tools} />
      <AssignForm key={`assign:${run.id}`} run={run} tools={tools} />
      <NoteForm key={`note:${run.id}`} run={run} tools={tools} />
    </>
  );
}
