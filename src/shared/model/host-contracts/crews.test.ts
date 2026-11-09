// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { declaredTypeKeys } from "../../../../scripts/checks/host-rpc-source-fixture.mjs";
import { exportWireSchema } from "./manifest";
import * as dto from "./crews";
import { HostCrews } from "../../../../host/crews/crews";
import { HostStore } from "../../../../host/store";
import type { HostTasks } from "../../../../host/tasks/tasks";
import type { HostEngine } from "../../../../host/engine";
import type { HostTask } from "../../../features/tasks/model/hostTasks";
import {
  CREW_CAPABILITIES,
  defaultCrewPolicy,
  parseCrewAgent,
  parseCrewDefinition,
} from "../../../features/crews/model/crew";

const candidate = {
  id: "candidate",
  harness: "codex" as const,
  model: "codex:fixture",
  modelSettings: { effort: "high" },
  capabilities: {
    code: {
      state: "unknown" as const,
      observedAt: 0.5,
      source: "owner declaration",
    },
  },
  cost: 1.25,
  quality: 88.5,
  qualitySource: "owner-estimate" as const,
  samples: 3,
};
const agent = (id: string, role: "coordinator" | "specialist" | "reviewer") => ({
  id,
  name: id,
  role,
  instructions: `${id} private instructions`,
  selection: "fixed" as const,
  candidates: [{ ...candidate, id: `${id}-candidate` }],
  groups: ["UI", "Mobile"],
  source: { id: "library", updatedAt: 2.5 },
});
const definition = {
  id: "crew",
  name: "Fixture Crew",
  projectId: "project",
  agents: [
    agent("lead", "coordinator"),
    agent("worker", "specialist"),
    agent("reviewer", "reviewer"),
  ],
  policy: {
    ...defaultCrewPolicy,
    maxEstimatedCost: 100,
    minimumQuality: 50,
    costWeight: 0.3,
    qualityWeight: 0.7,
    delegateApprovals: true,
  },
  updatedAt: 3.5,
};
const assignment = {
  id: "assignment",
  memberId: "worker",
  taskId: "task",
  title: "Task",
  files: ["src"],
  integration: false,
  candidate,
  reason: "Selected",
  estimatedCost: 2.5,
  requestFingerprint: "assignment-fingerprint",
};
const message = {
  id: "message",
  from: "owner",
  text: "Directive",
  taskId: "task",
  createdAt: 1,
  resolvedAt: 2,
};
const rawRun = {
  id: "run",
  projectId: "project",
  definition,
  status: "paused" as const,
  title: "Work",
  sourceTaskId: "source",
  requestedBySessionId: "owner-session",
  coordinatorSessionId: "coordinator",
  coordinatorCandidate: candidate,
  launch: { candidate, runtimeMode: "auto" as const, prompt: "private launch" },
  requestFingerprint: "run-fingerprint",
  assignments: [assignment],
  messages: [message],
  notifications: { task: "notification-hash" },
  pendingDelivery: {
    commandId: "pending-send",
    text: "private pending prompt",
    notifications: { task: "hash" },
  },
  createdAt: 1,
  updatedAt: 2,
  error: "retained error",
};
const catalog = {
  models: {
    codex: [
      {
        id: "codex:fixture",
        harness: "codex" as const,
        name: "Fixture",
        nativeId: "native",
        aliasTarget: "moving-alias-target",
        provider: { id: "upstream", name: "Upstream" },
        contextWindow: 128000,
        settings: [
          {
            id: "effort",
            label: "Effort",
            kind: "select" as const,
            value: "high",
            options: [{ value: "high", label: "High" }],
            description: "Provider setting",
          },
        ],
      },
    ],
  },
  errors: { claude: "Fixture unavailable" },
  pending: ["pi" as const],
};
const question = {
  requestId: 8,
  occurrenceId: "11111111-1111-4111-8111-111111111111",
  title: "Choose",
  questions: [
    {
      id: "q",
      header: "Header",
      prompt: "Question?",
      multiSelect: false,
      allowCustom: true,
      preserveCustomWhitespace: true,
      options: [{ id: "o", label: "Option", description: "Description", literal: true }],
    },
  ],
  behavior: "nonBlocking" as const,
  dismissAction: "decline" as const,
  providerTurnId: "provider-turn",
  callId: "call",
  delivery: "unknown" as const,
  error: "Pending transport",
  autoResolveAt: 9999,
};
// Delegated approval replies must echo the source-issued occurrence (UUID v4) of the pending request.
const approvalOccurrenceId = "7d5b2a52-3f0c-4a6e-9c1d-2b8e5f4a9c10";

const params = {
  "crews.list": { projectId: "project" },
  "crews.schema": { projectId: "project" },
  "crews.inspect": {
    projectId: "project",
    definitionId: "crew",
    memberId: "worker",
  },
  "crews.save": { projectId: "project", definition, expectedUpdatedAt: 3.5 },
  "crews.delete": { projectId: "project", definitionId: "crew" },
  "crews.deleteRun": {
    projectId: "project",
    runId: "run",
    expectedUpdatedAt: 2,
  },
  "crews.agent.save": {
    projectId: "project",
    agent: {
      ...agent("profile", "specialist"),
      projectId: "project",
      updatedAt: 2.5,
    },
    expectedUpdatedAt: 2.5,
  },
  "crews.agent.delete": { projectId: "project", agentId: "profile" },
  "crews.start": {
    projectId: "project",
    definitionId: "crew",
    prompt: " Original prompt \n",
    requestId: "retained-request",
    newConversation: false,
  },
  "crews.get": { projectId: "project", runId: "run" },
  "crews.assign": {
    projectId: "project",
    runId: "run",
    requestId: "assignment",
    memberId: "worker",
    title: "Task",
    prompt: "Implement",
    files: ["src"],
    integration: false,
    required: ["code"],
    dependsOn: ["existing-task"],
    verifyCommand: "pnpm test",
  },
  "crews.request": {
    projectId: "project",
    runId: "run",
    requestId: "message",
    text: " Original directive \n",
  },
  "crews.resolve": { projectId: "project", runId: "run", requestId: "message" },
  "crews.respond": {
    projectId: "project",
    runId: "run",
    sessionId: "worker",
    targetRunId: "turn",
    requestId: "respond",
    approvalId: 7,
    approvalOccurrenceId,
    decision: "allow",
  },
  "crews.answer": {
    projectId: "project",
    runId: "run",
    sessionId: "worker",
    targetRunId: "turn",
    requestId: "answer",
    questionId: 8,
    replyJson: '{ "kind":"answered", "answers":{"q":["o"]} }',
  },
  "crews.pause": { projectId: "project", runId: "run" },
  "crews.stop": { projectId: "project", runId: "run" },
  "crews.resume": { projectId: "project", runId: "run" },
  "crews.accept": { projectId: "project", runId: "run", taskId: "task" },
  "crews.finish": { projectId: "project", runId: "run" },
};

function declaredKeys(path: string, name: string): string[] {
  return declaredTypeKeys(readFileSync(path, "utf8"), name);
}
it("inventories all declared Crew/candidate/policy/run and catalog/question fields with no whole-Crew JSON boundary", () => {
  const source = "src/features/crews/model/crew.ts";
  for (const [name, schema] of [
    ["CrewCandidate", dto.CrewCandidateSchema],
    ["CrewAgent", dto.CrewAgentSchema],
    ["CrewPolicy", dto.CrewPolicySchema],
    ["CrewDefinition", dto.CrewDefinitionSchema],
    ["CrewMessage", dto.CrewMessageSchema],
    ["CrewAssignment", dto.CrewAssignmentSchema],
    ["CrewRun", dto.CrewRunSchema],
  ] as const)
    expect(Object.keys(schema.shape).sort()).toEqual(declaredKeys(source, name));
  expect(Object.keys(dto.SavedCrewAgentSchema.shape).sort()).toEqual(
    [...Object.keys(dto.CrewAgentSchema.shape), "projectId", "updatedAt"].sort(),
  );
  expect(Object.keys(dto.CrewCapabilitiesSchema.shape).sort()).toEqual(
    [...CREW_CAPABILITIES].sort(),
  );
  for (const [name, schema] of [
    ["AgentModel", dto.CrewCatalogModelSchema],
    ["ModelSetting", dto.CrewModelSettingSchema],
    ["ModelSettingChoice", dto.CrewModelSettingChoiceSchema],
  ] as const)
    expect(Object.keys(schema.shape).sort()).toEqual(
      declaredKeys("src/features/sessions/model/models.ts", name),
    );
  for (const [name, schema] of [
    ["UserQuestionPrompt", dto.CrewUserQuestionPromptSchema],
    ["UserQuestion", dto.CrewUserQuestionSchema],
    ["UserQuestionOption", dto.CrewUserQuestionOptionSchema],
  ] as const)
    expect(Object.keys(schema.shape).sort()).toEqual(
      declaredKeys("src/shared/model/userQuestion.ts", name),
    );
});

it("roundtrips all20 complete params without defaults, coercions or request-fingerprint normalization", () => {
  expect(Object.keys(dto.CREWS_RPC_SCHEMAS).sort()).toEqual(Object.keys(params).sort());
  for (const [method, schema] of Object.entries(dto.CREWS_RPC_SCHEMAS)) {
    const value = params[method as keyof typeof params];
    expect(schema.params.parse(value)).toStrictEqual(value);
    const { projectId: _scope, ...unscoped } = value;
    expect(schema.params.safeParse(unscoped).success).toBe(false);
    expect(schema.params.safeParse({ ...value, principal: { sessionId: "forged" } }).success).toBe(
      false,
    );
  }
  expect(
    dto.CrewsDeleteParamsSchema.safeParse({
      projectId: "project",
      definitionId: "crew",
    }).success,
  ).toBe(true);
  expect(
    dto.CrewsDeleteRunParamsSchema.safeParse({
      projectId: "project",
      runId: "run",
    }).success,
  ).toBe(false);
  expect(
    dto.CrewsAgentDeleteParamsSchema.safeParse({
      projectId: "project",
      agentId: "profile",
      expectedUpdatedAt: 1,
    }).success,
  ).toBe(false);
  const { targetRunId: _target, ...withoutTarget } = params["crews.respond"];
  expect(dto.CrewsRespondParamsSchema.parse(withoutTarget)).toStrictEqual(withoutTarget);
});

it("preserves object/JSON-string alternatives, full saved metadata and input/template revision differences", () => {
  const { updatedAt: _revision, ...template } = definition;
  expect(dto.CrewDefinitionTemplateSchema.parse(template)).toStrictEqual(template);
  expect(dto.CrewDefinitionTemplateSchema.safeParse(definition).success).toBe(false);
  expect(dto.CrewDefinitionInputSchema.parse(template)).toStrictEqual(template);
  expect(dto.CrewDefinitionSchema.safeParse(template).success).toBe(false);
  for (const value of [
    {
      projectId: "project",
      definitionJson: JSON.stringify(definition, null, 2),
    },
    {
      projectId: "project",
      definition,
      definitionJson: "ignored when object exists",
      expectedUpdatedAt: 3.5,
    },
  ])
    expect(dto.CrewsSaveParamsSchema.parse(value)).toStrictEqual(value);
  const saved = {
    ...agent("profile", "specialist"),
    projectId: "project",
    updatedAt: 8.5,
  };
  for (const value of [
    { projectId: "project", agent: saved },
    {
      projectId: "project",
      agentJson: JSON.stringify(saved, null, 2),
      expectedUpdatedAt: 8.5,
    },
  ])
    expect(dto.CrewsAgentSaveParamsSchema.parse(value)).toStrictEqual(value);
  expect(dto.CrewsSaveParamsSchema.safeParse({ projectId: "project" }).success).toBe(false);
  expect(dto.CrewsAgentSaveParamsSchema.safeParse({ projectId: "project" }).success).toBe(false);
  expect(dto.CrewAgentSchema.parse(agent("worker", "specialist"))).toStrictEqual(
    agent("worker", "specialist"),
  );
  expect(parseCrewAgent(agent("worker", "specialist")).source?.updatedAt).toBe(2.5);
  expect(parseCrewDefinition(template).updatedAt).toBe(0);
});

it("keeps raw mutation runs separate from declared sanitized read views and genuine Task nullability", () => {
  expect(dto.CrewRunSchema.parse(rawRun)).toStrictEqual(rawRun);
  const { launch: _launch, pendingDelivery: _pending, ...visible } = rawRun;
  const view = {
    ...visible,
    definition: {
      ...definition,
      agents: definition.agents.map((a) => ({ ...a, instructions: "" })),
    },
    tasks: [],
    coordinatorStatus: "idle",
  };
  expect(dto.CrewRunViewSchema.parse(view)).toStrictEqual(view);
  expect(dto.CrewRunViewSchema.safeParse({ ...view, launch: rawRun.launch }).success).toBe(false);
  expect(
    dto.CrewRunViewSchema.safeParse({
      ...view,
      pendingDelivery: rawRun.pendingDelivery,
    }).success,
  ).toBe(false);
  expect(dto.CrewRunViewSchema.safeParse({ ...view, definition }).success).toBe(false);
  const task = {
    id: "task",
    projectId: "project",
    title: "Task",
    prompt: "",
    harness: "codex",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    status: "review",
    createdAt: 0,
    updatedAt: 1,
    reviewNotes: [],
    verification: { command: { exitCode: null, output: "", timedOut: false } },
  };
  expect(dto.CrewTaskViewSchema.parse(task)).toStrictEqual(task);
  expect(dto.CrewTaskViewSchema.safeParse({ ...task, prompt: "private" }).success).toBe(false);
  expect(dto.CrewTaskViewSchema.safeParse({ ...task, retryFeedback: "private" }).success).toBe(
    false,
  );
});

it("preserves finite provider settings/candidate evidence and full approval/question structures while rejecting invented fields/nulls", () => {
  expect(dto.CrewModelCatalogSchema.parse(catalog)).toStrictEqual(catalog);
  const inspected = {
    catalog,
    agent: agent("worker", "specialist"),
    candidates: [
      {
        ...candidate,
        observations: { count: 3, accepted: 1, passed: 2 },
        imageGeneration: false,
      },
    ],
  };
  expect(dto.CrewInspectResultSchema.parse(inspected)).toStrictEqual(inspected);
  expect(dto.CrewInspectResultSchema.parse({ catalog })).toStrictEqual({
    catalog,
  });
  const approval = {
    taskId: "task",
    sessionId: "worker",
    approval: { requestId: 0, decided: "cancelled" },
    text: "Approval text",
  };
  expect(dto.CrewPendingInputSchema.parse(approval)).toStrictEqual(approval);
  const pendingQuestion = {
    taskId: "task",
    sessionId: "worker",
    targetRunId: "turn",
    question,
  };
  expect(dto.CrewPendingInputSchema.parse(pendingQuestion)).toStrictEqual(pendingQuestion);
  expect(
    dto.CrewUserQuestionPromptSchema.safeParse({ ...question, occurrenceId: "invented" }).success,
  ).toBe(false);
  expect(
    dto.CrewUserQuestionPromptSchema.safeParse({ ...question, occurrenceId: undefined }).success,
  ).toBe(true);
  for (const value of [
    { ...candidate, future: true },
    { ...candidate, qualitySource: "benchmark" },
    { ...candidate, quality: null },
    {
      ...candidate,
      capabilities: {
        remoteExecution: {
          state: "available",
          observedAt: 1,
          source: "forged",
        },
      },
    },
  ])
    expect(dto.CrewCandidateSchema.safeParse(value).success).toBe(false);
  expect(
    dto.CrewModelCatalogSchema.safeParse({
      ...catalog,
      models: { futureProvider: [] },
    }).success,
  ).toBe(false);
  expect(
    dto.CrewModelCatalogSchema.safeParse({
      ...catalog,
      models: {
        codex: [
          {
            ...catalog.models.codex[0],
            provider: { id: "p", name: "P", secret: "no" },
          },
        ],
      },
    }).success,
  ).toBe(false);
  expect(
    dto.CrewPendingInputSchema.safeParse({
      ...approval,
      approval: { requestId: 0, decided: false },
    }).success,
  ).toBe(false);
  expect(dto.CrewUserQuestionPromptSchema.safeParse({ ...question, behavior: null }).success).toBe(
    false,
  );
  expect(dto.CrewRunSchema.safeParse({ ...rawRun, launch: null }).success).toBe(false);
});

it("exports all40 per-method schemas deterministically through the existing portable draft-2020-12 exporter", () => {
  for (const pair of Object.values(dto.CREWS_RPC_SCHEMAS))
    for (const schema of [pair.params, pair.result]) {
      const exported = exportWireSchema(schema);
      expect(exported).toEqual(exportWireSchema(schema));
      expect(exported.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
it("validates actual isolated HostCrews outputs for every paired method, including raw results and sanitized detail", async () => {
  const store = new HostStore(":memory:");
  cleanups.push(() => store.close());
  const project = await store.addProject("/crew-contract-fixture", "Fixture");
  let status: "idle" | "running" = "running";
  vi.spyOn(store, "sessionStateMetadata").mockImplementation(async () => ({ status }) as never);
  vi.spyOn(store, "session").mockImplementation(
    async (id) =>
      ({
        projectId: project.id,
        revision: 1,
        updatedAt: 1,
        status,
        runId: "turn",
        session: {
          id,
          title: "Fixture",
          cwd: "/crew-contract-fixture",
          harness: "codex",
          model: "codex:fixture",
          modelSettings: {},
          runtimeMode: "supervised",
          blocks: [
            {
              id: "approval",
              role: "assistant",
              text: "Approval text",
              approval: { requestId: 7, occurrenceId: approvalOccurrenceId },
            },
          ],
          pendingQuestion: question,
        },
      }) as never,
  );
  const rows: HostTask[] = [];
  const tasks = {
    ready: Promise.resolve(),
    list: async () => rows,
    tick: vi.fn(),
    save: vi.fn(async (input) => {
      const row = {
        ...input,
        createdAt: 1,
        updatedAt: 1,
        reviewNotes: [],
      } as HostTask;
      rows.push(row);
      return row;
    }),
    acceptCrewTask: vi.fn(async (id) => {
      const row = rows.find((task) => task.id === id)!;
      row.status = "done";
      return row;
    }),
  };
  const engine = {
    command: vi.fn(async (command) => ({
      commandId: command.commandId,
      sessionId: command.sessionId ?? "coordinator",
      revision: 1,
      runId: "turn",
    })),
    updateSession: vi.fn(async () => {}),
  };
  const owner = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    async () => catalog,
    () => 1000,
  );
  cleanups.push(() => owner.close());
  const covered = new Set<string>();
  const call = async (
    method: keyof typeof dto.CREWS_RPC_SCHEMAS,
    args: Record<string, unknown> = {},
  ) => {
    const input = { projectId: project.id, ...args };
    dto.CREWS_RPC_SCHEMAS[method].params.parse(input);
    const raw = await owner.call(method, args, project.id);
    const json = JSON.parse(JSON.stringify(raw));
    expect(dto.CREWS_RPC_SCHEMAS[method].result.parse(json), method).toStrictEqual(json);
    covered.add(method);
    return json;
  };
  const schema = await call("crews.schema");
  expect(schema.definition.updatedAt).toBeUndefined();
  const saved = await call("crews.save", {
    definition: { ...definition, projectId: project.id },
  });
  const savedAgent = await call("crews.agent.save", {
    agent: { ...agent("profile", "specialist"), projectId: project.id },
  });
  await call("crews.inspect");
  await call("crews.inspect", { definitionId: saved.id, memberId: "worker" });
  const started = await call("crews.start", {
    definitionId: saved.id,
    prompt: "Private launch work",
    requestId: "run",
  });
  expect(started.launch?.prompt).toContain("Private launch work");
  const assigned = await call("crews.assign", {
    runId: started.id,
    requestId: "assignment",
    memberId: "worker",
    title: "Task",
    prompt: "Private task",
    files: ["src"],
  });
  const task = rows.find((row) => row.id === assigned.taskId)!;
  task.sessionId = "worker";
  task.status = "review";
  task.verification = {
    review: { verdict: "pass", note: "Reviewed", sessionId: "reviewer" },
  };
  const directory = await call("crews.list");
  const visible = directory.runs.find((run) => run.id === started.id);
  expect(visible.launch).toBeUndefined();
  expect(visible.definition.agents.every((member) => member.instructions === "")).toBe(true);
  const detail = await call("crews.get", { runId: started.id });
  expect(detail.pendingInputs).toHaveLength(2);
  const request = await call("crews.request", {
    runId: started.id,
    requestId: "message",
    text: "Owner directive",
  });
  await call("crews.resolve", { runId: started.id, requestId: request.id });
  await call("crews.respond", {
    runId: started.id,
    sessionId: "worker",
    targetRunId: "turn",
    requestId: "respond",
    approvalId: 7,
    approvalOccurrenceId,
    decision: "allow",
  });
  await call("crews.answer", {
    runId: started.id,
    sessionId: "worker",
    targetRunId: "turn",
    requestId: "answer",
    questionId: 8,
    replyJson: JSON.stringify({ kind: "answered", answers: { q: ["o"] } }),
  });
  await call("crews.pause", { runId: started.id });
  await call("crews.resume", { runId: started.id });
  await call("crews.stop", { runId: started.id });
  await call("crews.accept", { runId: started.id, taskId: task.id });
  await call("crews.finish", { runId: started.id });
  status = "idle";
  const finished = (await call("crews.list")).runs.find((run) => run.id === started.id);
  await call("crews.deleteRun", {
    runId: started.id,
    expectedUpdatedAt: finished.updatedAt,
  });
  await call("crews.agent.delete", { agentId: savedAgent.id });
  await call("crews.delete", {
    definitionId: saved.id,
    expectedUpdatedAt: saved.updatedAt,
  });
  expect([...covered].sort()).toEqual(Object.keys(dto.CREWS_RPC_SCHEMAS).sort());
});
