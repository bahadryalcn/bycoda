/** Optional operator workflow validation with Python/PyYAML + actionlint.
 * actionlint v1.7.12 predates concurrency.queue (GitHub added it May 2026).
 * Validate only that documented extension, then lint all remaining source intact.
 * https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const queueNormalizer = String.raw`
import json,re,sys,yaml
text=sys.stdin.read()
root=yaml.compose(text,Loader=yaml.BaseLoader)
def pairs(node):
    assert isinstance(node,yaml.MappingNode),'Expected YAML mapping'
    keys=[key.value for key,_ in node.value]
    assert len(keys)==len(set(keys)),'Duplicate YAML mapping key'
    return dict((key.value,(key,value)) for key,value in node.value)
top=pairs(root)
contexts=[]
if 'concurrency' in top: contexts.append(('<workflow>',top['concurrency'][1]))
if 'jobs' in top:
    for name,(_,job) in pairs(top['jobs'][1]).items():
        fields=pairs(job)
        if 'concurrency' in fields: contexts.append((name,fields['concurrency'][1]))
lines=text.splitlines(keepends=True)
remove=set(); checked=[]
for name,node in contexts:
    if not isinstance(node,yaml.MappingNode): continue
    fields=pairs(node)
    if 'queue' not in fields: continue
    key,value=fields['queue']
    assert isinstance(value,yaml.ScalarNode) and value.value=='max','Only documented queue:max is accepted'
    assert 'cancel-in-progress' in fields and fields['cancel-in-progress'][1].value=='false','Queued Windows work requires literal cancel-in-progress:false'
    assert 'group' in fields and isinstance(fields['group'][1],yaml.ScalarNode) and fields['group'][1].value.strip(),'Queued work requires a scalar concurrency group (still checked unchanged by actionlint)'
    assert not node.flow_style and key.start_mark.line==value.end_mark.line,'queue must be its own block-mapping line'
    line=key.start_mark.line
    assert re.fullmatch(r'\s+queue:\s*max\s*(?:#.*)?\r?\n?',lines[line]),'Unexpected queue source syntax'
    remove.add(line);checked.append(name)
print(json.dumps({'source':''.join(line for index,line in enumerate(lines) if index not in remove),'queueJobs':checked}))
`;
export function normalizeWindowsQueueYaml(
  source,
  { python = process.platform === "win32" ? "python" : "python3" } = {},
) {
  assert(
    typeof source === "string" && Buffer.byteLength(source) <= 2 * 1024 * 1024,
    "Workflow source exceeds validation bound",
  );
  return JSON.parse(
    execFileSync(python, ["-B", "-c", queueNormalizer], {
      input: source,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
}
export function lintWindowsQueueWorkflow(
  file,
  { actionlint = process.env.ACTIONLINT ?? "actionlint", python } = {},
) {
  const normalized = normalizeWindowsQueueYaml(readFileSync(file, "utf8"), { python });
  const result = spawnSync(
    actionlint,
    ["-shellcheck=", "-stdin-filename", path.resolve(file), "-"],
    { input: normalized.source, encoding: "utf8", windowsHide: true },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `actionlint rejected ${file}; queue normalization does not ignore other errors`,
  );
  return {
    file,
    queueJobs: normalized.queueJobs,
    validation: normalized.queueJobs.length
      ? "documented-queue-semantics-plus-actionlint-with-queue-only-normalized"
      : "actionlint-unchanged-source",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.argv.length > 2, "Pass workflow paths to validate");
  for (const file of process.argv.slice(2))
    process.stdout.write(`${JSON.stringify(lintWindowsQueueWorkflow(file))}\n`);
}
