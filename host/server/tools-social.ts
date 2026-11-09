import { type SocialPrincipal } from "../social/social";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
export async function handleSocialTools(
  dependencies: Pick<
    ServerBindings,
    "engine" | "social" | "nativeServicesService" | "socialTransport"
  >,
  request: Pick<
    HttpToolRequest,
    | "socialPrincipal"
    | "token"
    | "tokenHash"
    | "input"
    | "result"
    | "params"
    | "domainContext"
    | "endResult"
  >,
) {
  return await dependencies.engine.store.db.withAuthorization(
    request.socialPrincipal
      ? dependencies.social.authorization(request.token)
      : async () => await dependencies.engine.store.authenticated(request.token),
    async () => {
      const principal: SocialPrincipal = request.socialPrincipal ?? {
        kind: "owner",
        actorId: `device:${request.tokenHash}`,
        provider: "owner",
      };
      if (
        [
          "social.bridge.describe",
          "social.access.issue",
          "social.native.status",
          "social.native.enroll",
          "social.native.register",
          "social.native.authority",
          "social.native.reset",
        ].includes(String(request.input.method))
      ) {
        if (principal.kind !== "owner") throw new Error("Native owner device required.");
        request.result = await dependencies.nativeServicesService.legacy(
          request.input.method as Parameters<typeof dependencies.nativeServicesService.legacy>[0],
          request.params,
          request.domainContext,
        );
      } else if (String(request.input.method).startsWith("social.native.")) {
        if (principal.kind !== "owner") throw new Error("Native owner device required.");
        throw new Error("Unsupported native social operation.");
      } else
        request.result = await dependencies.socialTransport.rpc(
          principal,
          String(request.input.method),
          request.params,
        );
      await request.endResult(request.result, () =>
        dependencies.engine.store.db.checkAuthorization(),
      );
      return;
    },
  );
}
