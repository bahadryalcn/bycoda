import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";

export type NvidiaGpu = { name: string; cuda?: string };

/** Driver-supported CUDA versions mapped to PyTorch wheel indexes, newest first. */
const CUDA_TORCH_INDEXES: [tag: string, minimum: number][] = [
  ["cu130", 1300],
  ["cu128", 1208],
  ["cu126", 1206],
];

function nvidiaSmi(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const decoder = new StringDecoder("utf8");
    let output = "";
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("nvidia-smi", args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 4000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output = (output + decoder.write(chunk)).slice(-16_000);
    });
    child.on("error", () => finish());
    child.on("close", (code) => finish(code === 0 ? output : undefined));
  });
}

let cached: { at: number; value: Promise<NvidiaGpu | undefined> } | undefined;

/** Detection only: reads the NVIDIA driver tool and never loads CUDA into the Host. */
export function detectNvidiaGpu(): Promise<NvidiaGpu | undefined> {
  if (process.platform === "darwin") return Promise.resolve(undefined);
  if (cached && elapsedSince(cached.at) < 5 * 60_000) return cached.value;
  const value = (async () => {
    const [names, summary] = await Promise.all([
      nvidiaSmi(["--query-gpu=name", "--format=csv,noheader"]),
      nvidiaSmi([]),
    ]);
    const name = names
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!name) return undefined;
    // Older drivers print "CUDA Version", newer ones "CUDA UMD Version".
    const cuda = summary?.match(/CUDA (?:UMD )?Version:\s*(\d+\.\d+)/)?.[1];
    return { name: name.slice(0, 200), ...(cuda ? { cuda } : {}) };
  })();
  cached = { at: monotonicNow(), value };
  return value;
}

/** PyTorch CUDA wheel indexes this driver can run, newest first. An unreadable
 * driver version tries every index; an unusable build still runs on the CPU. */
export function cudaTorchIndexes(cuda?: string): string[] {
  const match = cuda?.match(/^(\d+)\.(\d+)$/);
  const version = match ? Number(match[1]) * 100 + Number(match[2]) : Infinity;
  return CUDA_TORCH_INDEXES.filter(([, minimum]) => version >= minimum).map(
    ([tag]) => `https://download.pytorch.org/whl/${tag}`,
  );
}
