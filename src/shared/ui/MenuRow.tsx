import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import styles from "./arc/context-menu/context-menu.module.css";
export const menuRowClassName = styles.item;
export type MenuRowProps = ComponentProps<"button"> & {
  destructive?: boolean;
  branchWidth?: number;
};
/**
 * Menu row presentation only (icon, label, shortcut, chevron, active state); owns no open state, focus or keyboard handling.
 * `menuRowClassName` gives the same look to rows you render yourself.
 * @group overlay
 * @use Rows of an existing domain-owned or native nested menu controller that cannot use DropdownMenu.
 * @avoid New menus: DropdownMenu (trigger) or ContextMenu (right-click); they own focus, typeahead and submenus.
 * @arc context-menu
 */
export function MenuRow({
  destructive,
  className,
  ref,
  branchWidth = 228,
  ...props
}: ComponentProps<"button"> & { destructive?: boolean; branchWidth?: number }) {
  const row = useRef<HTMLButtonElement>(null);
  const [branchSide, setBranchSide] = useState("right");
  const hasBranch = props["aria-haspopup"] === "menu";
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps submenu direction in step with popup DOM placement and viewport resize listeners
  useLayoutEffect(() => {
    if (!hasBranch || !row.current) return;
    const update = () => {
      const bounds = row.current?.getBoundingClientRect();
      if (!bounds) return;
      const right = window.innerWidth - bounds.right - 12;
      const left = bounds.left - 12;
      setBranchSide(right >= branchWidth || right >= left ? "right" : "left");
    };
    update();
    const frame = row.current.closest("[data-popover-side]")?.parentElement;
    const observer = new MutationObserver(update);
    if (frame) observer.observe(frame, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [hasBranch, branchWidth]);
  return (
    <button
      {...props}
      ref={(element) => {
        row.current = element;
        if (typeof ref === "function") return ref(element);
        if (ref) ref.current = element;
      }}
      data-branch-side={hasBranch ? branchSide : undefined}
      className={`bycoda-arc ${styles.item} ${destructive ? styles.destructive : ""} ${className ?? ""}`}
    />
  );
}
