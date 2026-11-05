import { createHash, randomUUID } from "node:crypto";
import { mergeNativeLibraryProofs } from "../assistant/native/assistant-native-library-proof";
import { captureLiveVoiceGeneration } from "../assistant/voice/assistant-voice-status";
import type { ServerBindings } from "./bindings";
export function registerAssistantNarration(
  dependencies: Pick<
    ServerBindings,
    | "social"
    | "engine"
    | "nativeAdmissionOwner"
    | "conversationDesktop"
    | "assistantPorts"
    | "roomVisibleProject"
    | "visibilityAdmission"
    | "assistant"
    | "observationJournal"
  >,
) {
  dependencies.assistantPorts.withRoomProjectDisclosure = async (
    threadId,
    projectIds,
    admission,
    effect,
    projectProofs,
  ) => {
    const ids = [...new Set(projectIds)];
    if (!ids.length) return effect(() => true);
    const initialThread = await dependencies.assistant.threadBinding(threadId);
    if (!initialThread || initialThread.id !== threadId)
      throw new Error("Room disclosure source is unavailable.");
    const authorized = async () => {
      if (admission.signal?.aborted || !(await admission.authorized())) return false;
      const current = await dependencies.assistant.threadBinding(threadId);
      return !!current && current.id === threadId && current.projectId === initialThread.projectId;
    };
    const requestId = randomUUID();
    const operationHash = createHash("sha256")
      .update(JSON.stringify(["room.disclosure", threadId, ids.slice().sort(), requestId]))
      .digest("hex");
    const captures: Array<{
      envelope: unknown;
      expected: import("../assistant/native/assistant-visibility-admission").ExpectedVisibilityCapture;
    }> = [];
    for (const projectId of ids) {
      const project = await dependencies.engine.store.project(projectId);
      const result = (await dependencies.conversationDesktop.callAssistantThread(
        "privacy.scope.capture",
        { action: "room.disclosure", requestId, operationHash },
        {
          threadId,
          environmentId: dependencies.engine.store.environmentId,
          projectId,
          targetProjectCwd: project.cwd,
        },
        authorized,
      )) as { relayId: string; envelope: unknown };
      captures.push({
        envelope: result.envelope,
        expected: {
          environmentId: dependencies.engine.store.environmentId,
          threadId,
          projectId,
          targetCwd: project.cwd,
          action: "room.disclosure",
          requestId,
          operationHash,
          relayId: result.relayId,
        },
      });
    }
    const proofs = [...(projectProofs ?? [])];
    if (proofs.some((proof) => !ids.includes(proof.projectId)))
      throw new Error("Room disclosure contains an unqualified project source.");
    for (const item of captures) {
      const expected = proofs.filter((proof) => proof.projectId === item.expected.projectId);
      if (expected.some((proof) => proof.cwd !== item.expected.targetCwd))
        throw new Error("Room project identity changed before disclosure.");
      if (!expected.length)
        proofs.push({ projectId: item.expected.projectId, cwd: item.expected.targetCwd });
    }
    return dependencies.visibilityAdmission.withCaptures(captures, authorized, (valid) =>
      dependencies.engine.store.withProjectIdentityRead(proofs, async (identityValid) => {
        if (!valid() || !identityValid()) throw new Error("Room project scope revoked.");
        return effect(() => valid() && identityValid());
      }),
    );
  };

  dependencies.assistantPorts.withSummarySourceDisclosure = async (
    targetThreadId,
    projectProofs,
    accountProofs,
    effect,
    expectedNative,
    nativeSources = [],
  ) => {
    const actor = await dependencies.assistant.globalRoomBinding();
    const target = await dependencies.assistant.threadBinding(targetThreadId);
    if (!actor || !target || target.id !== targetThreadId)
      throw new Error("Summary Room source is unavailable.");
    const nativeProofs = mergeNativeLibraryProofs(nativeSources);
    if (
      nativeProofs.some(
        (proof) =>
          proof.environmentId !== dependencies.engine.store.environmentId ||
          proof.threadId !== actor.id,
      )
    )
      throw new Error("Summary Native library source changed.");
    if (projectProofs.length > 1000 || accountProofs.length > 100)
      throw new Error("Summary source scope is too large.");
    const authorized = async () => {
      const current = await dependencies.assistant.threadBinding(targetThreadId);
      return (
        (await dependencies.assistant.globalRoomBinding())?.id === actor.id &&
        !!current &&
        current.id === target.id &&
        current.projectId === target.projectId
      );
    };
    if (
      !(await authorized()) ||
      (accountProofs.length &&
        !(await dependencies.social.assistantAccountProofsValid(actor.id, accountProofs)))
    )
      throw new Error("Summary source access is unavailable.");
    const requestId = randomUUID();
    const operationHash = createHash("sha256")
      .update(
        JSON.stringify([
          "summary.disclosure",
          targetThreadId,
          projectProofs,
          accountProofs,
          requestId,
        ]),
      )
      .digest("hex");
    const checkIssuer = (envelope: unknown) => {
      if (
        expectedNative &&
        JSON.parse(String((envelope as { operationJson?: unknown })?.operationJson)).issuer !==
          expectedNative.issuer
      )
        throw new Error("Native disclosure window changed.");
    };
    const run = async (valid: () => boolean) => {
      if (
        expectedNative &&
        !(await dependencies.nativeAdmissionOwner.current(
          expectedNative.installationId,
          expectedNative.revision,
        ))
      )
        throw new Error("Native disclosure trust changed.");
      return effect(valid);
    };
    const verifyNative = (
      identity: import("../assistant/native/assistant-visibility-admission").VisibilityIdentity & {
        issuer: string;
      },
    ) => {
      if (
        nativeProofs.some(
          (proof) =>
            proof.installationId !== identity.installationId ||
            proof.issuer !== identity.issuer ||
            proof.registryRevision !== identity.registryRevision ||
            proof.visibilityEpoch !== identity.visibilityEpoch ||
            proof.policyGeneration !== identity.policyGeneration,
        )
      )
        throw new Error("Summary Native library privacy changed.");
    };
    if (!projectProofs.length) {
      if (!accountProofs.length && !expectedNative && !nativeProofs.length)
        throw new Error("Summary source scope is unavailable.");
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        "privacy.account.capture",
        { requestId, operationHash },
        {
          threadId: actor.id,
          environmentId: dependencies.engine.store.environmentId,
          ...(expectedNative ? { targetDeviceHash: expectedNative.deviceHash } : {}),
        },
        authorized,
      )) as { relayId: string; envelope: unknown };
      checkIssuer(captured.envelope);
      return dependencies.visibilityAdmission.withAccountCapture(
        captured.envelope,
        {
          environmentId: dependencies.engine.store.environmentId,
          threadId: actor.id,
          relayId: captured.relayId,
          requestId,
          operationHash,
        },
        authorized,
        (nativeValid, identity) => {
          verifyNative(identity);
          return accountProofs.length
            ? dependencies.social.withAssistantAccountProofs(
                actor.id,
                accountProofs,
                authorized,
                (accountValid) => run(() => nativeValid() && accountValid()),
              )
            : run(nativeValid);
        },
      );
    }
    const captures: Array<{
      envelope: unknown;
      expected: import("../assistant/native/assistant-visibility-admission").ExpectedVisibilityCapture;
    }> = [];
    for (const proof of projectProofs) {
      if ((await dependencies.engine.store.project(proof.projectId)).cwd !== proof.cwd)
        throw new Error("Summary project identity changed.");
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        "privacy.scope.capture",
        { action: "summary.disclosure", requestId, operationHash },
        {
          threadId: actor.id,
          environmentId: dependencies.engine.store.environmentId,
          projectId: proof.projectId,
          targetProjectCwd: proof.cwd,
          ...(expectedNative ? { targetDeviceHash: expectedNative.deviceHash } : {}),
        },
        authorized,
      )) as { relayId: string; envelope: unknown };
      checkIssuer(captured.envelope);
      captures.push({
        envelope: captured.envelope,
        expected: {
          environmentId: dependencies.engine.store.environmentId,
          threadId: actor.id,
          projectId: proof.projectId,
          targetCwd: proof.cwd,
          action: "summary.disclosure",
          requestId,
          operationHash,
          relayId: captured.relayId,
        },
      });
    }
    const nativeCaptures: Array<{
      envelope: unknown;
      expected: {
        environmentId: string;
        threadId: string;
        relayId: string;
        requestId: string;
        operationHash: string;
      };
    }> = [];
    if (nativeProofs.length) {
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        "privacy.account.capture",
        { requestId, operationHash },
        { threadId: actor.id, environmentId: dependencies.engine.store.environmentId },
        authorized,
      )) as { relayId: string; envelope: unknown };
      nativeCaptures.push({
        envelope: captured.envelope,
        expected: {
          environmentId: dependencies.engine.store.environmentId,
          threadId: actor.id,
          requestId,
          operationHash,
          relayId: captured.relayId,
        },
      });
    }
    return dependencies.visibilityAdmission.withCaptures(
      captures,
      authorized,
      (nativeValid, identity) =>
        dependencies.engine.store.withProjectIdentityRead(projectProofs, async (projectValid) => {
          verifyNative(identity);
          const valid = () => nativeValid() && projectValid();
          if (!valid()) throw new Error("Summary source access changed.");
          if (!accountProofs.length) return run(valid);
          return dependencies.social.withAssistantAccountProofs(
            actor.id,
            accountProofs,
            authorized,
            (accountValid) => run(() => valid() && accountValid()),
          );
        }),
      nativeCaptures,
    );
  };

  dependencies.assistantPorts.withVoiceNarrationAuthorization = async (
    input,
    admission,
    effect,
  ) => {
    const authorized = async () =>
      !admission.signal?.aborted &&
      admission.environmentId === dependencies.engine.store.environmentId &&
      /^[a-f0-9]{64}$/.test(admission.deviceHash) &&
      (await admission.authorized()) &&
      (await dependencies.assistant.globalRoomBinding())?.id === input.threadId;
    if (!(await authorized()) || input.projectIds.length > 100)
      throw new Error("Voice narration source unavailable.");
    const requestId = randomUUID();
    const operationHash = createHash("sha256")
      .update(JSON.stringify(["narration", input, admission.deviceHash, requestId]))
      .digest("hex");
    const expected = {
      environmentId: dependencies.engine.store.environmentId,
      threadId: input.threadId,
      generationKey: input.generation,
      requestId,
      operationHash,
    };
    const captured = (await dependencies.conversationDesktop.callAssistantThread(
      "voice.generation.status",
      { generationKey: input.generation, requestId, operationHash },
      {
        threadId: input.threadId,
        environmentId: dependencies.engine.store.environmentId,
        targetDeviceHash: admission.deviceHash,
      },
      authorized,
    )) as { relayId: string; envelope: unknown };
    const native = await captureLiveVoiceGeneration(
      dependencies.nativeAdmissionOwner,
      expected,
      captured,
      authorized,
    );
    const projects = await Promise.all(
      [...new Set(input.projectIds)].map(async (projectId) => ({
        projectId,
        cwd: (await dependencies.engine.store.project(projectId)).cwd,
      })),
    );
    return dependencies.assistantPorts.withSummarySourceDisclosure!(
      input.threadId,
      projects,
      input.accountProofs ?? [],
      async (valid) => {
        if (!valid() || !(await authorized())) throw new Error("Voice narration source changed.");
        if (input.accountProofs?.length)
          await dependencies.social.registerAssistantVoiceLease(
            {
              threadId: input.threadId,
              generationKey: input.generation,
              deviceHash: admission.deviceHash,
              accounts: input.accountProofs,
            },
            valid,
          );
        return effect(() => valid() && !admission.signal?.aborted);
      },
      { ...native, deviceHash: admission.deviceHash },
    );
  };

  dependencies.social.roomSendSourceAdmission = async (source) => {
    if ((await dependencies.assistant.globalRoomBinding())?.id !== source.threadId) return false;
    return source.projectId === null
      ? source.projectCwd === null
      : (await dependencies.engine.store.project(source.projectId)).cwd === source.projectCwd;
  };
}
