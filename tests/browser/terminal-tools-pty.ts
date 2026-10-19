/** Browser-only PTY transport. The terminal renderer and search addon are real. */
export async function readyPtyBridge() {}
export async function spawnPty() {}
export async function killPty() {}
export async function resizePty() {}
export async function getPtyStatus() {
  return { foreground: null, supported: false };
}
export async function writePty(_id: string, data: string) {
  document.documentElement.dataset.lastPtyWrite = JSON.stringify(data);
}
export function subscribePty(_id: string, onData: (data: string) => void) {
  const timer = setTimeout(() => onData("alpha target\r\nbeta target\r\nready> "), 50);
  const listener = (event: Event) => onData((event as CustomEvent<string>).detail);
  document.addEventListener("test-pty-output", listener);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("test-pty-output", listener);
  };
}
