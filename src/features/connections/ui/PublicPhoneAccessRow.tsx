import { useState } from "react";
import { t } from "../../../shared/i18n";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Row } from "../../../shared/ui/settings";
import { Switch } from "../../../shared/ui/Switch";
import type { RemoteMachine } from "../model/protocol";
import { issueCopy } from "./tunnelCopy";
import { useTunnelSession } from "./useTunnelSession";

/**
 * The owner's opt-in to let phones connect through this computer's public tunnels. Off by
 * default; turning it on asks first because the address is reachable from the whole internet
 * and only the phone's device credential protects it.
 */
export function PublicPhoneAccessRow({
  machine,
  active,
}: {
  machine: RemoteMachine;
  active: boolean;
}) {
  const { controller, state, overview, ready, run } = useTunnelSession(machine, active);
  const [confirmOn, setConfirmOn] = useState(false);
  const on = overview?.phonesOverPublic === true;
  const label = t("Allow phones over the public internet");
  return (
    <>
      <Row
        label={label}
        info={t(
          "Phones may use this computer's public tunnels (Cloudflare, ngrok, Tailscale Funnel) when you start one. Anyone on the internet can reach the address; only each phone's device credential protects it. Off by default.",
        )}
        feedback={
          state.issue ? (
            <InlineError>{issueCopy(state.issue)}</InlineError>
          ) : on ? (
            <InlineMessage tone="warning">
              {t("Phones can connect through public tunnels. Turn this off to refuse them.")}
            </InlineMessage>
          ) : undefined
        }
      >
        <Switch
          checked={on}
          disabled={!ready || overview?.phonesOverPublic === undefined}
          aria-label={label}
          onCheckedChange={(next) =>
            next
              ? setConfirmOn(true)
              : void run("phones", () => controller.setPhonesOverPublic(false))
          }
        />
      </Row>
      {confirmOn ? (
        <ConfirmDialog
          request={{
            title: t("Allow phones over the public internet?"),
            message: t(
              "Anyone on the internet can reach a public tunnel address. Phones would be protected only by their device credential, not by your network. Allow it only if you need to reach this computer away from your own networks.",
            ),
            confirmLabel: t("Allow public phone access"),
          }}
          onSettle={(confirmed) => {
            setConfirmOn(false);
            if (confirmed) void run("phones", () => controller.setPhonesOverPublic(true));
          }}
        />
      ) : null}
    </>
  );
}
