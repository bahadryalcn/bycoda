import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { localVoicePython } from "./voice-python";

// Execute the actual worker function without importing numpy/Whisper, loading a
// model, downloading anything or opening a microphone. Python is optional on
// development machines; missing Python is an explicit skipped check.
const python = process.platform === "win32" ? "python" : "python3";
const available = spawnSync(python, ["--version"], { windowsHide: true }).status === 0;
const harness = String.raw`
import ast, json, math, sys
from types import SimpleNamespace
request = json.load(sys.stdin)
tree = ast.parse(request['worker'])
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'accepted_transcript')
scope = {'math': math}
exec(compile(ast.Module(body=[function], type_ignores=[]), '<voice-worker>', 'exec'), scope)
results = []
for case in request['cases']:
    segments = [SimpleNamespace(**segment) for segment in case]
    results.append(scope['accepted_transcript'](iter(segments)))
# Malformed/non-finite decoder confidence must never authorize a transcript.
for field in ['no_speech_prob', 'avg_logprob', 'compression_ratio']:
    for value in [float('nan'), float('inf'), -float('inf')]:
        segment = SimpleNamespace(text='stop', no_speech_prob=0.01, avg_logprob=-0.1, compression_ratio=1.0)
        setattr(segment, field, value)
        assert scope['accepted_transcript'](iter([segment])) == ''
print(json.dumps(results))
`;

function segment(text: string, overrides: Record<string, number> = {}) {
  return {
    text,
    no_speech_prob: 0.01,
    avg_logprob: -0.2,
    compression_ratio: 1,
    ...overrides,
  };
}
function transcribe(cases: ReturnType<typeof segment>[][]): string[] {
  const result = spawnSync(python, ["-X", "utf8", "-c", harness], {
    input: JSON.stringify({ worker: localVoicePython, cases }),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe.skipIf(!available)("local Whisper final-result admission", () => {
  it("rejects uncertain non-speech and failed final decodes rather than exposing invented commands", () => {
    expect(
      transcribe([
        [],
        [segment("submit work", { no_speech_prob: 0.65 })],
        [segment("stop", { avg_logprob: -1.5 })],
        [segment("Thank you. Thank you.", { compression_ratio: 3 })],
        [segment("stop", { no_speech_prob: 0.6 })],
        [segment("stop", { no_speech_prob: -0.1 })],
      ]),
    ).toEqual(["", "", "", "", "", ""]);
  });

  it("preserves confident short Turkish/English speech without splicing uncertain clauses", () => {
    const words = ["evet", "hayır", "dur", "yes", "no", "stop"];
    expect(transcribe(words.map((word) => [segment(word)]))).toEqual(words);
    expect(
      transcribe([
        [
          segment(" Merhaba. "),
          segment("invented", { avg_logprob: -2 }),
          segment(" Test çalışıyor. "),
        ],
        [segment("Hello. The test works.", { avg_logprob: -1, compression_ratio: 2.4 })],
      ]),
    ).toEqual(["", "Hello. The test works."]);
  });
});
