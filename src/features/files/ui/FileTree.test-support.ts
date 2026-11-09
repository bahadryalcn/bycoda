import { registerAppConfirmHost } from "../../../shared/model/appConfirm";

// Deletion confirms through the in-app host; these tests drive it with a stubbed `confirm`.
let unregisterConfirmHost: (() => void) | undefined;
export function registerConfirmStub() {
  unregisterConfirmHost = registerAppConfirmHost(async (request) =>
    Boolean(globalThis.confirm?.(request.fallbackText ?? request.message)),
  );
}
export function unregisterConfirmStub() {
  unregisterConfirmHost?.();
}
