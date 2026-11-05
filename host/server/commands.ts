import { createHash } from "node:crypto";
import { type HostSession } from "../../src/features/connections/model/protocol";
import { sameQueuedModelTarget } from "../../src/features/sessions/model/messageQueue";
import { isClearSessionCommand } from "../../src/features/sessions/model/newSessionCommand";
import { LeaseHeldError } from "../../src/features/sync/model/runLease";
import { parseRemoteAttachments, resolveQuestionAttachments } from "../attachments/attachments";
import { createCommandService } from "../domains/commands/service";
import { HostDomainAuthorizationError } from "../domains/context";
import { parseCommand } from "../engine";
import type { ServerBindings } from "./bindings";
export function createCommandsRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "readSessionView"
    | "featureMetaStable"
    | "adopt"
    | "touchSessionWorkspace"
    | "questionBinding"
    | "attachmentOwnership"
    | "assertHostMayRun"
    | "sessionQueues"
    | "queueDrainer"
    | "desktopWatch"
    | "desktop"
    | "withRetiredDesktopWriters"
    | "crews"
  >,
) {
  const commandServiceValidation = async (
    command: import("../../src/shared/model/host-contracts/session-commands").SessionCommand,
    context: import("../domains/context").HostDomainContext,
  ) => {
    if (
      command.type !== "answer" ||
      command.reply.kind !== "answered" ||
      !command.reply.attachments
    )
      return;
    if (!(await context.authorized())) throw new HostDomainAuthorizationError();
    if (!context.principalId || !command.runId)
      throw new Error("Question attachment identity is unavailable");
    const ids = Object.values(command.reply.attachments)
      .flat()
      .map((file) => file.id);
    if (!ids.length) return;
    const occurrence = await dependencies.questionBinding(
      command.sessionId,
      command.runId,
      command.requestId,
    );
    await dependencies.attachmentOwnership.assertQuestion(
      context.principalId,
      ids,
      command.sessionId,
      command.runId,
      command.requestId,
      occurrence,
    );
    if (!(await context.authorized())) throw new HostDomainAuthorizationError();
  };
  const commandService = createCommandService<HostSession>({
    repository: {
      receiptStatus: (id) => dependencies.engine.store.receiptStatus(id),
      desktopCommandStatus: (id, principalId, signature) =>
        dependencies.engine.store.desktopCommandStatus(id, principalId, signature),
      acceptDesktopCommand: (input, revalidate) =>
        dependencies.engine.store.acceptDesktopCommand(input, revalidate),
      transaction: (operation) => dependencies.engine.store.transaction(operation, "critical"),
      readView: dependencies.readSessionView,
      modelTarget: async (id) => (await dependencies.featureMetaStable(id)).session,
      adopt: dependencies.adopt,
      touchWorkspace: dependencies.touchSessionWorkspace,
    },
    execution: {
      commandSignature: (command) =>
        createHash("sha256").update(JSON.stringify(command)).digest("hex"),
      persistenceReady: () => dependencies.engine.store.db.persistenceHealth().state === "ready",
      validateCommand: (command) => {
        parseCommand(command);
      },
      validateQuestionAttachments: commandServiceValidation,
      attachmentRefs: parseRemoteAttachments,
      previewContextual: (command, value) => dependencies.engine.previewContextual(command, value),
      command: (command, context) => {
        const original = context && { ...context, principalId: context.principalId };
        return dependencies.engine.command(command, async () => {
          if (!original) throw new Error("Question attachment identity is unavailable");
          await commandServiceValidation(command, original);
        });
      },
      clearConversation: (command) => dependencies.engine.clearConversation(command),
      rewind: (command) => dependencies.engine.rewind(command),
      assertHostMayRun: dependencies.assertHostMayRun,
      isClearCommand: isClearSessionCommand,
    },
    queue: {
      reapStale: (id) => dependencies.sessionQueues.reapStale(id),
      get: (id) => dependencies.sessionQueues.get(id),
      renew: (id, client) => dependencies.sessionQueues.renew(id, client),
      assertSend: (...args) => dependencies.sessionQueues.assertSend(...args),
      consumed: (id, message) => dependencies.sessionQueues.consumed(id, message),
      sameModelTarget: sameQueuedModelTarget,
      kick: (id) => dependencies.queueDrainer.kick(id),
      leaseHeld: (holder, detail) => new LeaseHeldError(holder, detail),
    },
    nativeProjection: {
      watch: dependencies.desktopWatch,
      alive: () => !!dependencies.desktop.live.alive(),
      prepareDesktop: async (command, context) => {
        let resolved = command;
        if (
          command.type === "answer" &&
          command.reply.kind === "answered" &&
          command.reply.attachments
        ) {
          await commandServiceValidation(command, context);
          const parsed = parseCommand(command);
          if (parsed.type !== "answer" || parsed.reply.kind !== "answered")
            throw new Error("Invalid question answer");
          const pending = dependencies.desktop.live.overlay(command.sessionId)?.patch
            .pendingQuestion;
          if (!pending || pending.requestId !== command.requestId)
            throw new Error("Question is already resolved");
          const attachments = Object.fromEntries(
            await Promise.all(
              Object.entries(parsed.reply.attachments ?? {}).map(async ([id, files]) => {
                const question = pending.questions.find((item) => item.id === id);
                if (!question?.allowCustom || question.preserveCustomWhitespace)
                  throw new Error("This question cannot accept attachments");
                return [
                  id,
                  await resolveQuestionAttachments(
                    dependencies.engine.store,
                    parseRemoteAttachments(files),
                  ),
                ] as const;
              }),
            ),
          );
          await commandServiceValidation(command, context);
          if (
            dependencies.desktop.live.overlay(command.sessionId)?.patch.pendingQuestion !== pending
          )
            throw new Error("Question changed while resolving attachments");
          resolved = { ...parsed, reply: { ...parsed.reply, attachments } };
        }
        const prepared = await dependencies.desktop.live.prepareDesktop(resolved);
        return {
          ...prepared,
          revalidate: async () => {
            // Accepted work outlives its transport wait, never its principal.
            if (!(await context.authorized())) throw new HostDomainAuthorizationError();
            await prepared.revalidate();
            if (!(await context.authorized())) throw new HostDomainAuthorizationError();
          },
        };
      },
      trackDesktop: (prepared) => dependencies.desktop.live.trackDesktop(prepared),
      withRetiredWriters: dependencies.withRetiredDesktopWriters,
    },
    crews: { ownerDirective: (command) => dependencies.crews.ownerDirective(command) },
  });
  return { commandService };
}
