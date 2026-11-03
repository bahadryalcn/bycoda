import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Row } from "../settings/ui/settingsControls";
import { desktopHelperRequest } from "./desktopControlClient";
import type { DesktopHelperResponse } from "../../shared/model/host-contracts/desktop-helper";
import { InlineError } from "../../shared/ui/InlineError";

export function DesktopHelperSetup({
  disabled,
  onUse,
}: {
  disabled?: boolean;
  onUse: (helper: NonNullable<DesktopHelperResponse["helper"]>) => void;
}) {
  const [state, setState] = useState<DesktopHelperResponse>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false,
      reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await desktopHelperRequest({ op: "status" });
        if (!cancelled) {
          setState(next);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  async function act(op: "prepare" | "cancel") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      setState(await desktopHelperRequest({ op }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  const stage =
    state?.stage === "building"
      ? t("Building helper")
      : state?.stage === "verifying"
        ? t("Verifying helper")
        : t("Preparing helper");
  return (
    <Row
      stacked
      label={t("Verified computer helper")}
      description={t(
        "Prepare the pinned helper once, then use its verified path and checksum. Preparing it does not enable computer control.",
      )}
    >
      <div role="status">
        {state?.phase === "preparing"
          ? stage
          : state?.phase === "ready"
            ? t("Verified helper ready")
            : state?.phase === "interrupted"
              ? t("Preparation interrupted")
              : t("Helper not prepared")}
      </div>
      {(error || state?.error) && <InlineError>{error || state?.error}</InlineError>}
      {state?.phase === "preparing" ? (
        <Button type="button" loading={pending} onClick={() => void act("cancel")}>
          {t("Cancel preparation")}
        </Button>
      ) : state?.helper ? (
        <Button type="button" disabled={disabled || pending} onClick={() => onUse(state.helper!)}>
          {t("Use verified helper")}
        </Button>
      ) : (
        <Button
          type="button"
          loading={pending}
          disabled={disabled}
          onClick={() => void act("prepare")}
        >
          {t("Prepare verified helper")}
        </Button>
      )}
    </Row>
  );
}
