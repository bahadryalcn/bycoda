import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";

it("waits for Native voice closure before disabling its profile and preserves settings on uncertain closure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-profile-voice-"));
  const store = new HostStore(join(directory, "host.db"));
  const entered = Promise.withResolvers<void>();
  const closure = Promise.withResolvers<void>();
  let unknown = true;
  const ports: AssistantPorts = { withNativeVoiceSourcesRetired: async effect => {
    entered.resolve();
    await closure.promise;
    if (unknown) throw new Error("Original Native runtime closure is unknown.");
    return effect(() => true);
  } };
  const assistant = new HostAssistant(store, ports);
  try {
    await assistant.ready;
    let profile = (await assistant.request({ op: "snapshot" }, "owner")).snapshot!.profile;
    profile = (await assistant.request({ op: "profile.update", expectedVersion: profile.version, patch: { enabled: true, setupComplete: true, voiceSetupComplete: true, name: "Assistant", dailyTokenBudget: 10000 } }, "owner")).profile!;
    let finished = false;
    const disabling = assistant.request({ op: "profile.update", expectedVersion: profile.version, patch: { enabled: false } }, "owner");
    void disabling.then(() => { finished = true; }, () => { finished = true; });
    await entered.promise;
    expect(finished).toBe(false);
    closure.resolve();
    await expect(disabling).rejects.toThrow("closure is unknown");
    profile = (await assistant.request({ op: "snapshot" }, "owner")).snapshot!.profile;
    expect(profile.enabled).toBe(true);
    unknown = false;
    const result = await assistant.request({ op: "profile.update", expectedVersion: profile.version, patch: { enabled: false } }, "owner");
    expect(result.profile!.enabled).toBe(false);
  } finally {
    await assistant.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
