import { useFormat, useT } from "../../../shared/i18n";
import type { LiveGamesStatus } from "../../../shared/model/host-contracts/live-games";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";

/**
 * Schematic of the browser-source layout for the chosen aspect ratio. It mirrors Host state only;
 * the real overlay runs on the loopback server, which the desktop frame policy does not embed.
 */
export function OverlayPreview({
  aspect,
  clean,
  snapshot,
}: {
  aspect: "9:16" | "16:9";
  clean: boolean;
  snapshot: LiveGamesStatus["snapshot"];
}) {
  const t = useT();
  const { formatNumber } = useFormat();
  const portrait = aspect === "9:16";
  const dancers = snapshot.dancers.slice(0, portrait ? 5 : 4);
  return (
    <Surface
      variant="inset"
      padding="sm"
      role="img"
      aria-label={t("Overlay preview {p0}", { p0: aspect })}
      className={[
        "flex shrink-0 flex-col justify-between gap-2 overflow-hidden",
        portrait ? "aspect-[9/16] w-32" : "aspect-video w-56",
      ].join(" ")}
    >
      <Text size="micro" tone="secondary" truncate>
        {clean
          ? aspect
          : t("{p0} · {p1} watching", { p0: aspect, p1: formatNumber(snapshot.viewers) })}
      </Text>
      {dancers.length === 0 ? (
        <Text size="micro" tone="muted" className="text-center">
          {t("Dancers appear here")}
        </Text>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1">
          {dancers.map((dancer) => (
            <li key={dancer.id} className="min-w-0">
              <Text size="micro" weight={dancer.role === "dancer" ? undefined : "medium"} truncate>
                {dancer.name}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <span aria-hidden="true" />
    </Surface>
  );
}
