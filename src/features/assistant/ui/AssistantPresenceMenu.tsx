import { useRef } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { AssistantPresenceIndicator } from "./AssistantPresenceIndicator";
import { useAssistantPresence } from "../hooks/useAssistantPresence";
import {
  nativeAssistantPresencePort,
  type AssistantPresencePort,
} from "../model/assistantPresence";
import { InlineError } from "../../../shared/ui/InlineError";

/** Stand-alone availability menu; the desktop sidebar embeds the same state in the account menu. */
export function AssistantPresenceMenu({
  port = nativeAssistantPresencePort,
}: {
  port?: AssistantPresencePort;
}) {
  useLocale();
  const presence = useAssistantPresence(port);
  const trigger = useRef<HTMLButtonElement>(null);
  if (presence.hidden) return null;
  const { label, state, error } = presence;
  // The inline error below already announces the failure; the menu row would say it twice.
  // Opening the menu already re-reads availability, so no separate Refresh row is offered.
  const items: DropdownMenuItem[] = presence.items.filter(
    (item) => item.kind !== "item" || item.id !== "failure",
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center px-1" data-assistant-presence>
      <Button
        ref={trigger}
        size="sm"
        variant="ghost"
        disabled={presence.busy || presence.pending}
        label={t("Availability: {p0}", { p0: label })}
        title=""
        aria-haspopup="menu"
        aria-expanded={presence.open}
        onClick={() => (presence.open ? presence.end() : presence.begin().catch(() => undefined))}
      >
        <AssistantPresenceIndicator state={state} label={label} className="max-w-24" />
      </Button>
      {error && <InlineError>{t("Availability change could not be confirmed.")}</InlineError>}
      {presence.open && (
        <DropdownMenu
          anchor={trigger}
          returnFocusRef={trigger}
          label={t("Availability")}
          items={items}
          onClose={presence.end}
          onPick={presence.pick}
        />
      )}
    </div>
  );
}
