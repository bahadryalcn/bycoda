// node:sqlite prints "ExperimentalWarning: SQLite is an experimental feature"
// on Node 22. The Host depends on it deliberately, and CLI commands promise
// machine-readable, warning-free stderr. Drop only that one warning; every other
// warning still reaches Node's default reporter. Bundlers hoist external imports
// such as node:sqlite above this module, but Node emits the warning on a later
// tick, so filtering the listeners synchronously here is early enough.
const defaults = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning: Error) => {
  if (
    warning.name === "ExperimentalWarning" &&
    warning.message.startsWith("SQLite is an experimental feature")
  )
    return;
  for (const listener of defaults) listener.call(process, warning);
});
