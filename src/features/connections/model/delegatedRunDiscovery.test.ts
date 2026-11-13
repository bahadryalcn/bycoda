// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { Session } from "../../sessions";
import type { HostSession, HostSessionSummary, RemoteMachine } from "./protocol";
import { discoverDelegatedRuns, type DelegatedDiscoveryPort } from "./delegatedRunDiscovery";
import { rememberRemoteSession, remoteSessionFor } from "./connections";

it("copies the live child's questions without mutating the Host snapshot and clears stale input", async () => {
  const parent = { id: "parent", cwd: "/project" } as Session;
  const question = { requestId: 7, questions: [{ id: "q", prompt: "Choose" }] };
  const host = {
    projectId: "project",
    revision: 1,
    status: "running",
    updatedAt: 1,
    session: {
      id: "child",
      cwd: "/project",
      title: "Child",
      blocks: [
        { id: "prompt", role: "user", text: "Work" },
        { id: "step", role: "tool", text: "Reading files" },
      ],
      modelSettings: {
        delegationParent: JSON.stringify({
          parentSessionId: "parent",
          runId: "run",
          kind: "advisor",
          model: "m",
          startedAt: 1,
        }),
      },
      pendingQuestion: question,
      submittedQuestions: [{ requestId: 3 }],
    },
  } as unknown as HostSession;
  const port: DelegatedDiscoveryPort = {
    host: async () => ({
      machine: { id: "machine", environmentId: "env" } as RemoteMachine,
      projectId: "project",
    }),
    list: async () => [{ id: "child" } as HostSessionSummary],
    read: async () => host,
  };
  const known = new Map<string, HostSession>();
  const [child] = await discoverDelegatedRuns(parent, port, known, () => true);
  expect(remoteSessionFor(child.id)).toBe("child");
  expect(child.blocks).toEqual(host.session.blocks);
  expect(child.continuingElsewhere).toBe(true);
  expect(child.pendingQuestion).toEqual(question);
  expect(child.submittedQuestions).toEqual(host.session.submittedQuestions);
  expect(child.pendingQuestion).not.toBe(host.session.pendingQuestion);
  expect(child.submittedQuestions).not.toBe(host.session.submittedQuestions);
  child.pendingQuestion!.questions[0].prompt = "Changed locally";
  expect(question.questions[0].prompt).toBe("Choose");
  host.session.pendingQuestion = undefined;
  host.session.submittedQuestions = undefined;
  host.session.blocks = [...host.session.blocks, { id: "reply", role: "assistant", text: "Done" }];
  host.status = "idle";
  host.revision = 2;
  const [updated] = await discoverDelegatedRuns(parent, port, known, () => true);
  expect(updated.pendingQuestion).toBeUndefined();
  expect(updated.submittedQuestions).toBeUndefined();
  expect(updated.blocks.map((block) => block.id)).toEqual(["prompt", "step", "reply"]);
  expect(updated.continuingElsewhere).toBeUndefined();
  rememberRemoteSession("other-shell", "child");
  await expect(discoverDelegatedRuns(parent, port, known, () => true)).rejects.toThrow(
    "bound to another session",
  );
  expect(remoteSessionFor("other-shell")).toBe("child");
});

it("remembers a listed session that is not this parent's child, so the next poll asks by revision", async () => {
  const parent = { id: "parent", cwd: "/project" } as Session;
  const unrelated = {
    projectId: "project",
    revision: 4,
    status: "idle",
    updatedAt: 1,
    session: { id: "stray", cwd: "/project", title: "Stray", blocks: [] },
  } as unknown as HostSession;
  const reads: (HostSession | undefined)[] = [];
  const port: DelegatedDiscoveryPort = {
    host: async () => ({
      machine: { id: "machine", environmentId: "env" } as RemoteMachine,
      projectId: "project",
    }),
    list: async () => [{ id: "stray" } as HostSessionSummary],
    read: async (_machine, _id, known) => {
      reads.push(known);
      return unrelated;
    },
  };
  const known = new Map<string, HostSession>();
  expect(await discoverDelegatedRuns(parent, port, known, () => true)).toEqual([]);
  expect(await discoverDelegatedRuns(parent, port, known, () => true)).toEqual([]);
  expect(reads).toEqual([undefined, unrelated]);
});
