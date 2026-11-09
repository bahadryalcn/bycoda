import type { ReactNode } from "react";
import { useLocale } from "../../../shared/i18n/git";
import { Modal } from "../../../shared/ui/Modal";
import styles from "./GitGraphLayout.module.css";

type Props = {
  title: string;
  /** Buttons and the search field, shown next to the title. */
  toolbar: ReactNode;
  onClose: () => void;
  children: ReactNode;
  expandable?: boolean;
};

/**
 * The full commit graph as a shared `Modal`: `full` width when it can expand, `xl` otherwise.
 * The toolbar sits beside the title, Escape inside the search field clears the field first
 * (`fieldEscape`), and the graph panes own their own scrolling (`scroll="none"`). Menus and the
 * commit hover card open above it through the dialog's popover layer.
 */
export function GitGraphDialog({ title, toolbar, onClose, children, expandable = false }: Props) {
  useLocale();
  return (
    <Modal
      padding="none"
      title={title}
      onClose={onClose}
      size={expandable ? "full" : "xl"}
      expandable={expandable}
      fieldEscape="field"
      scroll="none"
      className={expandable ? "h-[calc(100dvh-48px)]" : "h-[min(760px,calc(100dvh-48px))]"}
      toolbar={<div className={styles.toolbar}>{toolbar}</div>}
    >
      <div className="flex min-h-0 flex-1 flex-col border-t border-(--ui-pane-border)">
        {children}
      </div>
    </Modal>
  );
}
