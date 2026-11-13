import type { CSSProperties } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Server } from "../../../shared/ui/icons";

/** User-selected identity color, independent from live machine connection status. */
export function ServerIdentity({ accent }: { accent?: string }) {
  return (
    <span
      aria-hidden
      {...surfaceAttributes(
        { radius: "control", variant: accent ? "user-color-tint" : "fill-subtle" },
        "flex size-8 shrink-0 items-center justify-center",
      )}
      style={{ "--surface-user-color": accent } as CSSProperties}
    >
      <Server className="icon-md" />
    </span>
  );
}
