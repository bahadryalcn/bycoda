import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useEffect, useRef, useState, type PointerEvent } from "react";
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
import { JIRA_CHANGE_EVENT, loadHiddenJiraProjectIds } from "../model/jira";

type Group = {
  id: string;
  name: string;
  scope: JiraIssueScope;
  issues: JiraBoardIssue[];
  token: string | null;
  goal?: string;
  state?: string;
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
}: {
  revision: number;
  onSelect: (issue: JiraBoardIssue) => void;
  onChanged: () => void;
  onIssuesLoaded?: (issues: JiraBoardIssue[]) => void;
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [permissionsRevision, setPermissionsRevision] = useState(0);
  const [backlogUnavailable, setBacklogUnavailable] = useState(false);
  const [pick, setPick] = useState<TransitionPick | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [moveKey, setMoveKey] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const operation = useRef(false);
  const dragged = useRef<string | null>(null);
  const pointer = useRef<{ id: number; key: string; x: number; y: number; active: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const issuesLoaded = useRef(onIssuesLoaded);
  issuesLoaded.current = onIssuesLoaded;
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
    };
  }, []);

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
    if (!boardId) {
      setConfiguration(null);
      setGroups([]);
      setLoading(false);
      return;
    }
    if (operation.current) return;
    setLoading(true);
    setConfiguration(null);
    setGroups([]);
    setPick(null);
    setMoveKey(null);
    dragged.current = null;
    setDragKey(null);
    setHover(null);
    setBacklogUnavailable(false);
    void (async () => {
      const config = await jiraBoardConfiguration(boardId);
      if (request !== generation.current) return;
      const selected = config.sprints.find((s) => `sprint:${s.id}` === scope);
      const actualScope = scope === "backlog" ? "backlog" : selected ? scope : "board";
      if (actualScope !== scope) {
        setScope(actualScope);
        return;
      }
      const definitions: Omit<Group, "issues" | "token">[] =
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
      const results = await Promise.allSettled(
        definitions.map(async (group) => {
          const page = await jiraBoardIssues(boardId, group.scope);
          return { ...group, issues: page.issues, token: page.nextPageToken };
        }),
      );
      if (request !== generation.current) return;
      const next: Group[] = [];
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next.push(result.value);
        else if (
          definitions[index].id === "backlog" &&
          /backlogs? (?:are|is) not supported/i.test(message(result.reason))
        ) {
          setBacklogUnavailable(true);
        } else failures.push(message(result.reason));
      });
      if (failures.length) setError(failures.join(" · "));
      if (
        !next.length &&
        definitions.length === 1 &&
        definitions[0].id === "backlog" &&
        !failures.length
      ) {
        const page = await jiraBoardIssues(boardId, { scope: "board" });
        if (request !== generation.current) return;
        next.push({
          id: "board",
          name: t("Board"),
          scope: { scope: "board" },
          issues: page.issues,
          token: page.nextPageToken,
        });
      }
      setConfiguration(config);
      setGroups(next);
    })()
      .catch((reason) => {
        if (request === generation.current) setError(message(reason));
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [boardId, board?.kind, mode, scope, reload, revision]);

  const allIssues = groups.flatMap((g) => g.issues);
  useEffect(() => {
    if (!loading) issuesLoaded.current?.(groups.flatMap((group) => group.issues));
  }, [groups, loading]);
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
  const locked = busy || loading || pick !== null;
  const canRank =
    configuration?.rankFieldId != null &&
    !search.trim() &&
    !groups.some((g) => g.token) &&
    loadHiddenJiraProjectIds().length === 0;

  async function mutate(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    const request = generation.current;
    setBusy(true);
    setError(null);
    setNotice("");
    setPick(null);
    setMoveKey(null);
    try {
      await action();
      if (generation.current === request) setNotice(t("Saved to Jira"));
    } catch (reason) {
      if (generation.current === request) setError(message(reason));
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
    setError(null);
    try {
      const choices = columnTransitions(await jiraIssueTransitions(issue.identifier), column);
      if (request !== generation.current) return;
      // Keep the exact Jira workflow action explicit when several lead to a column.
      operation.current = false;
      setBusy(false);
      const available = choices.filter((c) => !c.requiresFields);
      if (choices.length === 1 && available.length === 1)
        await transition(issue, available[0].id, anchor);
      else setPick({ issue, choices, anchor });
    } catch (reason) {
      if (request === generation.current) setError(message(reason));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
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

  function pointerStart(event: PointerEvent<HTMLElement>, issue: JiraBoardIssue) {
    if (locked || event.button !== 0 || !(event.target instanceof Element)) return;
    const control = event.target.closest("button, input, select, a");
    if (control && !control.classList.contains("jira-board-card-open")) return;
    pointer.current = {
      id: event.pointerId,
      key: issue.identifier,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLElement>) {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId || locked) return;
    if (!p.active && Math.hypot(event.clientX - p.x, event.clientY - p.y) < 6) return;
    p.active = true;
    dragged.current = p.key;
    setDragKey(p.key);
    setNotice("");
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-jira-drop]");
    setHover(target?.dataset.jiraDrop ?? null);
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
    setDragKey(null);
    setHover(null);
    if (!p.active) return;
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
    return (
      <article
        key={issue.identifier}
        className="jira-board-card"
        data-dragging={dragKey === issue.identifier || undefined}
        data-drop={hover === id || undefined}
        data-jira-drop={id}
        data-jira-group={group.id}
        data-jira-column={column ? configuration?.columns.indexOf(column) : undefined}
        data-jira-before={issue.identifier}
        onPointerDown={(event) => pointerStart(event, issue)}
        onPointerMove={pointerMove}
        onPointerUp={(event) => pointerEnd(event)}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onDragStart={(e) => e.preventDefault()}
      >
        <Button
          variant="item"
          align="start"
          className="jira-board-card-open"
          type="button"
          onClick={() => {
            if (!suppressClick.current) onSelect(issue);
          }}
        >
          <span className="jira-board-key">{issue.identifier}</span>
          <span className="jira-board-summary">{issue.title}</span>
        </Button>
        <div className="jira-board-card-meta">
          <span>{issue.state}</span>
          <span>{issue.assignees[0]?.login ?? t("Unassigned")}</span>
        </div>
        <Button
          variant="ghost"
          type="button"
          disabled={locked}
          className="jira-board-move"
          aria-label={t("Move {p0}", { p0: issue.identifier })}
          onClick={() => setMoveKey(moveKey === issue.identifier ? null : issue.identifier)}
        >
          {t("Move")}
        </Button>
        {moveKey === issue.identifier ? (
          <div className="jira-board-move-menu" aria-label={t("Move issue")}>
            {mode === "kanban"
              ? configuration?.columns
                  .filter((c) => c.statusIds.length > 0 && !c.statusIds.includes(issue.statusId))
                  .map((c, index) => (
                    <Button
                      variant="ghost"
                      key={index}
                      type="button"
                      onClick={() => {
                        setMoveKey(null);
                        void dropColumn(
                          issue,
                          c,
                          group.issues.filter((i) => c.statusIds.includes(i.statusId)),
                        );
                      }}
                    >
                      {c.name}
                    </Button>
                  ))
              : groups
                  .filter((g) => g.id !== group.id)
                  .map((g) => (
                    <Button
                      variant="ghost"
                      key={g.id}
                      type="button"
                      onClick={() => void dropGroup(issue, g)}
                    >
                      {g.name}
                    </Button>
                  ))}
            {canRank && position > 0 ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() =>
                  void mutate(() =>
                    jiraMoveIssue(boardId, issue.identifier, {
                      target: "rank",
                      beforeKey: ordered[position - 1].identifier,
                    }),
                  )
                }
              >
                {t("Rank earlier")}
              </Button>
            ) : null}
            {canRank && position >= 0 && position < ordered.length - 1 ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() =>
                  void mutate(() =>
                    jiraMoveIssue(boardId, issue.identifier, {
                      target: "rank",
                      afterKey: ordered[position + 1].identifier,
                    }),
                  )
                }
              >
                {t("Rank later")}
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={() => setMoveKey(null)}>
              {t("Cancel")}
            </Button>
          </div>
        ) : null}
      </article>
    );
  }

  async function loadMore(group: Group) {
    if (!group.token || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    const request = generation.current;
    try {
      const page = await jiraBoardIssues(boardId, group.scope, group.token);
      if (request !== generation.current) return;
      if (page.nextPageToken === group.token)
        throw new Error(t("Jira pagination did not advance."));
      setGroups((old) =>
        old.map((g) => {
          if (g.id !== group.id) return g;
          const known = new Set(g.issues.map((i) => i.id));
          return {
            ...g,
            issues: [...g.issues, ...page.issues.filter((i) => !known.has(i.id))],
            token: page.nextPageToken,
          };
        }),
      );
    } catch (reason) {
      if (request === generation.current) setError(message(reason));
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(false);
        if (request !== generation.current) setReload((n) => n + 1);
      }
    }
  }

  return (
    <section className="jira-board-view" aria-label={t("Jira board")} aria-busy={loading || busy}>
      <div className="jira-board-toolbar">
        <label>
          {t("Board")}
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
          <label>
            {t("Issue scope")}
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
        <label className="jira-board-search">
          {t("Filter issues")}
          <SearchInput
            appearance="field"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button
          variant="ghost"
          type="button"
          disabled={busy || pick !== null}
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
        {busy
          ? t("Saving to Jira…")
          : loading
            ? t("Loading Jira board…")
            : notice ||
              t("Drag cards to change status, sprint or rank. Use Move for keyboard access.")}
      </div>
      {search.trim() ? (
        <p className="jira-board-hint">
          {t("Ranking is disabled while filtering. Status and sprint moves remain available.")}
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
        <div className="jira-board-columns">
          {configuration?.columns.map((column, index) => {
            const group = groups[0];
            if (!group) return null;
            const issues = group.issues.filter((i) => column.statusIds.includes(i.statusId));
            const id = `column:${index}`;
            return (
              <section
                key={index}
                className="jira-board-column"
                data-drop={hover === id || undefined}
                aria-label={column.name}
                data-jira-drop={id}
                data-jira-group={group.id}
                data-jira-column={index}
              >
                <header>
                  <h2>{column.name}</h2>
                  <span>{visible(issues).length}</span>
                </header>
                {!column.statusIds.length ? (
                  <p className="jira-board-hint">{t("No statuses mapped to this column.")}</p>
                ) : null}
                {visible(issues).map((issue) => card(issue, group, column))}
                {!visible(issues).length && column.statusIds.length ? (
                  <p className="jira-board-empty">{t("No issues")}</p>
                ) : null}
              </section>
            );
          })}
          {groups[0] &&
          groups[0].issues.some(
            (i) => !configuration?.columns.some((c) => c.statusIds.includes(i.statusId)),
          ) ? (
            <section className="jira-board-column" aria-label={t("Unmapped statuses")}>
              <header>
                <h2>{t("Unmapped statuses")}</h2>
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
        <div className="jira-board-planning">
          {groups.map((group) => (
            <section
              key={group.id}
              className="jira-board-sprint"
              data-drop={hover === group.id || undefined}
              aria-label={group.name}
              data-jira-drop={group.id}
              data-jira-group={group.id}
            >
              <header>
                <h2>{group.name}</h2>
                {group.state ? (
                  <span>{group.state === "active" ? t("Active sprint") : t("Future sprint")}</span>
                ) : null}
                <span>
                  {visible(group.issues).length}
                  {group.token ? "+" : ""}
                </span>
              </header>
              {group.goal ? <p className="jira-board-hint">{group.goal}</p> : null}
              {visible(group.issues).map((issue) => card(issue, group))}
              {!visible(group.issues).length ? (
                <p className="jira-board-empty">{t("Drop issues here")}</p>
              ) : null}
              {group.token ? (
                <Button
                  variant="ghost"
                  type="button"
                  disabled={locked}
                  onClick={() => void loadMore(group)}
                >
                  {t("Load more issues")}
                </Button>
              ) : null}
            </section>
          ))}
        </div>
      )}
      {mode === "kanban" && groups[0]?.token ? (
        <Button
          variant="ghost"
          type="button"
          className="jira-board-load"
          disabled={locked}
          onClick={() => void loadMore(groups[0])}
        >
          {t("Load more issues")}
        </Button>
      ) : null}
      {groups.some((g) => g.token) ? (
        <p className="jira-board-hint">
          {t("More issues are available. Load all pages before ranking at the end.")}
        </p>
      ) : null}
    </section>
  );
}
