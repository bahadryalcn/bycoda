/** Browser-only PTY transport. The terminal renderer and search addon are real. */
type FixturePtyCall = {
  op: "spawn" | "kill" | "resize" | "visible";
  id: string;
  cols?: number;
  rows?: number;
  visible?: boolean;
};
const calls: FixturePtyCall[] = [];
function record(call: FixturePtyCall) {
  calls.push(call);
  document.documentElement.dataset.terminalPtyCalls = JSON.stringify(calls);
}
export async function readyPtyBridge() {}
export async function spawnPty(id: string, _cwd: string, cols: number, rows: number) {
  record({ op: "spawn", id, cols, rows });
}
export async function killPty(id: string) {
  record({ op: "kill", id });
}
export async function resizePty(id: string, cols: number, rows: number) {
  record({ op: "resize", id, cols, rows });
}
export async function setPtyVisible(id: string, visible: boolean) {
  record({ op: "visible", id, visible });
  document.documentElement.dataset.terminalPtyVisibility = JSON.stringify({ id, visible });
}
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
