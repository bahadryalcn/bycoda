import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exportWireSchema } from "../../../src/shared/model/host-contracts/manifest";
import { parseHostSteward } from "../../../src/features/tasks/model/hostStewards";
import * as dto from "../../../src/shared/model/host-contracts/stewards";

const input = {
  id: "steward",
  projectId: "project",
  enabled: false,
  harness: "codex",
  model: "fixture",
  modelSettings: { arbitraryProviderOption: "yes" },
  runtimeMode: "auto",
  focus: "Focus 🙂",
  scheduleKind: "daily",
  minute: 0,
  time: "09:00",
  dayOfWeek: 0,
  maxProposals: 5,
  maxOpen: 10,
  autoStart: false,
};
const stored = {
  ...input,
  autoMerge: false,
  isolate: false,
  deliveryApprovalRequired: true,
  nextRunAt: 1,
  lastRunAt: 0,
  lastRunStatus: "running",
  lastRunError: "Retained error",
  lastSessionId: "session",
  lastProposed: 0,
  declined: ["normalized title"],
  run: {
    startedAt: 0,
    workspaceId: "workspace",
    activityId: "activity",
    sessionId: "session",
    runId: "turn",
    worktreeCwd: "/checkout",
    branch: "steward/branch",
    error: "Stopping",
  },
  createdAt: 0,
  updatedAt: 1,
};

it("inventories every declared Steward input, persisted row and run field without an open record", () => {
  const source = readFileSync("src/features/tasks/model/hostStewards.ts", "utf8");
  const keys = new Set(["scheduleKind", "minute", "time", "dayOfWeek"]);
  for (const name of ["HostStewardInput", "HostSteward"]) {
    const declaration = source.match(
      new RegExp(`export type ${name} = [^\\n]*\\{([\\s\\S]*?)^\\};`, "m"),
    );
    expect(declaration, name).not.toBeNull();
    for (const field of declaration![1].matchAll(/^  ([a-zA-Z_]\w*)\??:/gm)) keys.add(field[1]);
  }
  expect(Object.keys(dto.HostStewardSchema.shape).sort()).toEqual([...keys].sort());
  const run = source.match(/export type StewardRun = \{([\s\S]*?)^\};/m)!;
  expect(Object.keys(dto.StewardRunSchema.shape).sort()).toEqual(
    [...run[1].matchAll(/^  ([a-zA-Z_]\w*)\??:/gm)].map((field) => field[1]).sort(),
  );
});

it("roundtrips complete mobile row/CAS spreads, desktop input and all actual run statuses", () => {
  expect(dto.HostStewardSchema.parse(stored)).toStrictEqual(stored);
  const mobile = { ...stored, enabled: true, expectedConfiguration: stored };
  expect(dto.StewardsSaveParamsSchema.parse({ steward: mobile })).toStrictEqual({
    steward: mobile,
  });
  expect(dto.StewardsSaveParamsSchema.parse({ steward: input })).toStrictEqual({
    steward: input,
  });
  expect(parseHostSteward(mobile)).toEqual(
    parseHostSteward({
      ...input,
      enabled: true,
      autoMerge: false,
      isolate: false,
    }),
  );
  for (const status of ["running", "succeeded", "failed", "skipped", "cancelled"])
    expect(dto.HostStewardSchema.parse({ ...stored, lastRunStatus: status }).lastRunStatus).toBe(
      status,
    );
});

it("keeps owner defaults separate from wire parsing and rejects unknown candidate/null/type variants rather than stripping", () => {
  const minimal = {
    id: input.id,
    projectId: input.projectId,
    harness: input.harness,
    model: input.model,
    runtimeMode: input.runtimeMode,
    scheduleKind: input.scheduleKind,
    time: input.time,
  };
  expect(dto.StewardSavePayloadSchema.parse(minimal)).toStrictEqual(minimal);
  expect(parseHostSteward(minimal)).toMatchObject({
    enabled: true,
    modelSettings: {},
    focus: "",
    maxProposals: 5,
    maxOpen: 10,
    autoStart: false,
  });
  for (const invalid of [
    { ...stored, candidate: { id: "unrecognized" } },
    { ...stored, run: { ...stored.run, candidateId: "unrecognized" } },
    { ...stored, run: null },
    { ...stored, lastRunStatus: "pending" },
    { ...stored, lastProposed: null },
    { ...stored, modelSettings: { option: 1 } },
    { ...stored, maxProposals: 0 },
    { ...stored, maxOpen: 31 },
    { ...stored, createdAt: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(dto.HostStewardSchema.safeParse(invalid).success).toBe(false);
  for (const invalid of [
    { ...input, expectedConfiguration: null },
    { ...input, expectedConfiguration: { ...stored, future: true } },
    { ...input, modelSettings: null },
    { ...input, focus: null },
    { ...input, run: { ...stored.run, unknown: true } },
  ])
    expect(dto.StewardSavePayloadSchema.safeParse(invalid).success).toBe(false);
  expect(dto.StewardsIdParamsSchema.safeParse({ stewardId: 1 }).success).toBe(false);
  expect(dto.StewardsDeclineParamsSchema.safeParse({ taskId: "t", extra: true }).success).toBe(
    false,
  );
});

it("exports every finite Steward schema as deterministic supported draft-2020-12 JSON Schema", () => {
  for (const schema of [
    dto.StewardsEmptyParamsSchema,
    dto.StewardsIdParamsSchema,
    dto.StewardsSaveParamsSchema,
    dto.StewardsDeclineParamsSchema,
    dto.StewardsListResultSchema,
    dto.StewardsDeleteResultSchema,
    dto.StewardsDeclineResultSchema,
  ]) {
    const first = exportWireSchema(schema);
    expect(first).toEqual(exportWireSchema(schema));
    expect(first.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  }
});
