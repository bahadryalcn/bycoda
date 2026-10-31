import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { detectNvidiaGpu } from "./voice-gpu";

export type VoiceRuntimeConfig = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  natural?: boolean;
  /** Natural voice model. Omitted means Supertonic 3: fast, CPU, 31 languages.
   * VoxCPM2 sounds richer but needs a GPU to keep up and ~6 GB of its memory. */
  engine?: VoiceEngine;
  /** Where speech models run. Omitted means automatic: GPU when usable. */
  device?: VoiceDevice;
};
export type VoiceDevice = "auto" | "gpu" | "cpu";
export type VoiceEngine = "supertonic" | "voxcpm2";
export type VoiceRuntimeStatus = {
  python?: string;
  whisperPath?: string;
  ttsPath?: string;
  missing: string[];
  ready: boolean;
  /** Detected NVIDIA GPU name, when one is present. */
  gpu?: string;
  /** Whether the natural voice runtime has CUDA support installed. */
  accelerated?: boolean;
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
  if (input.engine !== undefined && input.engine !== "supertonic") {
    if (input.engine !== "voxcpm2") throw new Error("Invalid voice engine.");
    result.engine = input.engine;
  }
  if (input.device !== undefined && input.device !== "auto") {
    if (input.device !== "gpu" && input.device !== "cpu")
      throw new Error("Invalid voice processing device.");
    result.device = input.device;
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
    owned = os.path.join(os.path.expanduser('~'), '.bycoda', 'voice', 'models', 'voxcpm2' if repo == 'openbmb/VoxCPM2' else 'whisper-small')
    if all(os.path.isfile(os.path.join(owned, f)) for f in required): return owned
    try:
        # Newer huggingface_hub rejects offline snapshots that lack optional
        # files, so look up the required files themselves.
        from huggingface_hub import try_to_load_from_cache
        found = try_to_load_from_cache(repo, required[0])
        p = os.path.dirname(found) if isinstance(found, str) else None
        return p if p and all(os.path.isfile(os.path.join(p, f)) for f in required) else None
    except Exception: return None
if not available('faster_whisper'): missing.append('faster-whisper')
w = None
for size in ['small', 'base', 'tiny']:
    w = model_path(c.get('whisperPath'), 'Systran/faster-whisper-' + size, ['model.bin', 'config.json', 'tokenizer.json'])
    if w: break
if not w: missing.append('Whisper model')
def torch_cuda():
    # Inspect the installed wheel without importing torch, which takes seconds.
    try:
        spec = importlib.util.find_spec('torch')
        if not spec or not spec.submodule_search_locations: return False
        lib = os.path.join(list(spec.submodule_search_locations)[0], 'lib')
        return any('c10_cuda' in f for f in os.listdir(lib))
    except Exception: return False
t = None
accelerated = None
def supertonic_path():
    required = ['onnx/tts.json', 'onnx/text_encoder.onnx', 'onnx/duration_predictor.onnx', 'onnx/vector_estimator.onnx', 'onnx/vocoder.onnx', 'voice_styles/M1.json']
    for folder in [os.path.join(os.path.expanduser('~'), '.bycoda', 'voice', 'models', 'supertonic3'), os.path.join(os.path.expanduser('~'), '.cache', 'supertonic3')]:
        if all(os.path.isfile(os.path.join(folder, f)) for f in required): return folder
    return None
if c.get('natural', True) and c.get('engine') == 'voxcpm2':
    t = model_path(c.get('ttsPath'), 'openbmb/VoxCPM2', ['config.json', 'model.safetensors', 'audiovae.pth'])
    if not available('voxcpm'): missing.append('voxcpm')
    if not t: missing.append('VoxCPM2 model')
    accelerated = torch_cuda()
    if c.get('device') == 'gpu' and available('voxcpm') and not accelerated: missing.append('GPU support (CUDA)')
elif c.get('natural', True):
    if not available('supertonic'): missing.append('supertonic')
    if not supertonic_path(): missing.append('Supertonic model')
print(json.dumps({**({'python': sys.executable} if (3, 10) <= sys.version_info[:2] < (3, 13) else {}), 'whisperPath': w, 'ttsPath': t, **({} if accelerated is None else {'accelerated': accelerated}), 'missing': missing, 'ready': not missing}))
`;

function inspect(
  python: string,
  config: VoiceRuntimeConfig,
  signal: AbortSignal,
  args: string[] = [],
): Promise<VoiceRuntimeStatus | undefined> {
  return new Promise((resolve) => {
    const child = spawn(python, [...args, "-c", probe, JSON.stringify(config)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let output = "";
    let settled = false;
    const stop = () => {
      if (settled) return;
      // `py` can own a Python child; terminating only the launcher leaves a
      // timed-out probe running after discovery has finished.
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill());
      } else child.kill();
      finish(false);
    };
    const timer = setTimeout(stop, 6000);
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      const text = chunk.toString();
      if (output.length + text.length > 32000) stop();
      else output += text;
    });
    child.stderr.on("data", () => {});
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      try {
        const value = success ? JSON.parse(output) : undefined;
        resolve(
          value &&
            typeof value.ready === "boolean" &&
            Array.isArray(value.missing) &&
            value.missing.every((item: unknown) => typeof item === "string")
            ? value
            : undefined,
        );
      } catch {
        resolve(undefined);
      }
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
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
        ...(process.platform === "win32" ? [] : ["python3.12", "python3.11", "python3.10"]),
        ...(process.platform === "darwin"
          ? ["3.12", "3.11", "3.10"].flatMap((version) => [
              `/Library/Frameworks/Python.framework/Versions/${version}/bin/python${version}`,
              `/opt/homebrew/opt/python@${version}/bin/python${version}`,
              `/usr/local/opt/python@${version}/bin/python${version}`,
            ])
          : []),
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
  const probes = [...new Set(candidates.filter((p): p is string => Boolean(p)))].map((python) => ({
    python,
    args: [] as string[],
  }));
  // The Windows launcher also finds supported installs outside PATH and the
  // per-user Programs directory, including when `python` points to 3.13+.
  if (!config.python && process.platform === "win32")
    for (const version of ["3.12", "3.11", "3.10"])
      probes.push({ python: "py", args: [`-${version}`] });
  let best: VoiceRuntimeStatus | undefined;
  const gpu = config.device === "cpu" ? undefined : detectNvidiaGpu().catch(() => undefined);
  const controller = new AbortController();
  // A per-interpreter timeout must not multiply into minutes of settings UI
  // waiting. Bound the entire scan and stop outstanding probes once ready.
  const timer = setTimeout(() => controller.abort(), 12_000);
  let next = 0;
  const scan = async () => {
    while (!controller.signal.aborted && next < probes.length) {
      const candidate = probes[next++];
      const status = await inspect(candidate.python, config, controller.signal, candidate.args);
      if (!status) continue;
      // A working interpreter with missing packages is more useful than an
      // incompatible system Python that happens to have more packages installed.
      if (
        !best ||
        (status.python && !best.python) ||
        (Boolean(status.python) === Boolean(best.python) &&
          status.missing.length < best.missing.length)
      )
        best = status;
      if (status.ready) controller.abort();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(4, probes.length) }, scan));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  const status: VoiceRuntimeStatus = best ?? {
    missing: [
      "Python 3.10–3.12",
      "faster-whisper",
      "Whisper model",
      ...(config.natural === false ? [] : ["voxcpm", "VoxCPM2 model"]),
    ],
    ready: false,
  };
  const found = await gpu;
  if (found) status.gpu = found.name;
  else if (config.device === "gpu") {
    status.missing = [...status.missing, "NVIDIA GPU"];
    status.ready = false;
  }
  return status;
}
