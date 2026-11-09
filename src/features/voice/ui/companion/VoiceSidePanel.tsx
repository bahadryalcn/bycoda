import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { t } from "../../../../shared/i18n";
import { placeVoiceSidePanel, type VoiceSidePlacement } from "../../model/voiceSidePanel";
import styles from "./VoiceCompanionParts.module.css";

/**
 * Open question or job review beside the expanded companion, so the conversation stays in view.
 * It follows the companion as it moves or resizes, opens on the side with room (above it when
 * neither side fits, inside it in a small window) and scrolls to its actions when it opens.
 */
export function VoiceSidePanel({
  panel,
  openKey,
  children,
}: {
  panel: RefObject<HTMLElement | null>;
  /** Changes when a different question or review opens; scrolls the new one to its actions. */
  openKey: string;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<VoiceSidePlacement | null>(null);
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = placeVoiceSidePanel(node.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        setPlacement((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    // Dragging moves the companion through its inline style.
    const moves = new MutationObserver(measure);
    moves.observe(node, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      moves.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [panel]);
  const side = placement?.side;
  useEffect(() => {
    if (!side) return;
    // After the card focuses its first option, bring the answer actions into view.
    const frame = requestAnimationFrame(() => {
      const node = scroller.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [openKey, side]);
  if (!placement) return null;
  if (placement.side === "inline")
    return (
      <div ref={scroller as RefObject<HTMLDivElement>} className={styles.dock}>
        {children}
      </div>
    );
  return (
    <aside
      ref={scroller}
      aria-label={t("Question")}
      className={styles.side}
      data-side={placement.side}
      style={{
        left: placement.x,
        bottom: placement.bottom,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
    >
      {children}
    </aside>
  );
}
