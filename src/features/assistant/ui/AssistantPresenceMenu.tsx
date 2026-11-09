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
  const items: DropdownMenuItem[] = [
    ...presence.items,
    { kind: "sep" },
    {
      kind: "item",
      id: "refresh",
      label: t("Refresh"),
      disabled: presence.busy || presence.pending || presence.writeError,
    },
  ];
  return (
    <div className="flex shrink-0 items-center px-1" data-assistant-presence>
      <Button
        ref={trigger}
        size="sm"
        variant="ghost"
        disabled={presence.busy || presence.pending}
        label={t("Availability: {p0}", { p0: label })}
        tooltip={
          error
            ? t("Availability change was not confirmed.")
            : t("Availability: {p0}", { p0: label })
        }
        aria-haspopup="menu"
        aria-expanded={presence.open}
        onClick={() => (presence.open ? presence.end() : presence.begin().catch(() => undefined))}
      >
        <AssistantPresenceIndicator state={state} label={label} className="max-w-24" />
      </Button>
      {error && (
        <InlineError icon={null} className="sr-only">
          {t("Availability change was not confirmed.")}
        </InlineError>
      )}
      {presence.open && (
        <DropdownMenu
          anchor={trigger}
          returnFocusRef={trigger}
          label={t("Availability")}
          items={items}
          onClose={presence.end}
          onPick={(id) => {
            if (id === "refresh") presence.begin().catch(() => undefined);
            else presence.pick(id);
          }}
        />
      )}
    </div>
  );
}
