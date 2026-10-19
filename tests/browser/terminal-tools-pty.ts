/** Browser-only PTY transport. The terminal renderer and search addon are real. */
export async function readyPtyBridge() {}
export async function spawnPty() {}
export async function killPty() {}
export async function resizePty() {}
export async function getPtyStatus() {
  return { foreground: null, supported: false };
}
export async function getPtySuggestions(_id: string, prefix: string) {
  return ["git status", "git diff", "pnpm build", "custom-tool --check"].filter(
    (value) => value.startsWith(prefix) && value !== prefix,
  );
}
let echo: ((data: string) => void) | undefined;
export async function writePty(_id: string, data: string) {
  document.documentElement.dataset.lastPtyWrite = JSON.stringify(data);
  if (data === "\r") echo?.("\r\nready> ");
  else if (data === "\x7f") echo?.("\b \b");
  // oxlint-disable-next-line no-control-regex -- emulate shell echo only for printable PTY input
  else if (!/[\x00-\x1f\x7f]/.test(data)) echo?.(data);
}
export function subscribePty(_id: string, onData: (data: string) => void) {
  echo = onData;
  const timer = setTimeout(() => onData("alpha target\r\nbeta target\r\nready> "), 50);
  const listener = (event: Event) => onData((event as CustomEvent<string>).detail);
  document.addEventListener("test-pty-output", listener);
  return () => {
    echo = undefined;
    clearTimeout(timer);
    document.removeEventListener("test-pty-output", listener);
  };
}
