/** Explicit, run-local controls for crash/reconnect acceptance. Never discovers processes. */
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const actions = new Set(["stop-host", "start-host", "restart-host", "restart-app"]);

export function acceptanceControl(directory, handlers) {
  const path = join(directory, "acceptance-control.json");
  const resultPath = join(directory, "acceptance-result.json");
  let lastId;
  return {
    path,
    resultPath,
    async poll() {
      let request;
      try {
        request = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) return;
        throw error;
      }
      if (!request || typeof request.id !== "string" || !/^[\w-]{1,100}$/.test(request.id))
        throw new Error("Invalid native acceptance control id");
      if (request.id === lastId) return;
      lastId = request.id;
      let result;
      try {
        if (!actions.has(request.action)) throw new Error("Unsupported native acceptance control");
        result = { id: request.id, ok: true, ...(await handlers[request.action]()) };
      } catch (error) {
        result = { id: request.id, ok: false, error: error.message };
      }
      await writeFile(`${resultPath}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
      await rename(`${resultPath}.tmp`, resultPath);
    },
  };
}
