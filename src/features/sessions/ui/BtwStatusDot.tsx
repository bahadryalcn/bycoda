import { useT } from "../../../shared/i18n";
import { StatusDot } from "../../../shared/ui/StatusDot";
import type { BtwThread } from "../model/session";

/** Side-thread lifecycle uses the same tones as its parent conversation. */
export function BtwStatusDot({ status }: { status: BtwThread["status"] }) {
  const t = useT();
  return (
    <StatusDot
      label={t(status === "running" ? "Running" : status === "error" ? "Failed" : "Done")}
      tone={status === "running" ? "accent" : status === "error" ? "danger" : "success"}
    />
  );
}
