import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button, type ButtonVariant } from "../../../shared/ui/Button";
import { restartToApplyPermission } from "../../../platform/tauri/systemPermissions";

/** Restarts through the shared save-and-confirm quit so macOS applies a grant switched on in System Settings. */
export function PermissionRestartButton({ variant }: { variant?: ButtonVariant }) {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const restart = () => {
    setState("pending");
    restartToApplyPermission().then(
      () => setState("idle"),
      () => setState("failed"),
    );
  };
  return (
    <Button
      variant={variant}
      loading={state === "pending"}
      reserveLabels={[t("Retry")]}
      onClick={restart}
    >
      {state === "failed" ? t("Retry") : t("Restart now")}
    </Button>
  );
}
