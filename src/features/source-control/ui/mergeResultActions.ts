import { Facet, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { t } from "../../../shared/i18n/git";
import { textAttributes, type TextRoles } from "../../../shared/ui/Text";
import {
  mergeResolution,
  mergeResolutionField,
  type MergeChoice,
  type MergeRegion,
  type MergeResolution,
} from "../model/mergeResolution";

/**
 * Gives a drawn (non-React) element the shared type roles a Text component would: the same
 * class and data attributes, so the role styles apply without a local class.
 */
export function applyTextRoles(element: HTMLElement, roles: TextRoles, className: string) {
  const { className: classes, ...attributes } = textAttributes(roles, className);
  element.className = classes;
  for (const [name, value] of Object.entries(attributes))
    if (value !== undefined) element.setAttribute(name, String(value));
}

/** Mirrors the React busy/disabled gate so drawn widgets update with it. */
export const mergeActionsDisabled = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

type Run = (id: number, choice: MergeChoice) => void;

const CHOICES = [
  ["ours", "Accept Current", "Accept Current (Alt+1)"],
  ["theirs", "Accept Incoming", "Accept Incoming (Alt+2)"],
  ["both", "Accept Both", "Accept Both: current, then incoming (Alt+3)"],
  ["manual", "Mark as Resolved", "Keep the text below as the resolution (Alt+4)"],
] as const;

export function regionStateLabel(region: MergeRegion) {
  switch (region.choice) {
    case "ours":
      return t("Current accepted");
    case "theirs":
      return t("Incoming accepted");
    case "both":
      return t("Both accepted");
    case "manual":
      return t("Resolved manually");
    default:
      return region.origin === "base"
        ? t("Unresolved · showing common ancestor")
        : t("Unresolved · showing current");
  }
}

/** Per-conflict actions sit directly above the text they replace. A CodeMirror
 * block widget is the specialized composite here, like the source gutter. */
class RegionActions extends WidgetType {
  constructor(
    readonly region: MergeRegion,
    readonly total: number,
    readonly active: boolean,
    readonly disabled: boolean,
    /** Reset applies to decided conflicts and to pending text edited by hand. */
    readonly resettable: boolean,
    readonly run: Run,
  ) {
    super();
  }
  override eq(other: RegionActions) {
    return (
      other.region.id === this.region.id &&
      other.region.choice === this.region.choice &&
      other.total === this.total &&
      other.active === this.active &&
      other.disabled === this.disabled &&
      other.resettable === this.resettable
    );
  }
  toDOM() {
    const { region } = this;
    const root = document.createElement("div");
    applyTextRoles(
      root,
      { size: "micro", tone: this.active ? "primary" : "secondary" },
      "conflict-inline-actions",
    );
    root.dataset.mergeWidget = String(region.id);
    root.dataset.active = String(this.active);
    root.dataset.state = region.choice ?? "pending";
    root.setAttribute("role", "group");
    root.setAttribute(
      "aria-label",
      t("Conflict {p0} of {p1}", { p0: region.id + 1, p1: this.total }),
    );
    const label = document.createElement("span");
    applyTextRoles(
      label,
      {
        size: "inherit",
        tone: region.choice ? "success" : "warning",
        weight: "medium",
      },
      "conflict-inline-label",
    );
    label.textContent = `${t("Conflict {p0} of {p1}", { p0: region.id + 1, p1: this.total })} · ${regionStateLabel(region)}`;
    root.append(label);
    const button = (choice: MergeChoice, text: string, title: string, pressed?: boolean) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "conflict-inline-choice";
      item.textContent = t(text);
      item.title = t(title);
      if (pressed !== undefined) item.setAttribute("aria-pressed", String(pressed));
      item.disabled = this.disabled || (choice === "reset" && !this.resettable);
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => this.run(region.id, choice));
      return item;
    };
    for (const [choice, text, title] of CHOICES)
      root.append(button(choice, text, title, region.choice === choice));
    root.append(button("reset", "Reset", "Restore the unresolved text"));
    return root;
  }
  override ignoreEvent() {
    return true;
  }
}

/** Navigation prefers unresolved conflicts, then plain order once all are decided. */
export function stepConflict({ regions, active }: MergeResolution, direction: 1 | -1) {
  const pending = regions.some((region) => region.choice === null);
  for (let offset = 1; offset <= regions.length; offset++) {
    const id = (active + direction * offset + regions.length * offset) % regions.length;
    if (!pending || regions[id].choice === null) return id;
  }
  return active;
}

export function mergeResultActions(run: Run, select: (id: number) => void): Extension {
  const choose = (choice: MergeChoice) => (view: EditorView) => {
    const { regions, active } = mergeResolution(view.state);
    if (!regions[active] || view.state.facet(mergeActionsDisabled)) return false;
    run(active, choice);
    return true;
  };
  return [
    EditorView.decorations.compute([mergeResolutionField, mergeActionsDisabled], (state) => {
      const merge = mergeResolution(state);
      const disabled = state.facet(mergeActionsDisabled);
      return Decoration.set(
        merge.regions.map((region) =>
          Decoration.widget({
            widget: new RegionActions(
              region,
              merge.regions.length,
              region.id === merge.active,
              disabled,
              region.choice !== null || state.sliceDoc(region.from, region.to) !== region.initial,
              run,
            ),
            block: true,
            side: -1,
          }).range(state.doc.lineAt(region.from).from),
        ),
        true,
      );
    }),
    keymap.of([
      { key: "Alt-1", run: choose("ours") },
      { key: "Alt-2", run: choose("theirs") },
      { key: "Alt-3", run: choose("both") },
      { key: "Alt-4", run: choose("manual") },
      { key: "F7", run: (view) => (select(stepConflict(mergeResolution(view.state), 1)), true) },
      {
        key: "Shift-F7",
        run: (view) => (select(stepConflict(mergeResolution(view.state), -1)), true),
      },
    ]),
  ];
}
