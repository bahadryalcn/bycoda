import { useId, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "../../../../src-tauri/icons/128x128.png";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { GripVertical, X } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import { InlineError } from "../../../shared/ui/InlineError";
import { Surface } from "../../../shared/ui/Surface";
import { dragPermissionApp, revealPermissionApp } from "../../../platform/tauri/systemPermissions";
import { PERMISSION_IDS, permissionInfo } from "../model/permissions";

/**
 * The companion card shown outside the System Settings window.
 */
export function PermissionHelper() {
  useLocale();
  const [error, setError] = useState<"finder" | "close" | null>(null);
  const instructionId = useId();
  const dragged = useRef(false);
  const query = new URLSearchParams(window.location.search).get("permission");
  const id = PERMISSION_IDS.find((id) => id === query);
  const reveal = () => {
    setError(null);
    return revealPermissionApp().catch(() => setError("finder"));
  };
  if (!id) return null;
  return (
    <Surface as="section" variant="floating" frame="card" className="m-1 flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Heading as="h1" size="item" className="min-w-0 flex-1">
          {permissionInfo(id).label}
        </Heading>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          label={t("Close")}
          onClick={() =>
            void getCurrentWindow()
              .close()
              .catch(() => setError("close"))
          }
        >
          <X aria-hidden />
        </Button>
      </div>
      {error ? (
        <InlineError>
          {error === "finder"
            ? t("Could not reveal bycoda in Finder.")
            : t("Could not close this window.")}
        </InlineError>
      ) : (
        <Text as="p" id={instructionId} size="secondary" tone="secondary">
          {t("Drag {p0} into the permission list.", { p0: PRODUCT_IDENTITY.displayName })}
        </Text>
      )}
      <Button
        variant="secondary"
        fullWidth
        controlMinHeight="large"
        align="start"
        className="cursor-grab"
        label={t("Reveal bycoda in Finder")}
        aria-describedby={error ? undefined : instructionId}
        draggable
        onPointerDown={() => {
          dragged.current = false;
        }}
        onClick={(event) => {
          if (event.detail === 0 || !dragged.current) return reveal();
        }}
        onDragStart={(event) => {
          event.preventDefault();
          if (dragged.current) return;
          dragged.current = true;
          setError(null);
          void dragPermissionApp().catch(reveal);
        }}
      >
        <img src={appIcon} alt="" width={28} height={28} draggable={false} className="shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <Text weight="medium" truncate>
            {PRODUCT_IDENTITY.displayName}
          </Text>
          <Text size="caption" tone="secondary">
            {t("Open in Finder")}
          </Text>
        </span>
        <GripVertical aria-hidden />
      </Button>
    </Surface>
  );
}
