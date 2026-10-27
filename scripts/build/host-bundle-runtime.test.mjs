import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { hostBuildPlans } from "./host-inputs.mjs";

test("production Host ESM options start the real bundled ws dependency without ambient require", async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "bycoda-host-esm-"));
  t.after(() => {
    assert.equal(dirname(directory), tmpdir());
    rmSync(directory, { recursive: true, force: true });
  });
  const options = hostBuildPlans(readFileSync(join(root, "host/build.mjs"), "utf8"))[0];
  const output = join(directory, "host-esm.mjs");
  await build({
    ...options,
    absWorkingDir: root,
    entryPoints: undefined,
    outfile: output,
    sourcemap: false,
    stdin: {
      resolveDir: root,
      sourcefile: "host-runtime-regression.ts",
      contents: `
      import { WebSocketServer, WebSocket } from 'ws';
      const server = new WebSocketServer({host:'127.0.0.1',port:0});
      await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      server.on('connection',socket=>socket.on('message',data=>socket.send(data)));
      const client = new WebSocket('ws://127.0.0.1:'+server.address().port);
      const result = await new Promise((resolve,reject)=>{
        client.once('open',()=>client.send('owned websocket runtime'));
        client.once('message',data=>resolve(data.toString()));client.once('error',reject);
      });
      client.close();await new Promise(resolve=>server.close(resolve));
      console.log(result);
    `,
    },
  });
  const result = execFileSync(process.execPath, [output], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.trim(), "owned websocket runtime");
});
