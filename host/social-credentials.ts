import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type SocialCredential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};
export interface SocialCredentialStore {
  get(id: string): Promise<SocialCredential | undefined>;
  set(id: string, credential: SocialCredential): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Sensitive input uses stdin, never argv/stderr. Every helper is hidden on Windows. */
function secretCommand(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("OS credential store unavailable."));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 1024 * 1024) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("OS credential store unavailable."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output.trim()) : reject(new Error("OS credential store unavailable."));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** Dedicated social vault: Windows DPAPI CurrentUser; macOS Keychain; Linux Secret Service.
 * Only an OS-wrapped random encryption key is written beside the encrypted tokens.
 * Refuses plaintext fallback. Provider CLIs keep ownership of their separate credentials. */
export class OsSocialCredentials implements SocialCredentialStore {
  private queue: Promise<unknown> = Promise.resolve();
  private keyPromise?: Promise<Buffer>;
  constructor(
    private readonly directory: string,
    private readonly environmentId: string,
  ) {}
  private async key(): Promise<Buffer> {
    if (!this.keyPromise) {
      this.keyPromise = this.loadKey();
      this.keyPromise.catch(() => {
        this.keyPromise = undefined;
      });
    }
    return this.keyPromise;
  }
  private async loadKey(): Promise<Buffer> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const requireNewVault = async () => {
      try {
        await readFile(join(this.directory, "tokens.enc"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error("Social vault unavailable.");
      }
      throw new Error(
        "Social vault key unavailable. Unlock or restore the OS credential store; existing encrypted credentials were preserved.",
      );
    };
    const name = `bycoda.social.${this.environmentId}`;
    if (process.platform === "win32") {
      const path = join(this.directory, "key.dpapi");
      let wrapped: string;
      try {
        wrapped = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("Social vault unavailable.");
        await requireNewVault();
        const raw = randomBytes(32).toString("base64");
        wrapped = await secretCommand(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
          ],
          raw,
        );
        await writeFile(path, wrapped, { mode: 0o600, flag: "wx" });
      }
      const raw = await secretCommand(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
        ],
        wrapped,
      );
      const key = Buffer.from(raw, "base64");
      if (key.length !== 32) throw new Error("Social vault key invalid.");
      return key;
    }
    if (process.platform === "darwin") {
      let raw: string;
      try {
        raw = await secretCommand(
          "security",
          ["find-generic-password", "-s", name, "-a", "bycoda", "-w"],
          "",
        );
      } catch {
        await requireNewVault();
        raw = randomBytes(32).toString("hex");
        // Interactive security mode accepts the command on stdin; no secret argv.
        await secretCommand(
          "security",
          ["-i"],
          `add-generic-password -s ${name} -a bycoda -w ${raw}\n`,
        );
        raw = await secretCommand(
          "security",
          ["find-generic-password", "-s", name, "-a", "bycoda", "-w"],
          "",
        );
      }
      const key = Buffer.from(raw, "hex");
      if (key.length !== 32) throw new Error("Social vault key invalid.");
      return key;
    }
    let raw = await secretCommand("secret-tool", ["lookup", "service", name], "").catch(() => "");
    if (!raw) {
      await requireNewVault();
      raw = randomBytes(32).toString("hex");
      await secretCommand("secret-tool", ["store", "--label=bycoda Social", "service", name], raw);
      raw = await secretCommand("secret-tool", ["lookup", "service", name], "");
    }
    const key = Buffer.from(raw, "hex");
    if (key.length !== 32) throw new Error("Social vault key invalid.");
    return key;
  }
  private async read(): Promise<Record<string, SocialCredential>> {
    const key = await this.key();
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.directory, "tokens.enc"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Social vault unavailable.");
    }
    try {
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(this.environmentId));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8"),
      );
    } catch {
      throw new Error("Social vault could not be decrypted.");
    }
  }
  async get(id: string): Promise<SocialCredential | undefined> {
    await this.queue;
    return (await this.read())[id];
  }
  private mutate(action: (values: Record<string, SocialCredential>) => void): Promise<void> {
    const run = this.queue
      .catch(() => undefined)
      .then(async () => {
        const values = await this.read();
        action(values);
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
        cipher.setAAD(Buffer.from(this.environmentId));
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]);
        // Atomic replacement prevents a crash from truncating the only credential copy.
        const temporary = join(this.directory, `tokens-${randomBytes(8).toString("hex")}.enc`);
        await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {
          mode: 0o600,
          flag: "wx",
        });
        const { rename } = await import("node:fs/promises");
        await rename(temporary, join(this.directory, "tokens.enc"));
      });
    this.queue = run;
    return run;
  }
  set(id: string, credential: SocialCredential): Promise<void> {
    return this.mutate((values) => {
      values[id] = credential;
    });
  }
  delete(id: string): Promise<void> {
    return this.mutate((values) => {
      delete values[id];
    });
  }
}
