import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { HostNotesAdmission } from "./host-notes-admission";

const artifact = process.env.BYCODA_HOST_NOTES_ADMISSION_ARTIFACT;
const folder = mkdtempSync(join(tmpdir(), "bycoda-host-admission-"));
const driver = join(folder, "driver.mjs");
afterAll(() => {
  const target = resolve(folder);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith("bycoda-host-admission-")
  )
    throw new Error("Unexpected owned fixture directory");
  rmSync(target, { recursive: true, force: true });
});
it("keeps only absent startup manifests explicitly unjoined", () => {
  expect(new HostNotesAdmission({}, folder).status).toEqual({
    mode: "unjoined",
    reason: "host-notes-admission-unjoined",
    detail: "missing",
  });
});
it("holds an explicitly configured missing artifact instead of downgrading", () => {
  const admission = new HostNotesAdmission({ admissionArtifact: join(folder, "missing.node") });
  expect(admission.status.mode).toBe("fault");
  expect(() => admission.accept([], true)).toThrow("physical admission is unavailable");
});
it("holds an existing manifest's missing artifact and malformed target without creating a database", () => {
  const bundle = join(folder, "incomplete-bundle");
  mkdirSync(bundle);
  const sha = "a".repeat(64);
  const manifest = {
    schemaVersion: 2,
    mechanicalAbiVersion: 2,
    target: `${process.platform}-${process.arch}`,
    artifact: `admission-${sha}.node`,
    sha256: sha,
  };
  writeFileSync(join(bundle, "physical-store-admission.json"), JSON.stringify(manifest));
  expect(new HostNotesAdmission({}, bundle).status.mode).toBe("fault");
  writeFileSync(
    join(bundle, "physical-store-admission.json"),
    JSON.stringify({ ...manifest, target: "wrong-architecture" }),
  );
  expect(new HostNotesAdmission({}, bundle).status.mode).toBe("fault");
});
it("does not downgrade a configured dangling manifest link to absent startup", () => {
  const bundle = join(folder, "dangling-manifest");
  mkdirSync(bundle);
  symlinkSync(
    join(bundle, "missing-target"),
    join(bundle, "physical-store-admission.json"),
    process.platform === "win32" ? "junction" : "file",
  );
  expect(new HostNotesAdmission({}, bundle).status.mode).toBe("fault");
});

// Each actual-addon case runs in an owned Node process. Its true EXIT ends all
// Native binding/registry pins before the parent removes the isolated DB tree.
const driverSource = String.raw`
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, realpathSync, writeFileSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname, toNamespacedPath } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { AsyncHostNotes } from "./host/host-notes-async";
import { HostNotesAdmission, createHostNotesDatabaseFactory } from "./host/host-notes-admission";
import { loadPhysicalStoreAdmission } from "./packages/physical-store-admission-node/index.mjs";
const [scenario, root] = process.argv.slice(2);
const artifact = process.env.BYCODA_HOST_NOTES_ADMISSION_ARTIFACT;
const native = loadPhysicalStoreAdmission(artifact);
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done}); return {promise,resolve}; };
const turn = () => new Promise(done=>setImmediate(done));
const until = async (check) => { const limit=Date.now()+5000; while(!check()){assert.ok(Date.now()<limit,"actual job did not reach expected state");await new Promise(done=>setTimeout(done,10));} };
function database(name, old=false) {
  const path=join(root,name+".db"); const db=new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL"+(old?"":",content_updated_at INTEGER NOT NULL DEFAULT 0")+"); CREATE TABLE actual_writes(sequence INTEGER PRIMARY KEY,body TEXT); CREATE TRIGGER writes_insert AFTER INSERT ON notes BEGIN INSERT INTO actual_writes(body) VALUES(new.body); END; CREATE TRIGGER writes_update AFTER UPDATE ON notes BEGIN INSERT INTO actual_writes(body) VALUES(new.body); END; CREATE TABLE sessions(id TEXT PRIMARY KEY,created_at INTEGER); INSERT INTO sessions VALUES('visible',1); CREATE TABLE native_authority_identity(id INTEGER PRIMARY KEY,source_store_id TEXT,source_profile_id TEXT); INSERT INTO native_authority_identity VALUES(1,'store-one','profile-one');");
  db.close();return path;
}
function read(path,sql) {const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}}
function bind(path) {const canonical=realpathSync(path);const registry=native.openRegistry(native.registryRootForDatabase(canonical));return registry.bindFile(canonical);}
function notes(paths,url) {const value=new AsyncHostNotes(()=>paths,url,{admissionArtifact:artifact});assert.equal(value.admissionStatus.mode,"joined");return value;}
function worker(notes) {return notes.worker.worker;}
const input={id:"note",title:"Original",body:"original",tags:[],sourceCwd:"/project"};
if(scenario==="queue") {
  const path=database("queue");const host=notes([path]);const original=await host.save(input,0);
  const gate=deferred(), entered=deferred();let checks=0;
  const first=host.save({...original,body:"first"},original.updatedAt,"/project",()=>{if(++checks===1)return true;entered.resolve();return gate.promise;});
  const secondInput={...input,id:"second",title:"Second",body:"captured second"};
  const second=host.save(secondInput,0);secondInput.body="later mutation";
  const store=bind(path),closing=store.tryBeginClose();assert.ok(closing);assert.equal(store.tryUpgrade(closing),null);
  await assert.rejects(host.save({...input,id:"blocked"},0),/closed or busy/);
  await entered.promise;gate.resolve(true);assert.equal((await first).body,"first");assert.equal((await second).body,"captured second");
  const closed=store.tryUpgrade(closing);assert.ok(closed);
  assert.equal((await host.get("second")).body,"captured second");
  assert.deepEqual(await host.desktopLocalSessionReference("visible",process.platform),{kind:"native",sourceStoreId:"store-one",sourceProfileId:"profile-one",sessionId:"visible"});
  await assert.rejects(host.save({...input,id:"still-blocked"},0),/closed or busy/);
  store.releaseClosed(closed);assert.equal((await host.save({...input,id:"reopened",title:"Reopened",body:"after reopen"},0)).body,"after reopen");
  assert.deepEqual(read(path,"SELECT body FROM actual_writes ORDER BY sequence").map(x=>x.body),["original","first","captured second","after reopen"]);
  await host.close();
} else if(scenario==="all-or-nothing") {
  const one=database("one"),two=database("two");const stores=[bind(one),bind(two)].sort((a,b)=>a.identity().nativeFormat<b.identity().nativeFormat?-1:1);
  const closing=stores[1].tryBeginClose();assert.ok(closing);
  const host=notes([two,one,join(root,".","one.db")]);
  await assert.rejects(host.save(input,0),/closed or busy/);
  const first=stores[0].tryBeginClose();assert.ok(first);const drained=stores[0].tryUpgrade(first);assert.ok(drained);stores[0].releaseClosed(drained);
  assert.equal(read(one,"SELECT count(*) AS count FROM notes")[0].count,0);assert.equal(read(two,"SELECT count(*) AS count FROM notes")[0].count,0);
  stores[1].releaseClosing(closing);
  await host.save(input,0);assert.equal(read(two,"SELECT count(*) AS count FROM notes")[0].count,1);assert.equal(read(one,"SELECT count(*) AS count FROM notes")[0].count,0);
  await host.close();
  const missing=join(root,"missing.db");const held=notes([one,missing]);await assert.rejects(held.save({...input,id:"absent"},0),/physical admission is unavailable/);assert.equal(existsSync(missing),false);assert.equal(held.admissionStatus.mode,"fault");await held.close();
} else if(scenario==="authority") {
  const path=database("authority");const host=notes([path]);const original=await host.save(input,0);
  const lock=new DatabaseSync(path);lock.exec("BEGIN IMMEDIATE");const begun=deferred();let allowed=true,checks=0;
  const pending=host.save({...original,body:"revoked"},original.updatedAt,"/project",()=>{checks++;begun.resolve();return allowed;});
  await begun.promise;await turn();allowed=false;lock.exec("COMMIT");lock.close();await assert.rejects(pending,/authority revoked/);assert.equal(checks,2);
  assert.equal((await host.get("note")).body,"original");
  const updated=await host.save({...original,body:"updated"},original.updatedAt,"/project",()=>true);
  await assert.rejects(host.save(original,original.updatedAt,"/project",()=>true),/changed on the computer/);
  await assert.rejects(host.save({...updated,body:"wrong project"},updated.updatedAt,"/other",()=>true),/another project/);
  assert.equal((await host.get("note")).body,"updated");await host.close();
} else if(scenario==="wrong-db") {
  const path=database("expected",true),other=database("wrong",true);const host=notes([path]);await host.list();
  const actual=worker(host).postMessage.bind(worker(host));
  worker(host).postMessage=(packet,...args)=>{const forged=structuredClone(packet);forged.paths=[other];forged.comparison.bindings[0].path=realpathSync(other);return actual(forged,...args);};
  await assert.rejects(host.save(input,0),/physical admission is unavailable/);assert.equal(host.admissionStatus.mode,"fault");
  for(const file of [path,other]) {assert.equal(read(file,"SELECT count(*) AS count FROM notes")[0].count,0);assert.equal(read(file,"SELECT name FROM pragma_table_info('notes') WHERE name='content_updated_at'").length,0);}
  await assert.rejects(host.save(input,0),/physical admission is unavailable/);await host.close();
} else if(scenario==="missing-comparison") {
  const path=database("comparison",true);const host=notes([path]);await host.list();const actual=worker(host).postMessage.bind(worker(host));
  worker(host).postMessage=(packet,...args)=>{const missing=structuredClone(packet);delete missing.comparison;return actual(missing,...args);};
  await assert.rejects(host.save(input,0),/comparison is unavailable/);assert.equal(host.admissionStatus.mode,"fault");assert.equal(read(path,"SELECT count(*) AS count FROM notes")[0].count,0);assert.equal(read(path,"SELECT name FROM pragma_table_info('notes') WHERE name='content_updated_at'").length,0);await host.close();
} else if(scenario==="error-exit") {
  const path=database("error");const host=notes([path]);const original=await host.save(input,0);const old=worker(host);
  const gate=deferred(),entered=deferred();let checks=0;
  // Discard the public waiter; the exact original SQL+lease still belong to host.
  const pending=host.save({...original,body:"original after observation"},original.updatedAt,"/project",()=>{if(++checks===1)return true;entered.resolve();return gate.promise;});void pending.catch(()=>{});
  await entered.promise;const store=bind(path),closing=store.tryBeginClose();assert.ok(closing);old.emit("error",new Error("isolated observation failure"));await assert.rejects(pending,/A write may have completed/);
  assert.equal(store.tryUpgrade(closing),null);let done=false;const close=host.close().then(()=>{done=true});await turn();assert.equal(done,false);assert.equal(host.admissionStatus.mode,"fault");
  gate.resolve(true);await until(()=>read(path,"SELECT body FROM notes")[0].body==="original after observation");await old.terminate();await close;
  const closed=store.tryUpgrade(closing);assert.ok(closed);store.releaseClosed(closed);
  assert.deepEqual(read(path,"SELECT body FROM actual_writes ORDER BY sequence").map(x=>x.body),["original","original after observation"]);
} else if(scenario==="close-uncertain") {
  const path=database("close");const wrapper=join(root,"uncertain-close.mjs");
  writeFileSync(wrapper,'import {DatabaseSync} from "node:sqlite";const committed=new WeakSet();const exec=DatabaseSync.prototype.exec,close=DatabaseSync.prototype.close;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==="COMMIT")committed.add(this);return result;};DatabaseSync.prototype.close=function(){const result=close.call(this);if(committed.has(this))throw new Error("isolated close observation lost");return result;};await import('+JSON.stringify(pathToFileURL(join(root,"..","host-notes-worker.mjs")).href)+');');
  const host=notes([path],pathToFileURL(wrapper));const saved=await host.save(input,0);assert.equal(saved.body,"original");assert.equal(host.admissionStatus.mode,"fault");
  const store=bind(path),closing=store.tryBeginClose();assert.ok(closing);assert.equal(store.tryUpgrade(closing),null);
  await assert.rejects(host.save({...input,id:"blocked"},0),/physical admission is unavailable/);
  let done=false;const close=host.close().then(()=>{done=true});await turn();assert.equal(done,false);await worker(host).terminate();await close;
  const closed=store.tryUpgrade(closing);assert.ok(closed);store.releaseClosed(closed);assert.equal(read(path,"SELECT count(*) AS count FROM notes")[0].count,1);
} else if(scenario==="factory") {
  const path=database("factory");const owner=new HostNotesAdmission({admissionArtifact:artifact});const accepted=owner.accept([path],true);assert.ok(accepted);
  const factory=createHostNotesDatabaseFactory(accepted.comparison);const db=factory.open(path,{readOnly:true});assert.throws(()=>db.loadExtension(artifact,native.sqliteExtensionEntryPoint()));assert.equal(factory.connectionsClosed(),false);db.close();assert.equal(factory.connectionsClosed(),true);accepted.finishActual();
  const store=bind(path),closing=store.tryBeginClose();assert.ok(closing);const closed=store.tryUpgrade(closing);assert.ok(closed);store.releaseClosed(closed);
} else if(scenario==="release-fault") {
  const path=database("release");const probe=bind(path),prototype=Object.getPrototypeOf(probe),release=prototype.releaseWriter;
  prototype.releaseWriter=function(){throw new Error("isolated release observation failure before actual release");};
  const host=notes([path]);const saved=await host.save(input,0);assert.equal(saved.body,"original");assert.equal(host.admissionStatus.mode,"fault");
  prototype.releaseWriter=release;
  const closing=probe.tryBeginClose();assert.ok(closing);assert.equal(probe.tryUpgrade(closing),null);
  await assert.rejects(host.save({...input,id:"blocked"},0),/physical admission is unavailable/);await host.close();
  assert.equal(probe.tryUpgrade(closing),null);assert.equal(read(path,"SELECT count(*) AS count FROM notes")[0].count,1);
  probe.releaseClosing(closing); // Original failed release remains retained, never automatically retried.
} else if(scenario==="lost-commit") {
  const path=database("lost");const wrapper=join(root,"lost-commit.mjs");
  writeFileSync(wrapper,'import {parentPort} from "node:worker_threads";const post=parentPort.postMessage.bind(parentPort);parentPort.postMessage=(reply,...rest)=>{if(reply.value?.body==="committed without reply"){process.nextTick(()=>{throw new Error("isolated lost reply AFTER actualCOMMIT")});return;}return post(reply,...rest);};await import('+JSON.stringify(pathToFileURL(join(root,"..","host-notes-worker.mjs")).href)+');');
  const host=notes([path],pathToFileURL(wrapper));const pending=host.save({...input,body:"committed without reply"},0);const store=bind(path),closing=store.tryBeginClose();assert.ok(closing);assert.equal(store.tryUpgrade(closing),null);
  await assert.rejects(pending,/A write may have completed/);await host.close();assert.equal(host.admissionStatus.mode,"fault");
  const closed=store.tryUpgrade(closing);assert.ok(closed);store.releaseClosed(closed);assert.deepEqual(read(path,"SELECT body FROM actual_writes").map(x=>x.body),["committed without reply"]);
} else if(scenario==="manifest") {
  const sha=createHash("sha256").update(readFileSync(artifact)).digest("hex");const bundle=join(root,"bundle");mkdirSync(bundle);
  const manifest={schemaVersion:2,mechanicalAbiVersion:2,target:process.platform+"-"+process.arch,artifact:"admission-"+sha+".node",sha256:sha,rustTarget:"fixture-information",sourceFingerprint:"ignored-runtime-metadata"};
  copyFileSync(artifact,join(bundle,manifest.artifact));writeFileSync(join(bundle,"physical-store-admission.json"),JSON.stringify(manifest));assert.equal(new HostNotesAdmission({},bundle).status.mode,"joined");
  const bad=join(root,"bad");mkdirSync(bad);writeFileSync(join(bad,"physical-store-admission.json"),JSON.stringify(manifest));writeFileSync(join(bad,manifest.artifact),"different bytes");assert.equal(new HostNotesAdmission({},bad).status.mode,"fault");
  if(process.platform==="win32") {const long=join(root,"long-"+"é".repeat(70));mkdirSync(long);const longArtifact=join(long,manifest.artifact);copyFileSync(artifact,longArtifact);assert.ok(Buffer.byteLength(toNamespacedPath(realpathSync(longArtifact)),"utf8")>260);assert.equal(new HostNotesAdmission({admissionArtifact:longArtifact}).status.mode,"fault");}
} else throw new Error("Unknown owned scenario");
console.log(JSON.stringify({scenario,passed:true,abi:native.mechanicalAbiVersion()}));
`;
beforeAll(async () => {
  if (!artifact) return;
  await build({
    stdin: {
      contents: driverSource,
      resolveDir: resolve("."),
      sourcefile: "host/host-notes-admission.fixture.ts",
      loader: "ts",
    },
    outfile: driver,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    loader: { ".ps1": "text", ".md": "text" },
    define: { "import.meta.hot": "undefined" },
  });
  await build({
    entryPoints: [fileURLToPath(new URL("./host-notes-worker.mjs", import.meta.url))],
    outfile: join(folder, "host-notes-worker.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    loader: { ".ps1": "text", ".md": "text" },
    define: { "import.meta.hot": "undefined" },
  });
});
async function run(scenario: string) {
  const root = join(folder, scenario);
  mkdirSync(root);
  const output = await new Promise<string>((resolveResult, reject) => {
    const child = spawn(process.execPath, [driver, scenario, root], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BYCODA_HOST_NOTES_ADMISSION_ARTIFACT: artifact },
    });
    let captured = "";
    const capture = (chunk: Buffer) => {
      captured = (captured + chunk.toString()).slice(-32768);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 20000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolveResult(captured);
      else
        reject(
          new Error(
            `Owned ${scenario} fixture ${timedOut ? "timed out" : `exited ${code}`}: ${captured}`,
          ),
        );
    });
  });
  expect(output).toContain(JSON.stringify({ scenario, passed: true, abi: 2 }));
}
for (const scenario of [
  "queue",
  "all-or-nothing",
  "authority",
  "wrong-db",
  "missing-comparison",
  "error-exit",
  "close-uncertain",
  "factory",
  "release-fault",
  "lost-commit",
  "manifest",
])
  it.skipIf(!artifact)(`actual API2 addon and production SQLite worker: ${scenario}`, () =>
    run(scenario),
  );
