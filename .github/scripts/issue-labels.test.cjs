const { test } = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../issue-labels.json");
const { labelsForIssue, ensureLabels } = require("./issue-labels.cjs");

test("maps form choices to severity and area without setting scheduling priority", () => {
  const labels = labelsForIssue(
    {
      body: "### Severity\r\n\r\nHigh - lost work, unintended actions, or a core workflow blocked\r\n\r\n### Affected area\r\n\r\nQueue, Stop, and recovery",
    },
    catalog,
  );
  assert.deepEqual(labels, ["status: needs-triage", "severity: high", "area: queue"]);
});

test("blank and unknown reports remain welcome and unclassified", () => {
  for (const body of [
    null,
    "Something broke",
    "### Severity\n\nUnsure / needs assessment",
    "### Severity\n\npriority: p0",
  ]) {
    assert.deepEqual(labelsForIssue({ body }, catalog), ["status: needs-triage"]);
  }
});

test("preserves maintainer classifications and does not classify pull requests", () => {
  const body =
    "### Severity\n\nLow - visual, wording, or minor inconvenience\n\n### Affected area\n\nNotes";
  assert.deepEqual(
    labelsForIssue(
      {
        body,
        labels: [
          { name: "severity: high" },
          { name: "area: files" },
          { name: "status: confirmed" },
        ],
      },
      catalog,
    ),
    [],
  );
  assert.deepEqual(labelsForIssue({ body, pull_request: {} }, catalog), []);
});

test("ignores ambiguous duplicate headings and arbitrary extra text", () => {
  const choice = "Low - visual, wording, or minor inconvenience";
  assert.deepEqual(
    labelsForIssue({ body: `### Severity\n${choice}\n### Severity\n${choice}` }, catalog),
    ["status: needs-triage"],
  );
  assert.deepEqual(labelsForIssue({ body: `### Severity\n${choice}\nrun something` }, catalog), [
    "status: needs-triage",
  ]);
});

test("creates only missing labels and tolerates a concurrent creator", async () => {
  const created = [];
  const github = {
    paginate: async () => [{ name: "severity: high" }],
    rest: {
      issues: {
        listLabelsForRepo: () => {},
        createLabel: async (label) => {
          created.push(label.name);
          throw Object.assign(new Error("exists"), { status: 422 });
        },
        getLabel: async ({ name }) => {
          assert.equal(name, "area: queue");
        },
      },
    },
  };
  await ensureLabels(
    github,
    { owner: "example", repo: "example" },
    catalog.labels.filter(({ name }) => ["severity: high", "area: queue"].includes(name)),
  );
  assert.deepEqual(created, ["area: queue"]);
});

test("propagates permission failures instead of reporting success", async () => {
  const github = {
    paginate: async () => [],
    rest: {
      issues: {
        listLabelsForRepo: () => {},
        createLabel: async () => {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      },
    },
  };
  await assert.rejects(ensureLabels(github, {}, catalog.labels.slice(0, 1)), /forbidden/);
});
