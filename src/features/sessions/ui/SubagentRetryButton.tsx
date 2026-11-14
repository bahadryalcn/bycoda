import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RotateCcw } from "../../../shared/ui/icons";

/** Sends a failed child the same task again; a refusal stays on the button so it can be pressed again. */
export function SubagentRetryButton({ onRetry }: { onRetry: () => Promise<void> }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const retry = () => {
    setState("pending");
    onRetry().then(
      () => setState("idle"),
      () => setState("failed"),
    );
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      className="self-start"
      disabled={state === "pending"}
      onClick={retry}
      data-subagent-retry
    >
      <RotateCcw className="icon-sm" aria-hidden />
      {state === "pending"
        ? t("Retrying…")
        : state === "failed"
          ? t("Could not retry. Try again")
          : t("Retry")}
    </Button>
  );
}
