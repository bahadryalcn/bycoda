import { expect, it } from "vitest";
import { t } from "../../../shared/i18n";
import { inspectCommand } from "./commandInspection";
import type { Block } from "./session";
import { sshTranscript, type SshActivity } from "./sshTranscript";
import { toolCallState } from "./transcriptActivity";

const project = (blocks: Block[], activity: SshActivity[]) => sshTranscript(blocks, activity, t);

const receipt: SshActivity = {
  requestId: "ssh-1",
  command: "printf 'ready'",
  startedAt: 120,
  state: "running",
  output: "rea",
  exitCode: null,
  remoteOutcomeUnknown: false,
  truncated: false,
};
const first: Block = { id: "u1", role: "user", text: "Check the host", startedAt: 100 };
const reply: Block = { id: "a1", role: "assistant", text: "Host ready" };
const followUp: Block = { id: "u2", role: "user", text: "Thanks", startedAt: 200 };

it("keeps the SSH command with its user turn, even after a follow-up", () => {
  const [user, command, assistant, next] = project([first, reply, followUp], [receipt]);
  expect([user, assistant, next]).toEqual([first, reply, followUp]);
  expect(toolCallState(command!)).toBe("pending");
  expect(inspectCommand(command!, true)).toMatchObject({
    command: { exact: true, text: receipt.command },
    output: "rea",
    lifecycle: "running",
  });
  const completed = project(
    [first, reply, followUp],
    [{ ...receipt, state: "exited", exitCode: 0, output: "ready", truncated: true }],
  )[1]!;
  expect(completed.id).toBe(command!.id);
  expect(inspectCommand(completed, false)).toMatchObject({
    output: "ready",
    outputTruncated: true,
    lifecycle: "done",
  });
});

it("does not attach receipts to a different conversation turn after a rewind", () => {
  const blocks = [followUp, { ...first, id: "draft", draft: true }];
  expect(project(blocks, [receipt])).toBe(blocks);
});

it("waits for native approval before showing a command as running", () => {
  const blocks = [first];
  expect(project(blocks, [{ ...receipt, state: "pendingApproval" }])).toBe(blocks);
});

it("keeps failure and unknown remote outcome distinct from success", () => {
  const failed = project([first], [{ ...receipt, state: "exited", exitCode: 3 }])[1]!;
  expect(inspectCommand(failed, false)).toMatchObject({ lifecycle: "failed", output: "rea" });
  const unknown = project([first], [{ ...receipt, remoteOutcomeUnknown: true }])[1]!;
  expect(inspectCommand(unknown, true).lifecycle).toBe("interrupted");
});
