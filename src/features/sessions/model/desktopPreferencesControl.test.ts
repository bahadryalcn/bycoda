// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createDesktopPreferencesControl,
  type DesktopPreferencesSnapshot,
  type DesktopPreferencesStatus,
} from "./desktopPreferencesControl";
import { loadPromptTemplates } from "./promptTemplates";
import { loadProjectProviderSettings, setProjectProviderHidden } from "./projectProviders";
import {loadDefaultModels,loadLastModelChoice} from "./models";
import {loadGlobalSessionDefaults} from "./providerSessionDefaults";
const privacy = vi.hoisted(() => ({
  lockedGroupIds: new Set<string>(),
  lockedProjectKeys: new Set<string>(),
}));
vi.mock("../../group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: privacy }),
}));
beforeEach(() => {
  localStorage.clear();
  privacy.lockedGroupIds.clear();
  privacy.lockedProjectKeys.clear();
});
function fixture() {
  let valid = true;
  let number = 0;
  const control = createDesktopPreferencesControl({
    salt: () => "window",
    hash: async (text) => createHash("sha256").update(text).digest("hex"),
  });
  const context = {
    environmentId: "host",
    sourceSessionId: "session",
    projectCwd: "/project",
    workingCwd: "/checkout",
    valid: () => valid,
  };
  const read = async () =>
    (await control(context, "preferences.read", {})) as DesktopPreferencesSnapshot;
  const patch = async (change: Record<string, unknown>, revision?: string) =>
    (await control(context, "preferences.patch", {
      operationId: `op-${++number}`,
      expectedRevision: revision ?? (await read()).revision,
      change,
    })) as DesktopPreferencesStatus;
  return {
    control,
    context,
    read,
    patch,
    close: () => {
      valid = false;
    },
  };
}
it("reads cached metadata only, explicitly reads a reviewed body, and uses canonical template mutations", async () => {
  const f = fixture();
  expect((await f.read()).atomic).toBe(false);
  expect(
    (
      await f.patch({
        kind: "templateCreate",
        templateId: "one",
        name: "Saved",
        body: "Hello {{cursor}}",
        trigger: ";hi",
      })
    ).state,
  ).toBe("applied");
  const snapshot = await f.read();
  expect(snapshot.templates[0]).not.toHaveProperty("body");
  expect(
    await f.control(f.context, "preferences.templateRead", {
      templateId: "one",
      expectedRevision: snapshot.revision,
    }),
  ).toMatchObject({ template: { body: "Hello {{cursor}}", trigger: "hi" } });
  expect(
    (await f.patch({ kind: "templateUpdate", templateId: "one", name: "Changed", body: "Changed" }))
      .state,
  ).toBe("applied");
  expect(loadPromptTemplates()[0].body).toBe("Changed");
  expect((await f.patch({ kind: "templateDelete", templateId: "one" })).state).toBe("applied");
  expect(loadPromptTemplates()).toEqual([]);
});
it("refuses stale review, duplicate trigger, injected fields and unknown model without changing canonical data", async () => {
  const f = fixture();
  const stale = (await f.read()).revision;
  await f.patch({
    kind: "templateCreate",
    templateId: "one",
    name: "One",
    body: "Text",
    trigger: "same",
  });
  expect((await f.patch({ kind: "templateDelete", templateId: "one" }, stale)).state).toBe(
    "failed",
  );
  expect(
    (
      await f.patch({
        kind: "templateCreate",
        templateId: "two",
        name: "Two",
        body: "Text",
        trigger: "same",
      })
    ).state,
  ).toBe("failed");
  expect(
    (await f.patch({ kind: "globalDefaultModel", harness: "claude", model: "invented" })).state,
  ).toBe("failed");
  expect((await f.patch({ kind: "templateDelete", templateId: "one", cwd: "/other" })).state).toBe(
    "failed",
  );
  expect(loadPromptTemplates()).toHaveLength(1);
});
it("preserves hidden provider metadata when restoring project inheritance", async () => {
  const f = fixture();
  setProjectProviderHidden("/project", "codex", true);
  const snapshot = await f.read();
  const provider = snapshot.providers.find((row) => row.models.length && !row.hidden)!;
  expect(provider).toBeTruthy();
  expect(
    (
      await f.patch({
        kind: "projectDefaultProvider",
        harness: provider.id,
        model: provider.models[0].id,
      })
    ).state,
  ).toBe("applied");
  expect((await f.patch({ kind: "projectReset" })).state).toBe("applied");
  expect(loadProjectProviderSettings("/project")).toEqual({ hidden: ["codex"] });
});
it("updates only canonical future-session defaults, validating cached model settings and runtime choices",async()=>{
 const f=fixture(); const provider=(await f.read()).providers.find(row=>row.models.some(model=>model.settings.some(setting=>setting.options.length)))!;
 const model=provider.models.find(model=>model.settings.some(setting=>setting.options.length))!; const setting=model.settings.find(setting=>setting.options.length)!;
 for(const kind of ["globalDefaultProvider","globalDefaultModel","projectDefaultModel"])expect((await f.patch({kind,harness:provider.id,model:model.id})).state).toBe("applied");
 expect(loadLastModelChoice()).toEqual({harness:provider.id,model:model.id});expect(loadDefaultModels()[provider.id]).toBe(model.id);
 const wanted={...(provider.runtimeModes[0]?{runtimeMode:provider.runtimeModes[0]}:{}),...(setting.effort?{effort:setting.options[0].value}:{extras:{[setting.id]:setting.options[0].value}})};
 for(const kind of ["globalProviderDefaults","projectProviderDefaults"])expect((await f.patch({kind,harness:provider.id,model:model.id,defaults:wanted})).state).toBe("applied");
 expect(loadGlobalSessionDefaults()[provider.id]).toEqual(wanted);expect(loadProjectProviderSettings("/project").defaults?.[provider.id]).toEqual(wanted);
 const raw=localStorage.getItem("bycoda.providerSessionDefaults.v1");
 for(const invalid of [{runtimeMode:false},{extras:null},{extras:{secret:"not-a-model-option"}},{effort:123}])expect((await f.patch({kind:"globalProviderDefaults",harness:provider.id,model:model.id,defaults:invalid})).state).toBe("failed");
 expect(localStorage.getItem("bycoda.providerSessionDefaults.v1")).toBe(raw);
});
it("refuses a source that closes during patch review and reserves concurrent operation IDs before awaiting",async()=>{
 let open=true;let invalidate=false;
 const control=createDesktopPreferencesControl({salt:()=>"test",hash:async value=>{if(invalidate)open=false;return createHash("sha256").update(value).digest("hex");}});
 const context={environmentId:"host",sourceSessionId:"source",projectCwd:"/project",workingCwd:"/checkout",valid:()=>open};
 const snapshot=await control(context,"preferences.read",{}) as DesktopPreferencesSnapshot;invalidate=true;
 expect(await control(context,"preferences.patch",{expectedRevision:snapshot.revision,operationId:"closed",change:{kind:"templateCreate",templateId:"one",name:"One",body:"Text"}})).toMatchObject({state:"failed"});expect(loadPromptTemplates()).toEqual([]);
 const f=fixture();const revision=(await f.read()).revision;
 const results=await Promise.allSettled([f.control(f.context,"preferences.patch",{expectedRevision:revision,operationId:"same",change:{kind:"templateCreate",templateId:"one",name:"One",body:"Text"}}),f.control(f.context,"preferences.patch",{expectedRevision:revision,operationId:"same",change:{kind:"projectReset"}})]);
 expect(results.map(result=>result.status).sort()).toEqual(["fulfilled","rejected"]);expect(loadPromptTemplates()).toHaveLength(1);
});
it("binds receipts to exact input, never replays, rechecks privacy after await, and refuses closed sources", async () => {
  const f = fixture();
  const input = {
    operationId: "saved",
    expectedRevision: (await f.read()).revision,
    change: { kind: "templateCreate", templateId: "one", name: "One", body: "Text" },
  };
  expect(await f.control(f.context, "preferences.patch", input)).toMatchObject({
    state: "applied",
  });
  expect(await f.control(f.context, "preferences.patch", input)).toMatchObject({
    state: "applied",
  });
  expect(loadPromptTemplates()).toHaveLength(1);
  await expect(
    f.control(f.context, "preferences.patch", { ...input, change: { kind: "projectReset" } }),
  ).rejects.toThrow("identity");
  expect(await f.control(f.context, "preferences.status", { operationId: "missing" })).toEqual({
    state: "unknown",
  });
  f.close();
  await expect(f.read()).rejects.toThrow("unavailable");
  let open = true;
  const control = createDesktopPreferencesControl({
    hash: async () => {
      open = false;
      return "hash";
    },
  });
  await expect(
    control({ ...f.context, valid: () => open }, "preferences.read", {}),
  ).rejects.toThrow("unavailable");
});
