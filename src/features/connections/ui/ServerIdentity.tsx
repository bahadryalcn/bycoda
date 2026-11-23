import type { CSSProperties } from "react";
import { t } from "../../../shared/i18n";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Server, Terminal } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";

/**
 * User-selected identity color, independent from live machine connection status. The glyph says
 * what the entry is: a Host (a bycoda Host machine) or a plain SSH endpoint; the name sits on the
 * glyph's tooltip and accessible name instead of a text tag on the row.
 */
export function ServerIdentity({ accent, kind }: { accent?: string; kind?: "host" | "ssh" }) {
  const Glyph = kind === "ssh" ? Terminal : Server;
  const name = kind === "ssh" ? t("SSH") : kind === "host" ? t("Host") : undefined;
  const glyph = (
    <span
      {...(name ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
      {...surfaceAttributes(
        { radius: "control", variant: accent ? "user-color-tint" : "inset" },
        "flex size-8 shrink-0 items-center justify-center",
      )}
      style={{ "--surface-user-color": accent } as CSSProperties}
    >
      <Glyph aria-hidden className="icon-md" />
    </span>
  );
  return name ? <Tooltip label={name}>{glyph}</Tooltip> : glyph;
}
