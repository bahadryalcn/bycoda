import { existsSync, statfsSync } from "node:fs";
import { cpus, freemem, homedir, totalmem } from "node:os";
import { dirname } from "node:path";
import type { HardwareInfo, LocalTier } from "./decision-types";
import { runCommand } from "./local-command";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const MAX_GPUS = 8;

/** Reads RAM, CPU, NVIDIA GPUs (name and total VRAM) and free disk. Missing tooling yields no GPU. */
export async function readHardware(
  options: { diskPath?: string; signal?: AbortSignal } = {},
): Promise<HardwareInfo> {
  return {
    ramBytes: totalmem(),
    freeRamBytes: freemem(),
    cpus: cpus().length,
    gpus: await readNvidiaGpus(options.signal),
    freeDiskBytes: freeDiskBytes(options.diskPath ?? homedir()),
  };
}

async function readNvidiaGpus(signal?: AbortSignal): Promise<HardwareInfo["gpus"]> {
  const result = await runCommand(
    "nvidia-smi",
    ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
    { timeoutMs: 4000, signal },
  );
  return result ? parseNvidiaGpus(result.stdout) : [];
}

/** Each line is "name, memory.total in MiB". A line without a usable memory value keeps its name only. */
export function parseNvidiaGpus(output: string): HardwareInfo["gpus"] {
  const gpus: HardwareInfo["gpus"] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length < 2) continue;
    const name = parts.slice(0, -1).join(",").slice(0, 200);
    const mib = Number(parts[parts.length - 1]);
    if (!name) continue;
    gpus.push(Number.isFinite(mib) && mib > 0 ? { name, vramBytes: mib * MIB } : { name });
    if (gpus.length >= MAX_GPUS) break;
  }
  return gpus;
}

/** Largest single-GPU VRAM in GiB; 0 when no GPU reported its memory. */
export function bestVramGb(hardware: HardwareInfo): number {
  return Math.max(0, ...hardware.gpus.map((gpu) => (gpu.vramBytes ?? 0) / GIB));
}

/** strong: VRAM >= 8 GiB. medium: VRAM 4-8 GiB, or >= 16 GiB RAM with 4+ CPUs. cpu: >= 8 GiB RAM. */
export function hardwareTier(hardware: HardwareInfo): LocalTier {
  const vramGb = bestVramGb(hardware);
  const ramGb = hardware.ramBytes / GIB;
  if (vramGb >= 8) return "strong";
  if (vramGb >= 4 || (ramGb >= 16 && hardware.cpus >= 4)) return "medium";
  if (ramGb >= 8) return "cpu";
  return "insufficient";
}

function freeDiskBytes(path: string): number {
  let current = path;
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  try {
    const stats = statfsSync(current);
    return stats.bavail * stats.bsize;
  } catch {
    return 0;
  }
}
