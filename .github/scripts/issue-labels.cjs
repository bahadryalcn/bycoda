// Issue text is data: only exact, allowlisted form values can select labels.
function labelsForIssue(issue, catalog) {
  if (issue.pull_request) return [];
  const existing = (issue.labels ?? []).map((label) =>
    typeof label === "string" ? label : label.name,
  );
  const labels = existing.some((label) => label.startsWith("status: "))
    ? []
    : ["status: needs-triage"];
  const sections = new Map();
  let heading;
  let lines = [];
  const finish = () => {
    if (!heading) return;
    // Duplicate headings are ambiguous; never guess which one is authoritative.
    sections.set(heading, sections.has(heading) ? null : lines.join("\n").trim());
  };
  for (const line of (issue.body ?? "").split(/\r?\n/)) {
    const match = /^### (.+)$/.exec(line);
    if (match) {
      finish();
      heading = match[1];
      lines = [];
    } else {
      lines.push(line);
    }
  }
  finish();
  for (const [field, options] of Object.entries(catalog.fields)) {
    const value = sections.get(field);
    if (typeof value !== "string" || !Object.hasOwn(options, value)) continue;
    const label = options[value];
    const family = label.split(":")[0] + ": ";
    if (!existing.some((name) => name.startsWith(family))) labels.push(label);
  }
  return [...new Set(labels)];
}

async function ensureLabels(github, repo, definitions) {
  const existing = await github.paginate(github.rest.issues.listLabelsForRepo, {
    ...repo,
    per_page: 100,
  });
  const names = new Set(existing.map((label) => label.name));
  for (const definition of definitions) {
    if (names.has(definition.name)) continue;
    try {
      await github.rest.issues.createLabel({ ...repo, ...definition });
    } catch (error) {
      if (error.status !== 422) throw error;
      // Another issue run may have created the same label after our list read.
      await github.rest.issues.getLabel({ ...repo, name: definition.name });
    }
  }
}

module.exports = { labelsForIssue, ensureLabels };
