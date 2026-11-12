import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { OPEN_CONNECTIONS_EVENT } from "../model/connections";

export function MissingRemoteMachine({
  compact,
  project,
  loaded,
}: {
  compact?: boolean;
  project: boolean;
  loaded: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex flex-col gap-2 p-2"
          : "flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      }
    >
      <Text as="p" size="secondary" tone="muted">
        {!project
          ? t(
              "This project’s machine details are missing. Add the project again from the project rail.",
            )
          : loaded
            ? t("The machine for this project isn’t connected on this computer.")
            : t("Connecting to the machine…")}
      </Text>
      {project && loaded ? (
        <Button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT))}
          variant="secondary"
        >
          {t("Manage machines")}
        </Button>
      ) : null}
    </div>
  );
}

/** A delegated controller contributes only its notices and request controls. */
export function RemoteSessionFrame({
  compact,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        compact ? "relative flex min-w-0 flex-col" : "relative flex h-full min-h-0 flex-col"
      }
    >
      {children}
    </div>
  );
}

export function RemoteSessionContent({
  compact,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return <div className={compact ? "min-w-0" : "min-h-0 flex-1"}>{children}</div>;
}
