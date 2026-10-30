import { Alert } from "../../../shared/ui/Alert";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import {
  announceDrag,
  setDropFeedback,
  setDropIndicator,
  setGrabbing,
  type DropPlacement,
} from "../../../shared/lib/drag";
import { useEffect, useRef, useState, type PointerEvent, type UIEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import {
  columnTransitions,
  jiraBoardConfiguration,
  jiraBoardIssues,
  jiraIssueTransitions,
  jiraMoveIssue,
  jiraTransitionIssue,
  listJiraBoards,
  rankAnchor,
  type JiraBoard,
  type JiraBoardConfiguration,
  type JiraBoardIssue,
  type JiraColumn,
  type JiraIssueScope,
  type JiraMove,
  type JiraTransition,
} from "../model/jiraBoard";
import "./jira-board.css";
import { JIRA_CHANGE_EVENT, readHiddenJiraProjectIds } from "../model/jira";

type Group = {
  id: string;
  name: string;
  scope: JiraIssueScope;
  issues: JiraBoardIssue[];
  token: string | null;
  goal?: string;
  state?: string;
  loaded: boolean;
  pages: number;
  error?: string;
  stale?: boolean;
  autoPaused?: boolean;
  cursors?: string[];
};
type TransitionPick = {
  issue: JiraBoardIssue;
  choices: JiraTransition[];
  anchor: Pick<JiraMove, "beforeKey" | "afterKey">;
};
const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export function JiraBoardView({
  revision,
  onSelect,
  onChanged,
  onIssuesLoaded,
  onScopeChanged,
  selectedIssueId,
}: {
  revision: number;
  onSelect: (issue: JiraBoardIssue) => void;
  onChanged: () => void;
  onIssuesLoaded?: (issues: JiraBoardIssue[]) => void;
  onScopeChanged?: () => void;
  selectedIssueId?: string;
}) {
  useLocale();
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [boardId, setBoardId] = useRetainedState("jira-board:id", 0);
  const [configuration, setConfiguration] = useState<JiraBoardConfiguration | null>(null);
  const [mode, setMode] = useRetainedState<"kanban" | "planning">(
    `jira-board:${boardId}:mode`,
    "kanban",
  );
  const [scope, setScope] = useRetainedState(`jira-board:${boardId}:scope`, "board");
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useRetainedState(`jira-board:${boardId}:search`, "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readingTransitions, setReadingTransitions] = useState(false);
  const [readingGroup, setReadingGroup] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [permissionsRevision, setPermissionsRevision] = useState(0);
  const [backlogUnavailable, setBacklogUnavailable] = useState(false);
  const [pick, setPick] = useState<TransitionPick | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [moveKey, setMoveKey] = useState<string | null>(null);
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const operation = useRef(false);
  const readOperation = useRef(false);
  const writeFailed = useRef(false);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const scopeIdentity = useRef("");
  const selectedScopeIdentity = useRef("");
  const scopeChanged = useRef(onScopeChanged);
  scopeChanged.current = onScopeChanged;
  const dragged = useRef<string | null>(null);
  const captured = useRef<HTMLElement | null>(null);
  const announcedTarget = useRef("");
  const pointer = useRef<{ id: number; key: string; x: number; y: number; active: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const issuesLoaded = useRef(onIssuesLoaded);
  issuesLoaded.current = onIssuesLoaded;
  /** Commits settled groups and reports their issues from the same place. */
  const commitGroups = (update: Group[] | ((old: Group[]) => Group[])) => {
    const next = typeof update === "function" ? update(groupsRef.current) : update;
    groupsRef.current = next;
    setGroups(next);
    issuesLoaded.current?.(next.flatMap((group) => group.issues));
  };
  const board = boards.find((b) => b.id === boardId);
  useEffect(() => {
    const changed = () => {
      generation.current++;
      setBoards([]);
      setBoardId(0);
      setGroups([]);
      setError(null);
      setNotice("");
      setPick(null);
      setMoveKey(null);
      setBacklogUnavailable(false);
      setExpanded(null);
      scopeChanged.current?.();
      issuesLoaded.current?.([]);
      setPermissionsRevision((value) => value + 1);
    };
    window.addEventListener(JIRA_CHANGE_EVENT, changed);
    return () => window.removeEventListener(JIRA_CHANGE_EVENT, changed);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // An open drag must not leave its cursor, badge or target mark behind.
      if (dragged.current) setGrabbing(false);
      dragged.current = null;
      pointer.current = null;
    };
  }, []);
  const dragging = dragKey !== null;
  useEffect(() => {
    if (!dragging) return;
    // Escape and losing the window end the drag the way a cancelled pointer does.
    const cancel = () => {
      const p = pointer.current;
      if (!p) return;
      pointer.current = null;
      dragged.current = null;
      setDragKey(null);
      const element = captured.current;
      captured.current = null;
      try {
        if (element?.hasPointerCapture(p.id)) element.releasePointerCapture(p.id);
      } catch {
        /* already released */
      }
      if (!p.active) return;
      // The button is still down: its release must not count as a click on a card.
      suppressClick.current = true;
      window.addEventListener(
        "pointerup",
        () =>
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 0),
        { once: true },
      );
      setGrabbing(false);
      announcedTarget.current = "";
      announceDrag(t("Drag cancelled"));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancel);
    };
  }, [dragging]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listJiraBoards()
      .then((next) => {
        if (cancelled) return;
        setBoards(next);
        setBoardId((old) => (next.some((b) => b.id === old) ? old : (next[0]?.id ?? 0)));
        if (next.length === 0) setLoading(false);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(message(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [reload, revision, permissionsRevision]);

  useEffect(() => {
    const request = ++generation.current;
    const identity = `${boardId}:${mode}:${scope}:${permissionsRevision}`;
    const changed = scopeIdentity.current !== identity;
    scopeIdentity.current = identity;
    const selectedIdentity = `${boardId}:${scope}:${permissionsRevision}`;
    if (selectedScopeIdentity.current !== selectedIdentity) {
      selectedScopeIdentity.current = selectedIdentity;
      scopeChanged.current?.();
    }
    const previous = changed ? [] : groupsRef.current;
    if (changed) {
      setGroups([]);
      setConfiguration(null);
      setExpanded(null);
    }
    if (!boardId) {
      setConfiguration(null);
      commitGroups([]);
      setLoading(false);
      return;
    }
    const keepWriteError = writeFailed.current;
    writeFailed.current = false;
    if (operation.current) return;
    setLoading(true);
    // The reload that follows a failed write must not hide why the write failed.
    if (!keepWriteError) setError(null);
    if (!changed) setGroups((old) => old.map((group) => ({ ...group, stale: true })));
    setPick(null);
    setMoveKey(null);
    pointer.current = null;
    if (dragged.current) setGrabbing(false);
    dragged.current = null;
    setDragKey(null);
    setBacklogUnavailable(false);
    let committed = false;
    void (async () => {
      const config = await jiraBoardConfiguration(boardId);
      if (request !== generation.current) return;
      const selected = config.sprints.find((s) => `sprint:${s.id}` === scope);
      const actualScope = scope === "backlog" ? "backlog" : selected ? scope : "board";
      if (actualScope !== scope) {
        setScope(actualScope);
        return;
      }
      const definitions: Pick<Group, "id" | "name" | "scope" | "state" | "goal">[] =
        mode === "planning"
          ? [
              ...(board?.kind === "kanban"
                ? [{ id: "board", name: t("Board"), scope: { scope: "board" as const } }]
                : []),
              ...config.sprints
                .filter((s) => s.state === "active")
                .concat(config.sprints.filter((s) => s.state === "future"))
                .map((s) => ({
                  id: `sprint:${s.id}`,
                  name: s.name,
                  state: s.state,
                  goal: s.goal,
                  scope: { scope: "sprint" as const, sprintId: s.id },
                })),
              { id: "backlog", name: t("Backlog"), scope: { scope: "backlog" } },
            ]
          : [
              {
                id: actualScope,
                name: "",
                scope: {
                  scope: selected ? "sprint" : (actualScope as "board" | "backlog"),
                  ...(selected ? { sprintId: selected.id } : {}),
                },
              },
            ];
      const next: Group[] = [];
      // Refresh only already expanded groups, serially. Replay their existing
      // page depth rather than collapsing later-page selection to page one.
      for (const [index, definition] of definitions.entries()) {
        const old = previous.find((group) => group.id === definition.id);
        const open =
          mode === "kanban" ||
          (!changed && expanded ? expanded.includes(definition.id) : index === 0);
        if (!open) {
          next.push({
            ...definition,
            issues: old?.issues ?? [],
            token: old?.token ?? null,
            loaded: old?.loaded ?? false,
            pages: old?.pages ?? 0,
            cursors: old?.cursors,
            stale: !!old?.loaded,
          });
          continue;
        }
        try {
          const refreshed = await readDepth(definition, Math.max(old?.pages ?? 1, 1));
          if (request !== generation.current) return;
          next.push(refreshed);
        } catch (reason) {
          if (request !== generation.current) return;
          if (
            definition.id === "backlog" &&
            /backlogs? (?:are|is) not supported/i.test(message(reason))
          ) {
            setBacklogUnavailable(true);
            if (definitions.length === 1) {
              const fallback = {
                id: "board",
                name: t("Board"),
                scope: { scope: "board" as const },
              };
              next.push(await readDepth(fallback, 1));
            }
          } else {
            next.push({
              ...definition,
              issues: old?.issues ?? [],
              token: old?.token ?? null,
              loaded: old?.loaded ?? false,
              pages: old?.pages ?? 0,
              cursors: old?.cursors,
              stale: !!old?.loaded,
              error: message(reason),
            });
          }
        }
      }
      if (request !== generation.current) return;
      setConfiguration(config);
      committed = true;
      commitGroups(next);
    })()
      .catch((reason) => {
        if (request === generation.current) setError(message(reason));
      })
      .finally(() => {
        if (request !== generation.current) return;
        setLoading(false);
        // A read that ended without committing still releases the loading hold.
        if (!committed) issuesLoaded.current?.(groupsRef.current.flatMap((group) => group.issues));
      });
    return () => {
      generation.current++;
    };
  }, [boardId, board?.kind, mode, scope, reload, revision, permissionsRevision]);

  async function readDepth(
    definition: Pick<Group, "id" | "name" | "scope" | "state" | "goal">,
    pages: number,
  ): Promise<Group> {
    const expectedGeneration = generation.current;
    const issues: JiraBoardIssue[] = [];
    const known = new Set<string>();
    let token: string | null = null;
    let count = 0;
    let autoPaused = false;
    const cursors = new Set<string>();
    do {
      const page = await jiraBoardIssues(boardId, definition.scope, token ?? undefined);
      if (generation.current !== expectedGeneration || !mounted.current)
        throw new Error("Stale Jira read");
      count++;
      for (const issue of page.issues) {
        if (!known.has(issue.id)) {
          known.add(issue.id);
          issues.push(issue);
        }
      }
      if (page.nextPageToken && (page.nextPageToken === token || cursors.has(page.nextPageToken)))
        throw new Error(t("Jira pagination did not advance."));
      token = page.nextPageToken;
      autoPaused = page.issues.length === 0;
      if (token) cursors.add(token);
      // An empty filtered page must never start a cursor-draining loop.
      if (!page.issues.length) break;
    } while (token && count < pages);
    return {
      ...definition,
      issues,
      token,
      loaded: true,
      pages: count,
      cursors: [...cursors],
      autoPaused,
    };
  }

  const allIssues = Array.from(
    new Map(groups.flatMap((g) => g.issues).map((issue) => [issue.id, issue])).values(),
  );
  const visible = (issues: JiraBoardIssue[]) => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? issues.filter((issue) =>
          `${issue.identifier} ${issue.title} ${issue.assignees.map((a) => a.login).join(" ")}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : issues;
  };
  const locked = busy || loading || readingGroup !== null || pick !== null;
  const canRank =
    configuration?.rankFieldId != null &&
    !search.trim() &&
    !groups.some((g) => g.token || !g.loaded || g.stale || g.error) &&
    // An unreadable saved scope disables ranking rather than assuming nothing is hidden.
    readHiddenJiraProjectIds()?.length === 0;

  async function mutate(action: () => Promise<void>) {
    if (operation.current || readOperation.current) return;
    operation.current = true;
    const request = generation.current;
    setBusy(true);
    setError(null);
    setNotice("");
    setPick(null);
    setMoveKey(null);
    writeFailed.current = false;
    try {
      await action();
      if (generation.current === request) setNotice(t("Saved to Jira"));
    } catch (reason) {
      if (generation.current === request) {
        writeFailed.current = true;
        setError(message(reason));
      }
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        setReload((value) => value + 1);
        onChanged();
      }
    }
  }

  async function transition(
    issue: JiraBoardIssue,
    transitionId: string,
    anchor: TransitionPick["anchor"],
  ) {
    await mutate(async () => {
      await jiraTransitionIssue(issue.identifier, transitionId);
      if (anchor.beforeKey || anchor.afterKey) {
        try {
          await jiraMoveIssue(boardId, issue.identifier, { target: "rank", ...anchor });
        } catch (reason) {
          throw new Error(`${t("Status changed, but ranking failed.")} ${message(reason)}`);
        }
      }
    });
  }

  async function dropColumn(
    issue: JiraBoardIssue,
    column: JiraColumn,
    items: JiraBoardIssue[],
    beforeKey?: string,
  ) {
    if (locked || column.statusIds.length === 0 || beforeKey === issue.identifier) return;
    const anchor = canRank ? rankAnchor(items, issue.identifier, beforeKey) : {};
    if (column.statusIds.includes(issue.statusId)) {
      if (anchor.beforeKey || anchor.afterKey)
        await mutate(() => jiraMoveIssue(boardId, issue.identifier, { target: "rank", ...anchor }));
      return;
    }
    const request = generation.current;
    operation.current = true;
    setBusy(true);
    setReadingTransitions(true);
    setError(null);
    try {
      const choices = columnTransitions(await jiraIssueTransitions(issue.identifier), column);
      if (request !== generation.current) return;
      // Keep the exact Jira workflow action explicit when several lead to a column.
      operation.current = false;
      setBusy(false);
      setReadingTransitions(false);
      const available = choices.filter((c) => !c.requiresFields);
      if (choices.length === 1 && available.length === 1)
        await transition(issue, available[0].id, anchor);
      else setPick({ issue, choices, anchor });
    } catch (reason) {
      if (request === generation.current) setError(message(reason));
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        setReadingTransitions(false);
      }
    }
  }

  async function dropGroup(issue: JiraBoardIssue, group: Group, beforeKey?: string) {
    if (locked || beforeKey === issue.identifier) return;
    const source = groups.find((g) => g.issues.some((i) => i.identifier === issue.identifier));
    const anchor = canRank ? rankAnchor(group.issues, issue.identifier, beforeKey) : {};
    if (source?.id === group.id && !anchor.beforeKey && !anchor.afterKey) return;
    await mutate(() =>
      jiraMoveIssue(boardId, issue.identifier, {
        target: source?.id === group.id ? "rank" : group.scope.scope,
        sprintId: group.scope.sprintId,
        ...anchor,
      }),
    );
  }

  /**
   * What releasing over `zone` would do: the badge sentence, and which element carries the mark.
   * It mirrors the rules dropColumn / dropGroup apply (same column or sprint ranks, anything
   * else moves; a column without statuses and an unranked same-place drop do nothing).
   */
  function dropPreview(
    issue: JiraBoardIssue,
    zone: HTMLElement,
  ): { label: string; element: HTMLElement; placement: DropPlacement } | null {
    const before = zone.dataset.jiraBefore;
    if (before === issue.identifier) return null;
    const container = zone.closest<HTMLElement>(".jira-board-column, .jira-board-sprint") ?? zone;
    let name: string;
    let same: boolean;
    if (mode === "kanban") {
      const column =
        zone.dataset.jiraColumn === undefined
          ? undefined
          : configuration?.columns[Number(zone.dataset.jiraColumn)];
      if (!column) return null;
      if (column.statusIds.length === 0)
        return {
          label: t("No statuses mapped to this column."),
          element: container,
          placement: "blocked",
        };
      name = column.name;
      same = column.statusIds.includes(issue.statusId);
    } else {
      const group = groupsRef.current.find((g) => g.id === zone.dataset.jiraGroup);
      if (!group) return null;
      name = group.name;
      same = group.issues.some((i) => i.identifier === issue.identifier);
    }
    if (same && !canRank)
      return { label: t("Already in {p0}", { p0: name }), element: container, placement: "blocked" };
    const label = same ? t("Reorder in {p0}", { p0: name }) : t("Move to {p0}", { p0: name });
    // Ranking lands before the card under the pointer; otherwise the whole column or sprint receives.
    return before !== undefined && canRank
      ? { label, element: zone, placement: "before" }
      : { label, element: container, placement: "inside" };
  }

  function showDropTarget(key: string, zone: HTMLElement | null, at: PointerEvent<HTMLElement>) {
    const issue = allIssues.find((i) => i.identifier === key);
    const preview = issue && zone ? dropPreview(issue, zone) : null;
    // The badge always names the dragged issue; with no valid target it says where to drop.
    const label =
      preview?.label ??
      (mode === "kanban" ? t("Drop on a column") : t("Drop on a sprint or the backlog"));
    setDropFeedback(preview?.placement === "blocked" ? "blocked" : "move", at, label, key);
    setDropIndicator(preview?.element ?? null, preview?.placement ?? null);
    if (preview && preview.label !== announcedTarget.current) {
      announcedTarget.current = preview.label;
      announceDrag(preview.label);
    }
  }

  function pointerStart(event: PointerEvent<HTMLElement>, issue: JiraBoardIssue) {
    if (locked || event.button !== 0 || !(event.target instanceof Element)) return;
    const handle = event.target.closest("[data-jira-drag-handle]");
    if (event.pointerType === "touch" && !handle) return;
    const control = event.target.closest("button, input, select, a");
    if (control && !handle && !control.classList.contains("jira-board-card-open")) return;
    pointer.current = {
      id: event.pointerId,
      key: issue.identifier,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  }

  function pointerMove(event: PointerEvent<HTMLElement>) {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId || locked) return;
    if (!p.active && Math.hypot(event.clientX - p.x, event.clientY - p.y) < 6) return;
    if (!p.active) {
      event.currentTarget.setPointerCapture(event.pointerId);
      captured.current = event.currentTarget;
      setGrabbing(true);
      announceDrag(t("Picked up {p0}. Escape cancels.", { p0: p.key }));
    }
    p.active = true;
    dragged.current = p.key;
    setDragKey(p.key);
    setNotice("");
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-jira-drop]");
    showDropTarget(p.key, target ?? null, event);
    // Scroll the nearest board/list container while approaching an edge.
    const scroll = target?.closest<HTMLElement>(".jira-board-column, .jira-board-planning");
    if (scroll) {
      const rect = scroll.getBoundingClientRect();
      if (event.clientY < rect.top + 40) scroll.scrollTop -= 16;
      if (event.clientY > rect.bottom - 40) scroll.scrollTop += 16;
    }
    const row = event.currentTarget.closest<HTMLElement>(".jira-board-columns");
    if (row) {
      const rect = row.getBoundingClientRect();
      if (event.clientX < rect.left + 40) row.scrollLeft -= 16;
      if (event.clientX > rect.right - 40) row.scrollLeft += 16;
    }
  }

  function pointerEnd(event: PointerEvent<HTMLElement>, cancelled = false) {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId) return;
    pointer.current = null;
    dragged.current = null;
    captured.current = null;
    setDragKey(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!p.active) return;
    // Clears the cursor, the badge and the target mark whether the drop is accepted or not.
    setGrabbing(false);
    announcedTarget.current = "";
    if (cancelled) announceDrag(t("Drag cancelled"));
    event.preventDefault();
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (cancelled || locked) return;
    const zone = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-jira-drop]");
    const group = groups.find((g) => g.id === zone?.dataset.jiraGroup);
    const issue = allIssues.find((i) => i.identifier === p.key);
    if (!group || !issue || !zone) return;
    const before = zone.dataset.jiraBefore;
    const column =
      zone.dataset.jiraColumn === undefined
        ? undefined
        : configuration?.columns[Number(zone.dataset.jiraColumn)];
    if (mode === "kanban") {
      if (column)
        void dropColumn(
          issue,
          column,
          group.issues.filter((i) => column.statusIds.includes(i.statusId)),
          before,
        );
    } else void dropGroup(issue, group, before);
  }

  function card(issue: JiraBoardIssue, group: Group, column?: JiraColumn) {
    const id = `${group.id}:${column?.name ?? ""}:${issue.identifier}`;
    const ordered = column
      ? group.issues.filter((i) => column.statusIds.includes(i.statusId))
      : group.issues;
    const position = ordered.findIndex((i) => i.identifier === issue.identifier);
    const destinations =
      mode === "kanban"
        ? (configuration?.columns ?? []).filter(
            (c) => c.statusIds.length > 0 && !c.statusIds.includes(issue.statusId),
          )
        : groups.filter((g) => g.id !== group.id);
    const items: DropdownMenuItem[] = destinations.map((target, index) => ({
      kind: "item",
      id: `destination:${index}`,
      label: target.name,
    }));
    if (canRank && position > 0)
      items.push({ kind: "item", id: "earlier", label: t("Rank earlier") });
    if (canRank && position >= 0 && position < ordered.length - 1)
      items.push({ kind: "item", id: "later", label: t("Rank later") });
    return (
      <article
        key={issue.identifier}
        className="jira-board-card rounded-(--ui-radius-card) border border-(--ui-editor-border) bg-(--ui-surface) p-2"
        data-dragging={dragKey === issue.identifier || undefined}
        data-jira-drop={id}
        data-jira-group={group.id}
        data-jira-column={column ? configuration?.columns.indexOf(column) : undefined}
        data-jira-before={issue.identifier}
        onPointerDown={(event) => pointerStart(event, issue)}
        onPointerMove={pointerMove}
        onPointerUp={(event) => pointerEnd(event)}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onLostPointerCapture={(event) => pointerEnd(event, true)}
        onDragStart={(e) => e.preventDefault()}
      >
        <ActionHost
          selected={issue.id === selectedIssueId}
          className="flex min-w-0 items-start gap-1"
        >
          <Button
            variant="item"
            align="start"
            layout="stacked"
            className="jira-board-card-open min-w-0 flex-1"
            type="button"
            onClick={() => {
              if (!suppressClick.current) onSelect(issue);
            }}
          >
            <span className="text-ui-secondary font-medium break-words [overflow-wrap:anywhere]">
              {issue.title}
            </span>
            <span className="text-ui-caption text-(--ui-text-secondary)">{issue.identifier}</span>
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("Drag {p0}", { p0: issue.identifier })}
            disabled={locked}
            motion="none"
            data-jira-drag-handle=""
            className="jira-board-drag-handle shrink-0"
          >
            <GripVertical className="icon-sm" aria-hidden="true" />
          </Button>
          <InlineAction
            reveal="always"
            disabled={locked || items.length === 0}
            label={t("Move {p0}", { p0: issue.identifier })}
            aria-haspopup="menu"
            aria-expanded={moveKey === id}
            onClick={(event) => {
              setMoveKey(moveKey === id ? null : id);
              setMoveAnchor(event.currentTarget);
            }}
          >
            <MoreHorizontal className="icon-sm" aria-hidden="true" />
          </InlineAction>
        </ActionHost>
        <div className="flex min-w-0 items-center gap-2 px-3 pb-1 text-ui-caption text-(--ui-text-secondary)">
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
            {issue.state} · {issue.assignees[0]?.login ?? t("Unassigned")}
          </span>
        </div>
        {moveKey === id && moveAnchor ? (
          <DropdownMenu
            anchor={moveAnchor}
            label={t("Move {p0}", { p0: issue.identifier })}
            items={items}
            onClose={() => setMoveKey(null)}
            onPick={(value) => {
              setMoveKey(null);
              if (value.startsWith("destination:")) {
                const target = destinations[Number(value.split(":")[1])];
                if (!target) return;
                if ("statusIds" in target)
                  void dropColumn(
                    issue,
                    target,
                    group.issues.filter((i) => target.statusIds.includes(i.statusId)),
                  );
                else void dropGroup(issue, target);
              } else {
                const anchor =
                  value === "earlier"
                    ? { beforeKey: ordered[position - 1]?.identifier }
                    : { afterKey: ordered[position + 1]?.identifier };
                if (canRank)
                  void mutate(() =>
                    jiraMoveIssue(boardId, issue.identifier, { target: "rank", ...anchor }),
                  );
              }
            }}
          />
        ) : null}
      </article>
    );
  }

  async function loadMore(group: Group, first = false) {
    if ((!group.token && !first) || operation.current || readOperation.current || loading) return;
    readOperation.current = true;
    setReadingGroup(group.id);
    const request = generation.current;
    try {
      const fresh = first ? await readDepth(group, Math.max(group.pages, 1)) : null;
      const page = fresh ? null : await jiraBoardIssues(boardId, group.scope, group.token!);
      if (request !== generation.current) return;
      if (
        page?.nextPageToken &&
        (page.nextPageToken === group.token || group.cursors?.includes(page.nextPageToken))
      )
        throw new Error(t("Jira pagination did not advance."));
      commitGroups((old) =>
        old.map((g) => {
          if (g.id !== group.id) return g;
          if (fresh) return fresh;
          const known = new Set(g.issues.map((i) => i.id));
          return {
            ...g,
            issues: [...g.issues, ...page!.issues.filter((i) => !known.has(i.id))],
            token: page!.nextPageToken,
            pages: g.pages + 1,
            error: undefined,
            cursors: [...(g.cursors ?? []), ...(page!.nextPageToken ? [page!.nextPageToken] : [])],
            autoPaused: page!.issues.length === 0,
          };
        }),
      );
    } catch (reason) {
      if (request === generation.current) {
        // A board without backlog support is a capability note, not a failed read.
        const backlogUnsupported =
          group.id === "backlog" && /backlogs? (?:are|is) not supported/i.test(message(reason));
        if (backlogUnsupported) setBacklogUnavailable(true);
        commitGroups((old) =>
          old.map((g) =>
            g.id !== group.id
              ? g
              : backlogUnsupported
                ? { ...g, issues: [], token: null, loaded: true, stale: false, error: undefined }
                : { ...g, error: message(reason), autoPaused: true },
          ),
        );
      }
    } finally {
      readOperation.current = false;
      if (mounted.current) setReadingGroup(null);
    }
  }

  function demand(event: UIEvent<HTMLElement>, group: Group) {
    const surface = event.currentTarget;
    if (surface.scrollHeight - surface.scrollTop - surface.clientHeight > 120) return;
    if (group.token && !group.error && !group.autoPaused && !search.trim() && !locked)
      void loadMore(group);
  }

  function groupRecovery(group: Group) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-2">
        {group.stale && group.issues.length ? (
          <p className="w-full text-ui-caption text-(--ui-text-secondary)">
            {t("Showing last loaded data. Updates have not been verified.")}
          </p>
        ) : null}
        {group.error ? (
          <Alert tone="danger" className="min-w-0 flex-1" role="alert">
            {group.error}
          </Alert>
        ) : null}
        {group.token || !group.loaded || group.stale || group.error ? (
          <Button
            variant="ghost"
            loading={readingGroup === group.id}
            disabled={locked && readingGroup !== group.id}
            onClick={() => void loadMore(group, !group.loaded || !!group.stale)}
          >
            {group.error ? t("Retry") : group.loaded ? t("Load more issues") : t("Load issues")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className="jira-board-view flex min-h-0 min-w-0 flex-1 flex-col text-ui-caption text-(--ui-tone-neutral-fg)"
      aria-label={t("Jira board")}
      aria-busy={loading || busy}
    >
      <div className="jira-board-band flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <label className="min-w-0">
          <span className="sr-only">{t("Board")}</span>
          <SearchableSelect
            label={t("Jira board")}
            options={
              boards.length
                ? boards.map((b) => ({ value: String(b.id), label: `${b.name} · ${b.kind}` }))
                : [{ value: "0", label: t("Select allowed boards in Settings → Inbox → Jira") }]
            }
            disabled={locked}
            value={String(boardId)}
            onChange={(value) => {
              setBoardId(Number(value));
              setScope("board");
              setError(null);
              setNotice("");
            }}
          />
        </label>
        <fieldset disabled={locked} className="jira-board-mode">
          <SegmentedControl
            selectionRole="pressed"
            label={t("Board view")}
            value={mode}
            onValueChange={(value) => {
              setMode(value as "kanban" | "planning");
              setError(null);
            }}
            options={[
              { value: "kanban", label: t("Kanban") },
              { value: "planning", label: t("Backlog & sprints") },
            ]}
          />
        </fieldset>
        {mode === "kanban" ? (
          <label className="min-w-0">
            <span className="sr-only">{t("Issue scope")}</span>
            <SearchableSelect
              label={t("Issue scope")}
              options={[
                { value: "board", label: t("All board issues") },
                { value: "backlog", label: t("Backlog") },
                ...(configuration?.sprints.map((s) => ({
                  value: `sprint:${s.id}`,
                  label: `${s.name} · ${s.state === "active" ? t("Active sprint") : t("Future sprint")}`,
                })) ?? []),
              ]}
              disabled={locked}
              value={scope}
              onChange={(value) => {
                setScope(value);
                setError(null);
                setNotice("");
              }}
            />
          </label>
        ) : null}
        <label className="min-w-40 flex-1">
          <span className="sr-only">{t("Filter loaded issues")}</span>
          <SearchInput
            appearance="field"
            fieldSize="sm"
            type="search"
            aria-label={t("Filter loaded issues")}
            placeholder={t("Filter loaded issues")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button
          variant="ghost"
          type="button"
          loading={loading}
          disabled={busy || readingGroup !== null || pick !== null}
          onClick={() => {
            setError(null);
            setReload((n) => n + 1);
          }}
        >
          {t("Refresh")}
        </Button>
      </div>
      {backlogUnavailable ? (
        <p className="jira-board-hint">
          {t(
            "Backlog is not enabled for this Jira board. Enable it in Jira board settings to use backlog planning. Available board issues remain visible.",
          )}
        </p>
      ) : null}
      <div className="jira-board-status" role="status" aria-live="polite">
        {readingTransitions
          ? t("Loading…")
          : busy
            ? t("Saving to Jira…")
            : loading
              ? t("Loading Jira board…")
              : readingGroup
                ? t("Loading issues…")
                : notice || t("{p0} loaded", { p0: allIssues.length })}
      </div>
      {!canRank && configuration?.rankFieldId != null ? (
        <p className="jira-board-hint">
          {search.trim()
            ? t("Ranking is disabled while filtering. Status and sprint moves remain available.")
            : (readHiddenJiraProjectIds()?.length ?? 1)
              ? t("Ranking is unavailable while projects are hidden.")
              : t(
                  "Ranking is unavailable until all board groups and pages are loaded and current.",
                )}
        </p>
      ) : null}
      {error ? (
        <Alert tone="danger" className="jira-board-error" role="alert">
          {error}
        </Alert>
      ) : null}
      {pick ? (
        <div
          className="jira-board-transition"
          role="group"
          aria-label={t("Choose Jira transition")}
        >
          <strong>
            {pick.issue.identifier} · {t("Choose Jira transition")}
          </strong>
          {pick.choices.length ? (
            pick.choices.map((choice) => (
              <Button
                variant="ghost"
                key={choice.id}
                type="button"
                disabled={choice.requiresFields}
                onClick={() => void transition(pick.issue, choice.id, pick.anchor)}
              >
                {choice.name}
                {choice.requiresFields ? ` · ${t("Requires fields in Jira")}` : ""}
              </Button>
            ))
          ) : (
            <p>{t("No allowed transition to this column.")}</p>
          )}
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              void openUrl(pick.issue.url).catch((reason) => setError(message(reason)))
            }
          >
            {t("Open in Jira")}
          </Button>
          <Button variant="ghost" type="button" onClick={() => setPick(null)}>
            {t("Cancel")}
          </Button>
        </div>
      ) : null}
      {!loading && !boards.length && !error ? (
        <p className="jira-board-hint">{t("No Jira boards found")}</p>
      ) : null}
      {!loading && board?.kind === "scrum" && configuration?.sprints.length === 0 ? (
        <p className="jira-board-hint">{t("No active or future sprints on this board.")}</p>
      ) : null}
      {mode === "kanban" ? (
        <div className="jira-board-columns flex min-h-0 flex-1 items-stretch gap-3 overflow-auto px-3 pb-3 pt-2">
          {configuration?.columns.map((column, index) => {
            const group = groups[0];
            if (!group) return null;
            const issues = group.issues.filter((i) => column.statusIds.includes(i.statusId));
            const id = `column:${index}`;
            return (
              <section
                key={index}
                className="jira-board-column min-h-0 flex-1 basis-60 overflow-y-auto"
                onScroll={(event) => demand(event, group)}
                aria-label={column.name}
                data-jira-drop={id}
                data-jira-group={group.id}
                data-jira-column={index}
              >
                <header className="sticky top-0 z-1 mb-2 flex min-w-0 items-center gap-2 bg-(--color-background-base) px-1 py-2">
                  <h2 className="min-w-0 flex-1 break-words text-ui-secondary font-medium [overflow-wrap:anywhere]">
                    {column.name}
                  </h2>
                  <span className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary)">
                    {group.loaded
                      ? t("{p0} loaded", { p0: visible(issues).length })
                      : t("Not loaded")}
                    {group.token ? "+" : ""}
                  </span>
                </header>
                {!column.statusIds.length ? (
                  <p className="jira-board-hint">{t("No statuses mapped to this column.")}</p>
                ) : null}
                {visible(issues).map((issue) => card(issue, group, column))}
                {group.loaded &&
                !group.stale &&
                !group.error &&
                !visible(issues).length &&
                column.statusIds.length ? (
                  <p className="jira-board-empty">
                    {search.trim() || group.token ? t("No matching loaded issues") : t("No issues")}
                  </p>
                ) : null}
              </section>
            );
          })}
          {groups[0] &&
          groups[0].issues.some(
            (i) => !configuration?.columns.some((c) => c.statusIds.includes(i.statusId)),
          ) ? (
            <section
              className="jira-board-column min-h-0 flex-1 basis-60 overflow-y-auto"
              aria-label={t("Unmapped statuses")}
              onScroll={(event) => demand(event, groups[0])}
            >
              <header className="sticky top-0 z-1 mb-2 bg-(--color-background-base) px-1 py-2">
                <h2 className="text-ui-secondary font-medium">{t("Unmapped statuses")}</h2>
              </header>
              {visible(
                groups[0].issues.filter(
                  (i) => !configuration?.columns.some((c) => c.statusIds.includes(i.statusId)),
                ),
              ).map((i) => card(i, groups[0]))}
            </section>
          ) : null}
        </div>
      ) : (
        <div
          className="jira-board-planning min-h-0 flex-1 overflow-auto px-3 pb-3 pt-2"
          onScroll={(event) => {
            const surface = event.currentTarget;
            const active = Array.from(
              surface.querySelectorAll<HTMLElement>("[data-jira-expanded]"),
            ).find((element) => {
              const rect = element.getBoundingClientRect();
              const parent = surface.getBoundingClientRect();
              return rect.bottom >= parent.top && rect.bottom <= parent.bottom + 120;
            });
            const group = groups.find((candidate) => candidate.id === active?.dataset.jiraGroup);
            if (group?.token && !group.error && !group.autoPaused && !search.trim() && !locked)
              void loadMore(group);
          }}
        >
          {groups.map((group, index) => {
            const open = expanded ? expanded.includes(group.id) : index === 0;
            const contentId = `jira-group-${boardId}-${group.id.replace(":", "-")}`;
            return (
              <section
                key={group.id}
                className="jira-board-sprint mb-3 rounded-(--ui-radius-card) border border-(--ui-editor-border) p-2"
                aria-label={group.name}
                data-jira-drop={group.id}
                data-jira-group={group.id}
                data-jira-expanded={open || undefined}
              >
                <header className="flex min-w-0 items-center gap-2">
                  <Button
                    variant="item"
                    align="start"
                    className="min-w-0 flex-1"
                    aria-expanded={open}
                    aria-controls={contentId}
                    onClick={() => {
                      const current = expanded ?? (groups[0] ? [groups[0].id] : []);
                      setExpanded(
                        open ? current.filter((id) => id !== group.id) : [...current, group.id],
                      );
                      if (!open && (!group.loaded || group.stale)) void loadMore(group, true);
                    }}
                  >
                    {open ? (
                      <ChevronDown className="icon-sm shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="icon-sm shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 whitespace-normal break-words text-ui-secondary font-medium [overflow-wrap:anywhere]">
                      {group.name}
                    </span>
                  </Button>
                  {group.state ? (
                    <span className="text-ui-caption text-(--ui-text-secondary)">
                      {group.state === "active" ? t("Active sprint") : t("Future sprint")}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary)">
                    {group.loaded
                      ? t("{p0} loaded", { p0: visible(group.issues).length }) +
                        (group.token ? "+" : "")
                      : t("Not loaded")}
                  </span>
                </header>
                {open ? (
                  <div id={contentId}>
                    {group.goal ? (
                      <p className="px-1 pb-2 text-ui-caption text-(--ui-text-secondary) [overflow-wrap:anywhere]">
                        {group.goal}
                      </p>
                    ) : null}
                    {visible(group.issues).map((issue) => card(issue, group))}
                    {group.loaded && !visible(group.issues).length ? (
                      <p className="jira-board-empty">
                        {search.trim() || group.token
                          ? t("No matching loaded issues")
                          : t("Drop issues here")}
                      </p>
                    ) : null}
                    {groupRecovery(group)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
      {mode === "kanban" && groups[0] ? (
        <div className="shrink-0 px-3">{groupRecovery(groups[0])}</div>
      ) : null}
      {groups.some((group) => group.token || !group.loaded) ? (
        <p className="jira-board-hint">
          {t("Showing loaded issues. Scroll for more or use Load more issues.")}
        </p>
      ) : null}
    </section>
  );
}
