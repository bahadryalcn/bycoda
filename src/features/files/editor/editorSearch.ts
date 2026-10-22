import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, Prec, type Extension, type SelectionRange } from "@codemirror/state";
import {
  EditorView,
  keymap,
  runScopeHandlers,
  type KeyBinding,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { MOD, ALT, SHIFT, IS_MAC } from "../../../platform/tauri/platform";
import { keybindingPressed } from "../../settings/model/settings";
import { handleFilePreviewFindKey, openFindInActiveFilePreview } from "../ui/FilePreviewSearch";
import { t } from "../../../shared/i18n";
import { nativeButtonPresentation } from "../../../shared/ui/Button";

const MATCH_CAP = 999;
const panels = new WeakMap<EditorView, FindPanel>();

type SearchMatchRange = { from: number; to: number };

export function matchIndexAtSelection(
  matches: SearchMatchRange[],
  selection: { from: number; to: number },
): number {
  let low = 0;
  let high = matches.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const match = matches[middle];
    if (match.from < selection.from || (match.from === selection.from && match.to < selection.to)) {
      low = middle + 1;
    } else if (
      match.from > selection.from ||
      (match.from === selection.from && match.to > selection.to)
    ) {
      high = middle - 1;
    } else {
      return middle + 1;
    }
  }
  return 0;
}

export function handleEditorFindKey(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;

  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      "[data-file-picker], [data-model-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker]",
    )
  ) {
    return false;
  }

  if (handleFilePreviewFindKey(event)) return true;

  const view = editorViewForFind();
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  const defaultReplace =
    !event.shiftKey &&
    ((mod && event.altKey && key === "f") ||
      (!IS_MAC && event.ctrlKey && !event.metaKey && !event.altKey && key === "h"));
  const defaultFind = mod && !event.altKey && !event.shiftKey && key === "f";
  if (
    (defaultReplace && !keybindingPressed("Editor: Replace", event, true)) ||
    (defaultFind && !keybindingPressed("Editor: Find", event, true))
  ) {
    event.preventDefault();
    return true;
  }

  if (keybindingPressed("Editor: Replace", event, defaultReplace)) {
    if (!view) return false;
    event.preventDefault();
    openReplacePanel(view);
    return true;
  }

  if (keybindingPressed("Editor: Find", event, defaultFind)) {
    if (!view) return false;
    event.preventDefault();
    openSearchPanel(view);
    return true;
  }

  if (event.key === "F3" || (mod && !event.altKey && key === "g")) {
    if (!view) return false;
    event.preventDefault();
    (event.shiftKey ? findPrevious : findNext)(view);
    return true;
  }

  if (event.key === "Escape") {
    if (!view || !searchPanelOpen(view.state)) return false;
    event.preventDefault();
    closeSearchPanel(view);
    return true;
  }

  return false;
}

function isUsableEditorElement(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return !isHiddenEditorHost(node);
}

export function isHiddenEditorHost(node: {
  closest: (selector: string) => unknown;
  checkVisibility?: () => boolean;
}): boolean {
  if (node.closest(".hidden, .invisible, [hidden], [aria-hidden='true']")) {
    return true;
  }
  if (typeof node.checkVisibility === "function" && !node.checkVisibility()) {
    return true;
  }
  return false;
}

function editorElementForFind(): HTMLElement | null {
  const focused = focusedEditorElement();
  if (focused && isUsableEditorElement(focused)) return focused;
  for (const node of document.querySelectorAll(".cm-editor")) {
    if (node instanceof HTMLElement && isUsableEditorElement(node)) return node;
  }
  return null;
}

function focusedEditorElement(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof Element) {
    const fromActive = active.closest(".cm-editor");
    if (fromActive instanceof HTMLElement) return fromActive;
  }
  const focused = document.querySelector(".cm-editor.cm-focused");
  return focused instanceof HTMLElement ? focused : null;
}

function editorViewForFind(): EditorView | null {
  const el = editorElementForFind();
  return el ? EditorView.findFromDOM(el) : null;
}

export function openFindInActiveEditor(): boolean {
  if (openFindInActiveFilePreview()) return true;
  const view = editorViewForFind();
  if (!view) return false;
  openSearchPanel(view);
  return true;
}

export function openReplacePanel(view: EditorView): boolean {
  openSearchPanel(view);
  panels.get(view)?.setReplaceVisible(true, true);
  return true;
}

function findKeymap(): KeyBinding[] {
  return [
    {
      key: "Mod-f",
      run: openSearchPanel,
      scope: "editor search-panel",
      preventDefault: true,
    },
    {
      key: "Mod-Alt-f",
      run: openReplacePanel,
      scope: "editor search-panel",
      preventDefault: true,
    },
    ...(!IS_MAC
      ? [
          {
            key: "Ctrl-h",
            run: openReplacePanel,
            scope: "editor search-panel",
            preventDefault: true,
          },
        ]
      : []),
    {
      key: "F3",
      run: findNext,
      shift: findPrevious,
      scope: "editor search-panel",
      preventDefault: true,
    },
    {
      key: "Mod-g",
      run: findNext,
      shift: findPrevious,
      scope: "editor search-panel",
      preventDefault: true,
    },
    {
      key: "Escape",
      run: closeSearchPanel,
      scope: "editor search-panel",
    },
  ];
}

class FindPanel implements Panel {
  readonly view: EditorView;
  readonly dom: HTMLElement;
  readonly top = true;
  query: SearchQuery;
  private replaceVisible = false;
  private composing = false;
  private readonly searchField: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly replaceField: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;
  private readonly regexButton: HTMLButtonElement;
  private readonly expandButton: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private matches: SearchMatchRange[] = [];
  private countCapped = false;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    panels.set(view, this);

    this.searchField = inputField("Find", {
      name: "search",
      "main-field": "true",
      value: this.query.search,
    });
    this.replaceField = inputField("Replace", {
      name: "replace",
      value: this.query.replace,
    });
    this.count = elt("span", { class: "cm-find-count" });
    this.clearButton = iconButton(
      "cm-find-step cm-find-clear",
      t("Clear search"),
      "",
      svgIcon("M4.5 4.5l7 7M11.5 4.5l-7 7"),
    );
    this.clearButton.addEventListener("pointerdown", (event) => event.preventDefault());
    this.clearButton.addEventListener("click", () => {
      this.searchField.value = "";
      this.commit(false);
      this.searchField.focus();
    });
    this.caseButton = toggleButton("Aa", "Match Case", `${ALT}C`);
    this.wordButton = toggleButton("ab", "Match Whole Word", `${ALT}W`);
    this.regexButton = toggleButton(".*", "Use Regular Expression", `${ALT}R`);
    this.expandButton = iconButton(
      "cm-find-expand",
      "Toggle Replace",
      IS_MAC ? `${MOD}${ALT}F` : "Ctrl+H",
      svgIcon("M6 4l4 4-4 4"),
    );
    this.expandButton.setAttribute("aria-expanded", "false");

    const prevButton = iconButton(
      "cm-find-step",
      "Previous Match",
      `${MOD}${SHIFT}G`,
      svgIcon("M4 10l4-4 4 4"),
    );
    const nextButton = iconButton("cm-find-step", "Next Match", `${MOD}G`, svgIcon("M4 6l4 4 4-4"));
    const closeButton = iconButton(
      "cm-find-close",
      "Close",
      "Escape",
      svgIcon("M4.5 4.5l7 7M11.5 4.5l-7 7"),
    );

    this.replaceRow = elt(
      "div",
      { class: "cm-find-row cm-find-replace-row" },
      elt("div", { class: "cm-find-query" }, this.replaceField),
      elt(
        "div",
        { class: "cm-find-replace-actions" },
        textButton("Replace", () => replaceNext(this.view)),
        textButton("Replace all", () => replaceAll(this.view)),
      ),
    );

    this.dom = elt(
      "div",
      { class: "cm-find", onkeydown: (event) => this.onKeyDown(event) },
      this.expandButton,
      elt(
        "div",
        { class: "cm-find-fields" },
        elt(
          "div",
          { class: "cm-find-row" },
          elt("div", { class: "cm-find-query cm-find-search" }, this.searchField, this.clearButton),
          elt(
            "div",
            { class: "cm-find-controls" },
            this.count,
            elt(
              "div",
              { class: "cm-find-toggles" },
              this.caseButton,
              this.wordButton,
              this.regexButton,
            ),
            elt("div", { class: "cm-find-nav" }, prevButton, nextButton, closeButton),
          ),
        ),
        this.replaceRow,
      ),
    );

    this.searchField.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.searchField.addEventListener("compositionend", () => {
      this.composing = false;
      this.commit(true);
    });
    this.searchField.addEventListener("input", () => {
      if (!this.composing) this.commit(true);
    });
    this.replaceField.addEventListener("input", () => this.commit(false));
    this.caseButton.addEventListener("click", () => this.toggle("caseSensitive"));
    this.wordButton.addEventListener("click", () => this.toggle("wholeWord"));
    this.regexButton.addEventListener("click", () => this.toggle("regexp"));
    this.expandButton.addEventListener("click", () =>
      this.setReplaceVisible(!this.replaceVisible, this.replaceVisible),
    );
    prevButton.addEventListener("click", () => findPrevious(this.view));
    nextButton.addEventListener("click", () => findNext(this.view));
    closeButton.addEventListener("click", () => closeSearchPanel(this.view));

    this.syncControls();
    this.refreshCount();
  }

  mount() {
    this.searchField.select();
    this.reveal();
  }

  destroy() {
    panels.delete(this.view);
  }

  update(update: ViewUpdate) {
    let queryChanged = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (!effect.is(setSearchQuery)) continue;
        queryChanged = true;
        if (!effect.value.eq(this.query)) {
          this.query = effect.value;
          this.searchField.value = this.query.search;
          this.replaceField.value = this.query.replace;
          this.syncControls();
        }
      }
    }
    if (update.docChanged || queryChanged) {
      this.refreshCount();
    } else if (update.selectionSet) {
      this.syncCount();
    }
  }

  setReplaceVisible(visible: boolean, focusReplace = false) {
    this.replaceVisible = visible;
    this.dom.classList.toggle("is-replace", visible);
    this.expandButton.setAttribute("aria-expanded", String(visible));
    if (!visible && this.view.root.activeElement === this.replaceField) this.searchField.focus();
    if (visible && focusReplace) {
      this.replaceField.focus();
      this.replaceField.select();
    }
  }

  private toggle(flag: "caseSensitive" | "wholeWord" | "regexp") {
    this.query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive:
        flag === "caseSensitive" ? !this.query.caseSensitive : this.query.caseSensitive,
      wholeWord: flag === "wholeWord" ? !this.query.wholeWord : this.query.wholeWord,
      regexp: flag === "regexp" ? !this.query.regexp : this.query.regexp,
      literal: true,
    });
    this.syncControls();
    this.view.dispatch({ effects: setSearchQuery.of(this.query) });
    this.reveal();
  }

  private commit(reveal: boolean) {
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: this.query.caseSensitive,
      wholeWord: this.query.wholeWord,
      regexp: this.query.regexp,
      literal: true,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
    if (reveal) this.reveal();
  }

  private reveal() {
    if (this.view.root.activeElement === this.view.contentDOM) return;
    const query = getSearchQuery(this.view.state);
    if (!query.valid) return;
    const selection = this.view.state.selection.main;
    const forward = query.getCursor(this.view.state, selection.from);
    let match = nextMatch(forward);
    if (!match) {
      match = nextMatch(query.getCursor(this.view.state, 0, selection.from));
    }
    if (!match) return;
    if (selection.from === match.from && selection.to === match.to) return;
    const range = EditorSelection.single(match.from, match.to);
    this.view.dispatch({
      selection: range,
      effects: scrollToSearchMatch(range.main, this.view),
      userEvent: "select.search",
    });
  }

  private syncControls() {
    setPressed(this.caseButton, this.query.caseSensitive);
    setPressed(this.wordButton, this.query.wholeWord);
    setPressed(this.regexButton, this.query.regexp);
  }

  private refreshCount() {
    if (!this.searchField.value || !this.query.valid) {
      this.matches = [];
      this.countCapped = false;
    } else {
      const result = countMatches(this.view);
      this.matches = result.matches;
      this.countCapped = result.capped;
    }
    this.syncCount();
  }

  private syncCount() {
    const value = this.searchField.value;
    this.clearButton.hidden = !value;
    if (!value) {
      this.count.textContent = "";
      this.count.dataset.state = "idle";
      this.dom.classList.remove("is-empty", "is-invalid");
      return;
    }
    if (!this.query.valid) {
      this.count.textContent = "Invalid regex";
      this.count.dataset.state = "invalid";
      this.dom.classList.add("is-invalid");
      this.dom.classList.remove("is-empty");
      return;
    }

    const total = this.matches.length;
    const current = matchIndexAtSelection(this.matches, this.view.state.selection.main);
    const capped = this.countCapped;
    this.dom.classList.toggle("is-empty", total === 0);
    this.dom.classList.remove("is-invalid");
    if (total === 0) {
      this.count.textContent = "No results";
      this.count.dataset.state = "empty";
      return;
    }
    const suffix = capped ? "+" : "";
    this.count.textContent = current > 0 ? `${current} of ${total}${suffix}` : `${total}${suffix}`;
    this.count.dataset.state = "ok";
  }

  private onKeyDown(event: Event) {
    const keyEvent = event as KeyboardEvent;
    if (runScopeHandlers(this.view, keyEvent, "search-panel")) {
      keyEvent.preventDefault();
      return;
    }
    if (keyEvent.target instanceof Element && keyEvent.target.closest("button")) return;
    if (keyEvent.altKey && !keyEvent.metaKey && !keyEvent.ctrlKey && !keyEvent.shiftKey) {
      if (keyEvent.code === "KeyC") {
        keyEvent.preventDefault();
        this.toggle("caseSensitive");
        return;
      }
      if (keyEvent.code === "KeyW") {
        keyEvent.preventDefault();
        this.toggle("wholeWord");
        return;
      }
      if (keyEvent.code === "KeyR") {
        keyEvent.preventDefault();
        this.toggle("regexp");
        return;
      }
    }
    if (keyEvent.key !== "Enter") return;
    keyEvent.preventDefault();
    if (keyEvent.target === this.replaceField) {
      replaceNext(this.view);
      return;
    }
    (keyEvent.shiftKey ? findPrevious : findNext)(this.view);
  }
}

function countMatches(view: EditorView): {
  matches: SearchMatchRange[];
  capped: boolean;
} {
  const query = getSearchQuery(view.state);
  if (!query.valid) return { matches: [], capped: false };
  const cursor = query.getCursor(view.state);
  const matches: SearchMatchRange[] = [];
  for (let match = nextMatch(cursor); match; match = nextMatch(cursor)) {
    matches.push({ from: match.from, to: match.to });
    if (matches.length >= MATCH_CAP) return { matches, capped: true };
  }
  return { matches, capped: false };
}

function nextMatch(
  cursor: Iterator<{ from: number; to: number }>,
): { from: number; to: number } | null {
  const result = cursor.next();
  return result.done ? null : result.value;
}

function inputField(label: string, attrs: Record<string, string>): HTMLInputElement {
  return elt("input", {
    type: "text",
    placeholder: label,
    "aria-label": label,
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    ...attrs,
  });
}

function toggleButton(label: string, title: string, shortcut: string) {
  const button = panelButton(
    {
      type: "button",
      class: "cm-find-toggle",
      title: shortcut ? `${title} (${shortcut})` : title,
      "aria-label": title,
      "aria-pressed": "false",
    },
    label,
  );
  return button;
}

function iconButton(className: string, title: string, shortcut: string, icon: Node) {
  return panelButton(
    {
      type: "button",
      class: className,
      title: shortcut ? `${title} (${shortcut})` : title,
      "aria-label": title,
    },
    icon,
  );
}

function textButton(label: string, onClick: () => void) {
  return panelButton(
    {
      type: "button",
      class: "cm-find-text",
      onclick: onClick,
    },
    label,
  );
}

function panelButton(attrs: Attrs, child: Node | string) {
  const { className, ...presentation } = nativeButtonPresentation({
    iconOnly: typeof child !== "string",
  });
  return elt(
    "button",
    { ...presentation, ...attrs, class: `${className} ${attrs.class ?? ""}` },
    child,
  );
}

function setPressed(button: HTMLButtonElement, pressed: boolean) {
  button.setAttribute("aria-pressed", String(pressed));
  button.classList.toggle("is-active", pressed);
  button.toggleAttribute("data-button-selected", pressed);
}

function svgIcon(path: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of path.split("M").slice(1)) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", `M${d}`);
    svg.append(node);
  }
  return svg;
}

type Attrs = Record<string, string | boolean | ((event: Event) => void) | null | undefined>;

function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Array<Node | string | null | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        continue;
      }
      if (value === true) {
        node.setAttribute(key, "");
        continue;
      }
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (!child) continue;
    node.append(child);
  }
  return node;
}

const findTheme = EditorView.theme(
  {
    "&": {
      position: "relative",
    },
    ".cm-panels.cm-panels-top": {
      position: "sticky",
      insetBlockStart: "0",
      width: "100%",
      minWidth: "0",
      maxWidth: "none",
      flexShrink: "0",
      zIndex: "40",
      backgroundColor: "var(--ui-surface)",
      border: "0",
      borderBottom: "1px solid var(--color-stroke)",
      pointerEvents: "auto",
    },
    ".cm-panel.cm-find": {
      display: "flex",
      alignItems: "stretch",
      gap: "4px",
      boxSizing: "border-box",
      width: "min(100%, 520px)",
      marginInlineStart: "auto",
      padding: "4px 6px",
      border: "0",
      backgroundColor: "transparent",
      color: "var(--color-content)",
    },
    ".cm-find-expand": {
      width: "24px",
      height: "26px",
      flexShrink: "0",
      alignSelf: "start",
    },
    ".cm-find-expand svg": {
      flexShrink: "0",
    },
    ".cm-find.is-replace .cm-find-expand svg": {
      transform: "rotate(90deg)",
    },
    ".cm-find-fields": {
      display: "flex",
      flex: "1",
      flexDirection: "column",
      gap: "4px",
      minWidth: "0",
    },
    ".cm-find-row": {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "4px",
      minWidth: "0",
    },
    ".cm-find-replace-row": {
      display: "none",
    },
    ".cm-find.is-replace .cm-find-replace-row": {
      display: "flex",
    },
    ".cm-find-query": {
      display: "flex",
      alignItems: "center",
      boxSizing: "border-box",
      minInlineSize: "min(100%, 150px)",
      flex: "1 1 170px",
      height: "26px",
      padding: "0 8px",
      border: "1px solid var(--color-stroke)",
      borderRadius: "6px",
      backgroundColor: "var(--ui-surface-raised)",
    },
    ".cm-find-query:focus-within": {
      borderColor: "var(--ui-border-accent)",
    },
    ".cm-find.is-empty .cm-find-search, .cm-find.is-invalid .cm-find-search": {
      borderColor: "var(--color-danger)",
    },
    ".cm-find input": {
      width: "0",
      minWidth: "0",
      flex: "1",
      height: "24px",
      margin: "0",
      padding: "0",
      border: "0",
      outline: "none",
      background: "transparent",
      color: "var(--color-content)",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
      userSelect: "text",
    },
    ".cm-find-count": {
      boxSizing: "border-box",
      minInlineSize: "0",
      flex: "none",
      paddingInlineEnd: "4px",
      overflow: "hidden",
      color: "var(--ui-text-secondary)",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      fontVariantNumeric: "tabular-nums",
      textAlign: "start",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-find-count[data-state=empty], .cm-find-count[data-state=invalid]": {
      color: "var(--color-danger)",
    },
    ".cm-find-count[data-state=idle]": {
      display: "none",
    },
    ".cm-find-controls": {
      display: "flex",
      flex: "1 1 max-content",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "4px",
      minWidth: "0",
    },
    ".cm-find-nav": {
      marginInlineStart: "auto",
    },
    ".cm-find-toggles, .cm-find-nav, .cm-find-replace-actions": {
      display: "flex",
      alignItems: "center",
      gap: "2px",
      flexShrink: "0",
    },
    ".cm-find-replace-actions": {
      flexWrap: "wrap",
      maxInlineSize: "100%",
    },
    ".cm-find-toggle": {
      width: "24px",
      height: "24px",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      fontWeight: "500",
    },
    ".cm-find-step, .cm-find-close": {
      width: "24px",
      height: "24px",
    },
    ".cm-find-clear[hidden]": {
      display: "none",
    },
    ".cm-find-text": {
      height: "24px",
      padding: "0 8px",
      fontSize: "11px",
    },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--color-search) 46%, transparent)",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 52%, transparent)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "color-mix(in srgb, var(--color-content) 14%, transparent)",
    },
  },
  { dark: true },
);

function scrollToSearchMatch(range: SelectionRange, view: EditorView) {
  const coords = view.coordsAtPos(range.from);
  const scroller = view.scrollDOM;
  if (coords) {
    const rect = scroller.getBoundingClientRect();
    if (coords.top >= rect.top && coords.bottom <= rect.bottom) {
      return EditorView.scrollIntoView(range, { y: "nearest", yMargin: 24 });
    }
  }
  return EditorView.scrollIntoView(range, { y: "center" });
}

export const editorSearch: Extension = [
  search({
    top: true,
    literal: true,
    createPanel: (view) => new FindPanel(view),
    scrollToMatch: scrollToSearchMatch,
  }),
  highlightSelectionMatches(),
  Prec.high(keymap.of(findKeymap())),
  findTheme,
];
