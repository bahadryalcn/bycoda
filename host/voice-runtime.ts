import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

export type VoiceRuntimeConfig = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  natural?: boolean;
};
export type VoiceRuntimeStatus = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  missing: string[];
  ready: boolean;
};
export function voiceRuntimeConfig(value: unknown): VoiceRuntimeConfig {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid voice settings.");
  const result: VoiceRuntimeConfig = {};
  const input = value as Record<string, unknown>;
  for (const key of ["python", "whisperPath", "ttsPath"] as const) {
    const path = input[key];
    if (path === undefined || path === "") continue;
    if (
      typeof path !== "string" ||
      path.length > 4096 ||
      [...path].some((char) => char.charCodeAt(0) < 32)
    )
      throw new Error("Invalid voice installation path.");
    result[key] = path.trim();
  }
  if (input.natural !== undefined) {
    if (typeof input.natural !== "boolean") throw new Error("Invalid voice engine.");
    result.natural = input.natural;
  }
  return result;
}

const probe = String.raw`
import os, sys, json, importlib.util
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
c = json.loads(sys.argv[1])
missing = []
if not (3, 10) <= sys.version_info[:2] < (3, 13): missing.append('Python 3.10–3.12')
def available(name):
    try: return importlib.util.find_spec(name) is not None
    except Exception: return False
def model_path(path, repo, required):
    if path:
        return path if all(os.path.isfile(os.path.join(path, f)) for f in required) else None
    try:
        from huggingface_hub import snapshot_download
        p = snapshot_download(repo, local_files_only=True)
        return p if all(os.path.isfile(os.path.join(p, f)) for f in required) else None
    except Exception: return None
if not available('faster_whisper'): missing.append('faster-whisper')
w = None
for size in ['small', 'base', 'tiny']:
    w = model_path(c.get('whisperPath'), 'Systran/faster-whisper-' + size, ['model.bin', 'config.json', 'tokenizer.json'])
    if w: break
if not w: missing.append('Whisper model')
t = model_path(c.get('ttsPath'), 'openbmb/VoxCPM2', ['config.json', 'model.safetensors', 'audiovae.pth'])
if c.get('natural', True):
    if not available('voxcpm'): missing.append('voxcpm')
    if not t: missing.append('VoxCPM2 model')
print(json.dumps({'python': sys.executable, 'whisperPath': w, 'ttsPath': t, 'missing': missing, 'ready': not missing}))
`;

function inspect(
  python: string,
  config: VoiceRuntimeConfig,
): Promise<VoiceRuntimeStatus | undefined> {
  return new Promise((resolve) => {
    const child = spawn(python, ["-c", probe, JSON.stringify(config)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, 6000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 32000) child.kill();
    });
    child.stderr.on("data", () => {});
    const finish = () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve(undefined);
      }
    };
    child.on("error", finish);
    child.on("close", finish);
  });
}

/** Detect only; never install packages, download models or open the microphone. */
export async function inspectVoiceRuntime(value?: unknown): Promise<VoiceRuntimeStatus> {
  const config = voiceRuntimeConfig(value);
  const candidates = config.python
    ? [config.python]
    : [
        process.env.BYCODA_VOICE_PYTHON,
        process.env.VIRTUAL_ENV &&
          join(
            process.env.VIRTUAL_ENV,
            process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
          ),
        join(
          homedir(),
          ".bycoda",
          "voice",
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        ),
        process.platform === "win32" ? "python" : "python3",
      ];
  if (!config.python && process.platform === "win32") {
    const base = join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"),
      "Programs/Python",
    );
    for (const item of await readdir(base, { withFileTypes: true }).catch(() => []))
      if (item.isDirectory() && /^Python\d+$/.test(item.name))
        candidates.push(join(base, item.name, "python.exe"));
  }
  let best: VoiceRuntimeStatus | undefined;
  for (const candidate of new Set(candidates.filter((p): p is string => Boolean(p)))) {
    const status = await inspect(candidate, config);
    if (!status) continue;
    if (!best || status.missing.length < best.missing.length) best = status;
    if (status.ready) return status;
  }
  return (
    best ?? {
      missing: [
        "Python 3.10–3.12",
        "faster-whisper",
        "Whisper model",
        ...(config.natural === false ? [] : ["voxcpm", "VoxCPM2 model"]),
      ],
      ready: false,
    }
  );
}
