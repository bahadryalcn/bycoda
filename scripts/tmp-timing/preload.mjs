// TEMPORARY: time every child process and socket connect in this Node process.
import { appendFileSync } from "node:fs";
import { ChildProcess } from "node:child_process";
import net from "node:net";
import { performance } from "node:perf_hooks";
const file = process.env.BYCODA_TIMING_LOG;
const log = (line) => {
  if (file) try { appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${line}\n`); } catch {}
};
const spawn = ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn = function (options) {
  const start = performance.now();
  const args = (options?.args ?? []).slice(1).join(" ").slice(0, 160);
  const what = `${options?.file} ${args} cwd=${options?.cwd ?? ""}`;
  this.once("exit", (code) => log(`${(performance.now() - start).toFixed(1).padStart(8)}ms SPAWN code=${code} ${what}`));
  return spawn.call(this, options);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const start = performance.now();
  const target = JSON.stringify(args[0]?.path ?? args[0]?.port ?? args[0]).slice(0, 120);
  this.once("connect", () => log(`${(performance.now() - start).toFixed(1).padStart(8)}ms CONNECT ok ${target}`));
  this.once("error", (e) => log(`${(performance.now() - start).toFixed(1).padStart(8)}ms CONNECT err ${e.code} ${target}`));
  return connect.apply(this, args);
};
