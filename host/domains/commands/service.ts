import {
  CommandDispatchParamsSchema,
  CommandsStatusParamsSchema,
  type CommandReceipt,
  type SessionCommand,
} from "../../../src/shared/model/host-contracts/session-commands";
import { assertDomainAuthority, type HostDomainContext } from "../context";
import { isApprovalOccurrenceId } from "../../../src/shared/model/approvalOccurrence";

export type DesktopCommandAcceptance = {
  commandId: string;
  sessionId: string;
  signature: string;
  principalId: string;
  ownerId: string;
  delivery: string;
  receipt: CommandReceipt;
};

export type PreparedDesktop = {
  commandId: string;
  clientId: string;
  ownerId: string;
  sessionId: string;
  delivery: string;
  revalidate: () => Promise<void>;
  current: () => boolean;
};

type Contextual = Extract<SessionCommand, { type: "contextual" }>;
type DesktopCommand = Extract<SessionCommand, { type: "cancel" | "approve" | "answer" }>;
export interface CommandAdmissionOptions {
  /** HTTP historically ignores unrelated top-level fields; WS stays strict. */
  legacy?: boolean;
}
type ModelTarget = {
  harness: Extract<SessionCommand, { type: "create" }>["harness"];
  model: string;
  modelSettings: Record<string, string>;
};
export interface CommandQueueSnapshot {
  claim?: { clientId: string };
  messages: {
    authorityGeneration?: number;
    id: string;
    text: string;
    intent?: string;
    attachments: { id: string; size: number }[];
    modelTarget?: ModelTarget;
  }[];
}
export interface CommandServicePorts<View> {
  repository: {
    receiptStatus(commandId: string): Promise<CommandReceipt | null | undefined>;
    desktopCommandStatus(
      commandId: string,
      principalId: string | undefined,
      signature?: string,
    ): Promise<CommandReceipt | undefined>;
    acceptDesktopCommand(
      input: DesktopCommandAcceptance,
      revalidate: () => Promise<void>,
    ): Promise<CommandReceipt>;
    transaction<T>(operation: () => Promise<T>): Promise<T>;
    readView(sessionId: string): Promise<View>;
    modelTarget(sessionId: string): Promise<ModelTarget>;
    adopt(sessionId: string): Promise<unknown>;
    touchWorkspace(sessionId: string): Promise<unknown>;
  };
  execution: {
    commandSignature(command: SessionCommand): string;
    persistenceReady(): boolean;
    /** Existing semantic admission (notes, prompts, accounts, workspace etc.). */
    validateCommand(raw: unknown): void;
    validateQuestionAttachments?(
      command: SessionCommand,
      context: HostDomainContext,
    ): Promise<void>;
    attachmentRefs(raw: unknown): readonly { id: string; size: number }[];
    previewContextual(command: Contextual, view: View): Promise<{ digest: string }>;
    command(command: SessionCommand, context?: HostDomainContext): Promise<CommandReceipt>;
    clearConversation(command: Extract<SessionCommand, { type: "send" }>): Promise<CommandReceipt>;
    rewind(command: Extract<SessionCommand, { type: "rewind" }>): Promise<CommandReceipt>;
    assertHostMayRun(sessionId: string): Promise<void>;
    isClearCommand(text: string): boolean;
  };
  queue: {
    reapStale(sessionId: string): Promise<CommandQueueSnapshot>;
    get(sessionId: string): Promise<CommandQueueSnapshot>;
    renew(sessionId: string, clientId: string): Promise<unknown>;
    assertSend(
      sessionId: string,
      id: string,
      clientId: string,
      revision: number,
      selected: boolean,
      authority: { epoch?: number; legacy: boolean },
    ): Promise<CommandQueueSnapshot>;
    consumed(sessionId: string, id: string): Promise<unknown>;
    sameModelTarget(a: ModelTarget, b: ModelTarget): boolean;
    kick(sessionId: string): void;
    leaseHeld(holder: string, detail: string): Error;
  };
  nativeProjection: {
    watch(sessionId: string): Promise<{ running?: boolean; revision: number } | undefined>;
    alive(): boolean;
    prepareDesktop(command: DesktopCommand, context: HostDomainContext): Promise<PreparedDesktop>;
    trackDesktop(prepared: PreparedDesktop): void;
    withRetiredWriters<T>(sessionId: string, operation: () => Promise<T>): Promise<T>;
  };
  crews: { ownerDirective(command: SessionCommand): Promise<unknown> };
}

/**
 * Shared admission and orchestration for HTTP and WS. Provider execution and
 * durable receipts stay behind the execution/repository ports; transport loss
 * after acceptance only loses the reply, never rolls back an accepted effect.
 */
export function createCommandService<View>(ports: CommandServicePorts<View>) {
  return {
    async status(params: unknown, context: HostDomainContext): Promise<CommandReceipt | null> {
      await assertDomainAuthority(context);
      const { commandId } = CommandsStatusParamsSchema.parse(params);
      const desktop = await ports.repository.desktopCommandStatus(commandId, context.principalId);
      if (desktop) {
        await assertDomainAuthority(context);
        return desktop;
      }
      const receipt = await ports.repository.receiptStatus(commandId);
      await assertDomainAuthority(context);
      return receipt ?? null;
    },
    async dispatch(
      raw: unknown,
      context: HostDomainContext,
      options: CommandAdmissionOptions = {},
    ): Promise<CommandReceipt> {
      await assertDomainAuthority(context);
      // Structural wire validation is distinct from the engine's semantic rules.
      const legacyShape =
        options.legacy && typeof raw === "object" && raw !== null && "type" in raw
          ? CommandDispatchParamsSchema.options.find(
              (schema) => schema.shape.type.value === raw.type,
            )
          : undefined;
      const command = legacyShape
        ? legacyShape.strip().parse(raw)
        : CommandDispatchParamsSchema.parse(raw);
      // Preserve semantic checks on even ignored HTTP fields (for example an
      // invalid noteCard attached to rewind), before using the typed projection.
      ports.execution.validateCommand(raw);
      if (command.type === "approve" && !isApprovalOccurrenceId(command.approvalOccurrenceId))
        throw new Error(
          "Approval request identity is missing or invalid. Refresh this request before responding.",
        );
      const sessionId = command.sessionId ?? "";
      const signature = ports.execution.commandSignature(command);
      const desktopReceipt = await ports.repository.desktopCommandStatus(
        command.commandId,
        context.principalId,
        signature,
      );
      if (desktopReceipt) {
        await assertDomainAuthority(context);
        return desktopReceipt;
      }
      const accepted = () => ports.repository.receiptStatus(command.commandId);

      if (command.type === "contextual") {
        if (await accepted()) {
          await assertDomainAuthority(context);
          const receipt = await ports.execution.command(command, context);
          await assertDomainAuthority(context);
          return receipt;
        }
        const reviewed = await ports.execution.previewContextual(
          command,
          await ports.repository.readView(sessionId),
        );
        if (reviewed.digest !== command.previewDigest)
          throw new Error("The reviewed context changed. Review it again before continuing.");
      }

      if (
        ["send", "steer", "compact", "configure", "plan", "rewind"].includes(command.type) &&
        (await ports.queue.reapStale(sessionId)).claim &&
        !(await accepted())
      )
        throw ports.queue.leaseHeld(
          String((await ports.queue.get(sessionId)).claim?.clientId ?? "desktop"),
          "The owning desktop is preparing a queued send. Wait for its acknowledgement.",
        );

      const queued = "queued" in command ? command.queued : undefined;
      if (queued && !(await accepted())) {
        if (command.type !== "send" && command.type !== "steer" && command.type !== "compact")
          throw new Error("Invalid queued command");
        await assertDomainAuthority(context);
        await ports.execution.assertHostMayRun(sessionId);
        const aware = queued.leaseAware === true;
        if (!aware) {
          await assertDomainAuthority(context);
          await ports.queue.renew(sessionId, queued.clientId);
        }
        const queue = await ports.queue.assertSend(
          sessionId,
          queued.id,
          queued.clientId,
          queued.revision,
          command.type === "steer" || queued.selected === true,
          { epoch: queued.epoch, legacy: !aware },
        );
        const row = queue.messages.find((entry) => entry.id === queued.id);
        if (row && row.authorityGeneration !== command.authorityGeneration)
          throw new Error("Queued message authority changed. Review it before sending.");
        if (
          !row ||
          (command.type === "compact"
            ? row.text.trim().toLowerCase() !== "/compact"
            : command.text !== row.text)
        )
          throw new Error("Queued message content changed.");
        if (
          row.modelTarget &&
          !ports.queue.sameModelTarget(
            row.modelTarget,
            await ports.repository.modelTarget(sessionId),
          )
        )
          throw new Error("Queued message model settings changed.");
        const rawAttachments =
          typeof raw === "object" && raw !== null && "attachments" in raw
            ? raw.attachments
            : undefined;
        const attachments = ports.execution.attachmentRefs(rawAttachments);
        const intent = row.intent === "plan" || row.intent === "build" ? row.intent : "default";
        const rawIntent =
          typeof raw === "object" && raw !== null && "intent" in raw ? raw.intent : undefined;
        if (
          JSON.stringify(attachments.map((file) => [file.id, file.size])) !==
            JSON.stringify(row.attachments.map((file) => [file.id, file.size])) ||
          (command.type !== "compact" && (rawIntent ?? "default") !== intent)
        )
          throw new Error("Queued message attachments or intent changed.");
      }

      if (
        (command.type === "steer" || command.type === "rewind") &&
        (await ports.nativeProjection.watch(sessionId))?.running
      )
        throw new Error(
          command.type === "rewind"
            ? "This desktop-owned turn must finish before its conversation can be rewound."
            : "This desktop-owned turn cannot be redirected through the host. Queue the message or stop it first.",
        );
      if (command.type === "rewind" && (await ports.queue.get(sessionId)).messages.length)
        throw new Error("Clear the queued messages before rewinding the conversation.");

      if (command.type === "cancel" || command.type === "approve" || command.type === "answer") {
        if (command.type === "approve" && (await accepted())) {
          // A move to desktop execution cannot bypass the original Host receipt's
          // exact command signature or enqueue the same identity as a new effect.
          await assertDomainAuthority(context);
          const receipt = await ports.execution.command(command, context);
          await assertDomainAuthority(context);
          return receipt;
        }
        if (command.type === "answer" && !(await accepted())) {
          await assertDomainAuthority(context);
          await ports.execution.validateQuestionAttachments?.(command, context);
          await assertDomainAuthority(context);
        }
        const watch = await ports.nativeProjection.watch(sessionId);
        if (watch?.running) {
          if (!ports.nativeProjection.alive())
            throw new Error(
              "The bycoda app on that computer isn't responding. Try again when it's open.",
            );
          await assertDomainAuthority(context);
          if (!context.principalId)
            throw new Error("Authenticated desktop command principal is required.");
          const prepared = await ports.nativeProjection.prepareDesktop(command, context);
          await assertDomainAuthority(context);
          const receipt = await ports.repository.acceptDesktopCommand(
            {
              commandId: command.commandId,
              sessionId,
              signature,
              principalId: context.principalId,
              ownerId: prepared.ownerId,
              delivery: prepared.delivery,
              receipt: { commandId: command.commandId, sessionId, revision: watch.revision },
            },
            async () => {
              await assertDomainAuthority(context);
              await prepared.revalidate();
            },
          );
          ports.nativeProjection.trackDesktop(prepared);
          return receipt;
        }
      }
      if (
        (command.type === "cancel" || command.type === "stopItem") &&
        !ports.execution.persistenceReady()
      ) {
        // The engine can control its verified current run without claiming a
        // durable receipt. Do not prevent it with adoption or an outer SQL write.
        await assertDomainAuthority(context);
        return ports.execution.command(command, context);
      }
      if (["send", "compact", "contextual"].includes(command.type) && !(await accepted())) {
        await assertDomainAuthority(context);
        await ports.execution.assertHostMayRun(sessionId);
      }
      if (command.type !== "create") {
        await assertDomainAuthority(context);
        await ports.repository.adopt(sessionId);
      }
      if (command.type === "send" && ports.execution.isClearCommand(command.text)) {
        if (
          (await ports.nativeProjection.watch(sessionId))?.running ||
          (await ports.queue.get(sessionId)).messages.length
        )
          throw new Error(
            "Stop the current turn and clear queued messages before clearing the conversation.",
          );
        await assertDomainAuthority(context);
        const receipt = await ports.execution.clearConversation(command);
        await assertDomainAuthority(context);
        return receipt;
      }
      if (command.type === "rewind") {
        await assertDomainAuthority(context);
        const receipt = await ports.execution.rewind(command);
        await assertDomainAuthority(context);
        return receipt;
      }
      // Utility generation can wait for a provider; never hold an SQL transaction
      // across that wait. The engine atomically records its title and receipt.
      if (command.type === "regenerateTitle") {
        await assertDomainAuthority(context);
        const receipt = await ports.execution.command(command, context);
        await assertDomainAuthority(context);
        return receipt;
      }
      const dispatch = () =>
        ports.repository.transaction(async () => {
          await assertDomainAuthority(context);
          const receipt = await ports.execution.command(command, context);
          // These are one admission unit with the receipt; cancellation must not
          // strand a consumed message or skip its accepted owner directive.
          if (
            queued &&
            (await ports.queue.get(sessionId)).messages.some((row) => row.id === queued.id)
          )
            await ports.queue.consumed(sessionId, queued.id);
          await ports.crews.ownerDirective(command);
          return receipt;
        });
      await assertDomainAuthority(context);
      const receipt = ["send", "compact", "contextual"].includes(command.type)
        ? await ports.nativeProjection.withRetiredWriters(sessionId, dispatch)
        : await dispatch();
      if (["send", "steer", "compact", "contextual", "shell"].includes(command.type))
        await ports.repository.touchWorkspace(sessionId);
      if (command.type === "usageLimit") ports.queue.kick(sessionId);
      await assertDomainAuthority(context);
      return receipt;
    },
  };
}
