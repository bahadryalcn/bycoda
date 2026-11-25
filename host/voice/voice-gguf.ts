import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { lstat, mkdtemp, rename, rm } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import source from "./voice-gguf-catalog.json";

export const ggufModels = source.models.map((model) => {
  const id = `gguf-${model.id.slice("handy-computer/".length).toLowerCase()}`;
  return { ...model, id, repo: model.id, folder: id, label: model.name, expectedBytes: model.size };
});
export type GgufModel = (typeof ggufModels)[number];

export const ggufSupported = (platform = process.platform, arch = process.arch) =>
  ((platform === "darwin" || platform === "linux") && (arch === "x64" || arch === "arm64")) ||
  (platform === "win32" && arch === "x64");

const nodeEntry = "node_modules/transcribe-cpp/dist/index.js";
const runtimeDirectory = (home: string) =>
  join(home, ".bycoda", "voice", `dictation-gguf-${source.engineVersion}`);

export function ownedGgufModel(home: string, path: string | undefined) {
  if (!path) return undefined;
  const normalized = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const key = normalized(resolve(path));
  const model = ggufModels.find(
    ({ folder }) => key === normalized(join(home, ".bycoda", "voice", "models", folder)),
  );
  return model && { model, path: join(home, ".bycoda", "voice", "models", model.folder) };
}

export async function ggufInstalled(home: string, path: string, model: GgufModel) {
  const [file, directory, runtime] = await Promise.all([
    lstat(join(path, model.filename)).catch(() => undefined),
    lstat(path).catch(() => undefined),
    lstat(runtimeDirectory(home)).catch(() => undefined),
  ]);
  return (
    directory?.isDirectory() === true &&
    runtime?.isDirectory() === true &&
    file?.isFile() === true &&
    file.size === model.size &&
    existsSync(join(runtimeDirectory(home), nodeEntry))
  );
}

function runNode(args: string[], signal: AbortSignal, timeout: number, cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
      stdio: "ignore",
      windowsHide: true,
    });
    let failure: Error | undefined;
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`Dictation runtime exited with code ${code}.`));
    });
  });
}

async function installRuntime(home: string, signal: AbortSignal) {
  const target = runtimeDirectory(home);
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (stat) {
    if (!stat.isDirectory() || !existsSync(join(target, nodeEntry)))
      throw new Error("The local dictation runtime folder is invalid.");
    return;
  }
  const npm = [
    dirname(process.execPath),
    ...(process.env.PATH ?? process.env.Path ?? "").split(delimiter),
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "nodejs") : "",
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
  ]
    .filter(Boolean)
    .flatMap((directory) => [
      join(directory, "node_modules/npm/bin/npm-cli.js"),
      join(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
    ])
    .find(existsSync);
  if (!npm) throw new Error("Installing GGUF dictation models requires npm on this computer.");
  const stage = await mkdtemp(`${target}.stage-`);
  try {
    await runNode(
      [
        npm,
        "install",
        "--prefix",
        stage,
        "--registry=https://registry.npmjs.org/",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        "--ignore-scripts",
        "--no-save",
        `transcribe-cpp@${source.engineVersion}`,
        "koffi@3.0.2",
      ],
      signal,
      180_000,
      stage,
    );
    await runNode(
      [
        "--input-type=module",
        "-e",
        "await import(process.argv[1])",
        pathToFileURL(join(stage, nodeEntry)).href,
      ],
      signal,
      30_000,
    );
    signal.throwIfAborted();
    await rename(stage, target);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Could not install the local GGUF dictation runtime.");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Download the pinned publication and publish only a matching, complete file. */
export async function downloadGguf(
  home: string,
  path: string,
  model: GgufModel,
  signal: AbortSignal,
) {
  await installRuntime(home, signal);
  const target = join(path, model.filename);
  const partial = `${target}.partial`;
  await rm(partial, { force: true });
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${encodeURIComponent(model.filename)}`;
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Could not download the model (HTTP ${response.status}).`);
    }
    const reader = response.body.getReader();
    await pipeline(
      async function* () {
        try {
          for (;;) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) return;
            bytes += chunk.value.byteLength;
            if (bytes > model.size) throw new Error("Model download exceeded its catalog size.");
            digest.update(chunk.value);
            yield chunk.value;
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      },
      createWriteStream(partial, { flags: "wx" }),
      { signal },
    );
    if (bytes !== model.size || digest.digest("hex") !== model.sha256)
      throw new Error("A downloaded model file failed verification. Try downloading it again.");
    signal.throwIfAborted();
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
}

export function ggufWorkerArgs(home: string, path: string, model: GgufModel, test = false) {
  return [
    "--input-type=module",
    "-e",
    ggufWorker,
    pathToFileURL(join(runtimeDirectory(home), nodeEntry)).href,
    join(path, model.filename),
    test ? "test" : "worker",
    model.languages,
  ];
}

const ggufWorker = String.raw`
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
const [, moduleUrl, file, mode, languageCodes] = process.argv;
const reply = (message) => process.stdout.write(JSON.stringify(message) + '\n');
try {
  const { TranscribeModel } = await import(moduleUrl);
  const config = JSON.parse(process.env.BYCODA_VOICE_CONFIG ?? '{}');
  const backend = mode === 'test' || config.device === 'cpu' ? 'cpu' : 'auto';
  const model = await TranscribeModel.load(file, { backend });
  if (mode === 'test') {
    model.dispose();
  } else {
    const languages = languageCodes.split(' ');
    const preferred = config.dictationLanguage;
    if (preferred && preferred !== 'auto' && !languages.includes(preferred))
      throw new Error('unsupported language');
    reply({ ready: true, model: file.split(/[/\\]/).pop(), device: model.device?.kind ?? backend });
    const decode = async (pcm, options) => {
      try {
        const result = await model.transcribe(pcm, options);
        return { text: result.text.trim(), language: result.language || options.language || '' };
      } catch (error) {
        if (!['InputTooLong', 'OutputTruncated'].includes(error?.constructor?.name) || pcm.length < 8000)
          throw error;
        const middle = Math.floor(pcm.length / 2);
        const left = await decode(pcm.subarray(0, middle), options);
        const right = await decode(pcm.subarray(middle), options);
        const language = left.language === right.language ? left.language : '';
        return { text: [left.text, right.text].filter(Boolean).join(' '), language };
      }
    };
    for await (const line of createInterface({ input: process.stdin })) {
      let request;
      try {
        request = JSON.parse(line);
        const raw = Buffer.from(request.audio, 'base64');
        const pcm = new Float32Array(raw.length / 2);
        for (let index = 0; index < pcm.length; index++)
          pcm[index] = raw.readInt16LE(index * 2) / 32768;
        const start = performance.now();
        const language = preferred === 'auto' && languages.length !== 1 ? undefined
          : languages.length === 1 ? languages[0] : preferred || request.language;
        const result = await decode(pcm, { ...(language && { language }), timestamps: 'none' });
        reply({ id: request.id, ...result, inferenceMs: Math.round(performance.now() - start) });
      } catch {
        reply({ id: request?.id, error: 'Local speech recognition failed.' });
      }
    }
    model.dispose();
  }
} catch (error) {
  if (mode !== 'test') reply({
    error: error?.message === 'unsupported language'
      ? 'The selected model does not support your dictation language.'
      : 'The local GGUF model could not be loaded.',
  });
  process.exitCode = 1;
}
`;
