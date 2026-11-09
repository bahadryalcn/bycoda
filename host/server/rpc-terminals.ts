import {
  desktopActorId,
  desktopOperationId,
  openDesktopResource,
  sealDesktopResource,
  type DesktopReviewScope,
} from "../desktop/reviewed-desktop-scope";
import { type TerminalAction } from "../domains/terminals/service";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleTerminalsRpc(
  dependencies: Pick<
    ServerBindings,
    "terminalService" | "desktopSigningSecret" | "engine" | "scopedDesktopCall"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "terminals.list":

    case "terminals.create":

    case "terminals.read":

    case "terminals.write":

    case "terminals.interrupt":

    case "terminals.close": {
      const action = request.input.method.slice("terminals.".length) as TerminalAction;
      request.result = await dependencies.terminalService[action](
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
    }

    case "terminals.pty.desktop.list":

    case "terminals.pty.desktop.create":

    case "terminals.pty.desktop.attach":

    case "terminals.pty.desktop.read":

    case "terminals.pty.desktop.write":

    case "terminals.pty.desktop.status":

    case "terminals.pty.desktop.resize":

    case "terminals.pty.desktop.detach":

    case "terminals.pty.desktop.close": {
      const mode = request.input.method.slice("terminals.pty.desktop.".length);
      const secret = await dependencies.desktopSigningSecret();
      const scope: DesktopReviewScope = {
        environmentId: dependencies.engine.store.environmentId,
        projectId: String(request.params.projectId ?? ""),
        sessionId: String(request.params.sessionId ?? ""),
        feature: "pty-mobile",
      };
      const leaseFields = ["terminalId", "epoch", "leaseId"];
      const fields =
        mode === "list"
          ? []
          : mode === "create"
            ? ["requestId", "profileId", "cols", "rows"]
            : mode === "attach"
              ? ["terminalId", "epoch", "requestId", "after", "freshRenderer"]
              : mode === "read"
                ? ["terminalId", "epoch", "after", "limit"]
                : mode === "close"
                  ? ["terminalId", "epoch", "requestId"]
                  : mode === "write"
                    ? [...leaseFields, "inputSequence", "dataBase64"]
                    : mode === "resize"
                      ? [...leaseFields, "cols", "rows"]
                      : mode === "status" && Object.hasOwn(request.params, "requestId")
                        ? ["requestId"]
                        : leaseFields;
      if (
        mode === "status" &&
        !Object.hasOwn(request.params, "requestId") &&
        leaseFields.some((key) => !Object.hasOwn(request.params, key))
      )
        throw new Error("PTY status requires an exact owned lease or create request identity");
      const bound = { ...request.params };
      for (const [key, role] of [
        ["terminalId", "terminal"],
        ["epoch", "epoch"],
        ["leaseId", "lease"],
      ] as const)
        if (Object.hasOwn(request.params, key))
          bound[key] = openDesktopResource(secret, request.token, scope, role, request.params[key]);
      if (Object.hasOwn(request.params, "requestId"))
        bound.requestId = desktopOperationId(
          secret,
          request.token,
          scope,
          request.params.requestId,
        );
      request.result = await dependencies.scopedDesktopCall(
        request.token,
        `ptyMobile.${mode}`,
        bound,
        fields,
        {
          actorId: desktopActorId(secret, request.token, scope),
        },
      );
      const seal = (value: unknown): Record<string, unknown> => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Invalid owned PTY response");
        const object = { ...(value as Record<string, unknown>) };
        for (const [key, role] of [
          ["terminalId", "terminal"],
          ["epoch", "epoch"],
          ["leaseId", "lease"],
        ] as const)
          if (Object.hasOwn(object, key))
            object[key] = sealDesktopResource(secret, request.token, scope, role, object[key]);
        return object;
      };
      const response = seal(request.result);
      if (Object.hasOwn(response, "terminal")) response.terminal = seal(response.terminal);
      if (Object.hasOwn(response, "terminals")) {
        if (!Array.isArray(response.terminals) || response.terminals.length > 128)
          throw new Error("Invalid owned PTY catalog");
        response.terminals = response.terminals.map(seal);
      }
      request.result = response;
      break;
    }
  }
}
