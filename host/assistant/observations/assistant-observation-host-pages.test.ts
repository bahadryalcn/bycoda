import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { installAssistantObservationProducers } from "./assistant-observation-producers";
import { AssistantObservationHostPages } from "./assistant-observation-host-pages";
it("requires actual global Crew page disclosure and never exposes private fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-crew-pages-")); const store = new HostStore(join(dir,"host.db"));
  try {
    await store.ready; const journal = new AssistantObservationJournal(store); await installAssistantObservationProducers(store,journal);
    await store.db.prepare("INSERT INTO metadata VALUES(?,?)").run("crews.v2.state", JSON.stringify({ definitions:[{ id:"crew", name:"private" }], agents:[] }));
    const pages = new AssistantObservationHostPages(store), scope = { threadId:"room",generation:"capture",consumer:"crew" };
    expect(await pages.covered(scope)).toBe(false);
    const first = await pages.page(scope,0,undefined,()=>true); const id = (first.value as { snapshotId:string }).snapshotId;
    expect(JSON.stringify(first)).not.toContain("private");
    await expect(pages.page(scope,1,id,()=>true)).rejects.toThrow("order");
    await pages.delivered(scope,id,0,1,()=>true);
    expect((await pages.page(scope,1,id,()=>true)).complete).toBe(true);
    expect(await pages.covered(scope)).toBe(true);
    expect(await pages.covered({ ...scope,generation:"new" })).toBe(false);
  } finally { await store.close(); rmSync(dir,{ recursive:true,force:true }); }
});
