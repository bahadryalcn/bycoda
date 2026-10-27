import { appendUser, applyHarnessEvents } from "../../../integrations/harness/core/apply";
import { describe, expect, it } from "vitest";
import { mapCodexNotification } from "../../../integrations/harness/providers/codex/codexProtocol";
import { toolCallLabel } from "../model/transcriptActivity";
import { conversationReplayPrompt } from "../model/conversationRewind";
import { newSession, type Block, type BtwThread, type Session } from "../model/session";
import { clearConversation } from "../model/clearConversation";
import {
  backfillClaudeShellCommands,
  backfillCodexShellCommands,
  isPersistableId,
  persistFingerprint,
  sanitizeSessionForPersist,
  shouldPersistSession,
} from "./sessionStore";

it("keeps host-owned transcripts out of local session storage", () => {
  const session = newSession("codex", "remote://env/home/me/repo");
  session.blocks = [{ id: "turn", role: "user", text: "Continue" }];
  expect(shouldPersistSession(session)).toBe(false);
});

it("persists an empty active transcript when rewound history remains", () => {
  const session = newSession("codex", "/repo");
  session.rewindHistory = [
    {
      id: "rewind-1",
      createdAt: 123,
      fromBlockId: "removed-user",
      blocks: [{ id: "removed-user", role: "user", text: "archived prompt" }],
    },
  ];
  expect(session.blocks).toEqual([]);
  expect(shouldPersistSession(session)).toBe(true);
  expect(sanitizeSessionForPersist(session)).toMatchObject({
    blocks: [],
    rewindHistory: [{ fromBlockId: "removed-user" }],
  });
});

it("persists execution identity when clearing a legacy current conversation", () => {
  const legacy = newSession("codex", "/repo");
  legacy.blocks = [{ id: "turn", role: "user", text: "Established" }];
  const payload = sanitizeSessionForPersist(clearConversation(legacy));
  expect(payload.blocks).toEqual([]);
  expect(payload).toHaveProperty("workspaceMode", "current");
});

describe("Claude Shell row recovery", () => {
  it("restores only matching placeholder rows and preserves tool output", () => {
    const blocks: Block[] = [
      {
        id: "shell",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "toolu_shell",
          title: "Shell",
          kind: "execute",
          status: "completed",
          detail: "tests passed",
        },
      },
      {
        id: "read",
        role: "tool",
        text: "Read file.ts",
        tool: { callId: "toolu_read", kind: "read" },
      },
    ];
    const command = `npm run check:web ${"--filter tests ".repeat(20)}`.trim();
    const repaired = backfillClaudeShellCommands(blocks, {
      toolu_shell: command,
      toolu_read: "ignore me",
    });
    expect(repaired[0]).toMatchObject({
      text: command,
      tool: { title: command, status: "completed", detail: "tests passed" },
    });
    expect(repaired[1]).toBe(blocks[1]);
    expect(backfillClaudeShellCommands(repaired, {})).toBe(repaired);
  });
});

describe("conversation rewind persistence", () => {
  it("stores recovery context for an unsent provider switch without duplicating the live handoff", () => {
    const session = newSession("claude", "/repo");
    session.blocks = [
      { id: "u1", role: "user", text: "Keep the existing parser contract" },
      { id: "a1", role: "assistant", text: "Updated the parser and verified its callers" },
    ];
    session.pendingSwitch = { from: "codex", fromModel: "gpt", fromSettings: {} };
    const payload = sanitizeSessionForPersist(session);
    expect(payload.pendingContextReplay).toContain("Keep the existing parser contract");
    expect(payload.pendingContextReplay).toContain("verified its callers");
    expect(payload.blocks).toEqual(session.blocks);
    expect(session.pendingContextReplay).toBeUndefined();
    expect(conversationReplayPrompt(session)).toBe("");
    expect(session.pendingSwitch.from).toBe("codex");
    expect(persistFingerprint(session)).not.toBe(
      persistFingerprint({ ...session, pendingSwitch: undefined }),
    );

    session.pendingContextReplay = "previously retained context";
    expect(sanitizeSessionForPersist(session).pendingContextReplay).toBe(
      "previously retained context",
    );
    expect(
      sanitizeSessionForPersist({
        ...session,
        pendingSwitch: undefined,
        pendingContextReplay: undefined,
      }),
    ).not.toHaveProperty("pendingContextReplay");
  });

  it("persists sanitized archived blocks and stop markers outside the active transcript", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      { id: "kept", role: "user", text: "retained", turnOutcome: "stopped", turnStoppedAt: 321 },
    ];
    session.rewindHistory = [
      {
        id: "rewind-1",
        createdAt: 456,
        fromBlockId: "removed",
        blocks: [
          {
            id: "removed",
            role: "user",
            text: "archived prompt",
            attachments: [
              {
                id: "file-1",
                name: "notes.txt",
                mimeType: "text/plain",
                kind: "file",
                size: 12,
                path: "/repo/notes.txt",
                data: "ephemeral",
              },
            ],
          },
        ],
      },
    ];
    session.pendingContextReplay = "retained transcript context";

    const payload = sanitizeSessionForPersist(session);
    expect(payload.blocks).toEqual([
      { id: "kept", role: "user", text: "retained", turnOutcome: "stopped", turnStoppedAt: 321 },
    ]);
    expect(payload.rewindHistory?.[0].blocks[0]).toMatchObject({
      id: "removed",
      text: "archived prompt",
      attachments: [{ id: "file-1", path: "/repo/notes.txt" }],
    });
    expect(JSON.stringify(payload.rewindHistory)).not.toContain("ephemeral");
    expect(payload.pendingContextReplay).toBe("retained transcript context");
  });
});

describe("host divergence persistence", () => {
  it("saves a flagged divergence and its answer with the session, and nothing otherwise", () => {
    const session = newSession("claude", "/repo");
    expect(sanitizeSessionForPersist(session)).not.toHaveProperty("adoptedDivergence");
    session.adoptedDivergence = { key: "3:a:b:x:y", keep: true };
    const payload = sanitizeSessionForPersist(session);
    expect(JSON.parse(payload.adoptedDivergence!)).toEqual({ key: "3:a:b:x:y", keep: true });
    expect(persistFingerprint(session)).not.toBe(
      persistFingerprint({ ...session, adoptedDivergence: undefined }),
    );
  });

  it("saves the host head a divergence was flagged against", () => {
    const session = newSession("claude", "/repo");
    const hostHead = { count: 4, chain: "0123456789abcdef0123456789abcdef" };
    session.adoptedDivergence = { key: "heads::1.a:2.b:3.c", hostHead };
    expect(JSON.parse(sanitizeSessionForPersist(session).adoptedDivergence!)).toEqual({
      key: "heads::1.a:2.b:3.c",
      hostHead,
    });
  });
});

describe("agreed base persistence", () => {
  it("saves the transcript head both computers last agreed on, and nothing otherwise", () => {
    const session = newSession("claude", "/repo");
    expect(sanitizeSessionForPersist(session)).not.toHaveProperty("adoptedBase");
    const base = { count: 3, chain: "0123456789abcdef0123456789abcdef" };
    session.adoptedBase = base;
    expect(JSON.parse(sanitizeSessionForPersist(session).adoptedBase!)).toEqual(base);
    // A new agreement is a change to save, or it would be lost on the next restart.
    expect(persistFingerprint(session)).not.toBe(
      persistFingerprint({ ...session, adoptedBase: undefined }),
    );
    expect(persistFingerprint(session)).not.toBe(
      persistFingerprint({ ...session, adoptedBase: { ...base, count: 4 } }),
    );
  });
});

describe("Codex Shell row recovery", () => {
  it("relabels from the command saved on the row, keeping redactions", () => {
    // The command Codex sent with the item is already on the row as its preview
    // title. Reading it back means whatever Codex redacted stays redacted.
    const redacted = "/usr/bin/zsh -lc 'curl -H \"token=[redacted]\" example'";
    const blocks: Block[] = [
      {
        id: "shell",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-1",
          title: "Shell",
          kind: "execute",
          preview: { kind: "shell", title: redacted },
        },
      },
    ];
    const repaired = backfillCodexShellCommands(blocks);
    expect(repaired[0].text).not.toBe("Shell");
    expect(repaired[0].tool?.preview?.title).toContain("[redacted]");
  });

  it("leaves a row with no usable saved command as it is", () => {
    // A weak preview title names no command, so there is nothing to relabel
    // from and the row keeps its placeholder.
    const blocks: Block[] = [
      {
        id: "shell",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-1",
          title: "Shell",
          kind: "execute",
          preview: { kind: "shell", title: "Shell" },
        },
      },
    ];
    expect(backfillCodexShellCommands(blocks)).toBe(blocks);
  });

  it("labels placeholder rows with the saved command and rebuilds the preview", () => {
    const blocks: Block[] = [
      {
        id: "shell",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-1",
          title: "Shell",
          kind: "execute",
          status: "failed",
          detail: "exit 1",
          preview: {
            kind: "shell",
            title: "rg --files -g AGENTS.md -g '!node_modules'",
          },
        },
      },
      {
        id: "read",
        role: "tool",
        text: "Read file.ts",
        tool: { callId: "exec-2", kind: "read" },
      },
    ];
    const repaired = backfillCodexShellCommands(blocks);
    expect(repaired[0]).toMatchObject({
      text: "Find files",
      tool: {
        title: "Find files",
        status: "failed",
        detail: "exit 1",
        preview: { kind: "shell", title: "rg --files -g AGENTS.md -g '!node_modules'" },
      },
    });
    expect(repaired[1]).toBe(blocks[1]);
    expect(backfillCodexShellCommands(repaired)).toBe(repaired);
  });

  it("keeps the raw command when no readable intent is inferred", () => {
    const blocks: Block[] = [
      {
        id: "shell",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-3",
          title: "Shell",
          kind: "execute",
          preview: { kind: "shell", title: "git commit -m 'Fix shell labels'" },
        },
      },
    ];
    const repaired = backfillCodexShellCommands(blocks);
    expect(repaired[0].text).toBe("git commit -m 'Fix shell labels'");
  });

  // A row repaired from the saved preview has to read the same as one rendered
  // live, or reopening a session would relabel work the user already saw.
  it("labels a recovered row exactly as the live item does", () => {
    // Captured from `codex app-server`: the reported session's middle row was
    // `rg --files -g AGENTS.md`, which Codex labels a path-less `listFiles`.
    const item = {
      type: "commandExecution",
      id: "exec-88885872",
      status: "inProgress",
      command: `/usr/bin/zsh -lc "rg --files -g AGENTS.md -g '"'"'!node_modules'"'"'"`,
      commandActions: [
        { type: "listFiles", command: "rg --files -g AGENTS.md -g '!node_modules'", path: null },
      ],
    };
    let live = newSession("codex", "/home/me/proj");
    live = applyHarnessEvents(live, mapCodexNotification("item/started", { item }).events);
    const liveRow = live.blocks[0];

    // The same row as the buggy build saved it. No recovered map: the command
    // is already on the row, which is how it reads in production.
    const saved: Block[] = [
      {
        id: "e84ab067",
        role: "tool",
        text: "Shell",
        tool: { ...liveRow.tool, title: "Shell" },
      },
    ];
    const [recovered] = backfillCodexShellCommands(saved);

    expect(recovered.text).not.toBe("Shell");
    expect(recovered.text).toBe(liveRow.text);
    expect(recovered.tool?.title).toBe(liveRow.tool?.title);
    expect(toolCallLabel(recovered, "/home/me/proj")).toBe(toolCallLabel(liveRow, "/home/me/proj"));
  });
});

describe("isPersistableId", () => {
  it("accepts alphanumeric ids with hyphens and underscores", () => {
    expect(isPersistableId("acp-session-1")).toBe(true);
    expect(isPersistableId("abc_123")).toBe(true);
  });

  it("rejects filesystem paths", () => {
    expect(isPersistableId("/Users/me/.pi/agent/sessions/abc.jsonl")).toBe(false);
  });
});

describe("persisting a subagent's trail", () => {
  const withRun = (steps: Block["agentRun"]) => {
    const session = newSession("claude", "/tmp/project");
    session.blocks = [
      {
        id: "a1",
        role: "tool",
        text: "Correctness review",
        tool: { callId: "agent-1", kind: "agent", status: "completed" },
        agentRun: steps,
      },
    ];
    return sanitizeSessionForPersist(session)?.blocks[0].agentRun;
  };

  it("keeps the run so a reopened session can still be inspected", () => {
    expect(
      withRun({
        name: "Correctness review",
        agentType: "code-reviewer",
        steps: [
          {
            id: "s1",
            kind: "tool",
            text: "Read src/App.tsx",
            toolKind: "read",
            status: "failed",
            detail: "File not found",
          },
          { id: "s2", kind: "message", text: "Nothing to flag." },
        ],
      }),
    ).toEqual({
      name: "Correctness review",
      agentType: "code-reviewer",
      steps: [
        {
          id: "s1",
          kind: "tool",
          text: "Read src/App.tsx",
          toolKind: "read",
          status: "failed",
          detail: "File not found",
        },
        { id: "s2", kind: "message", text: "Nothing to flag." },
      ],
    });
  });

  it("keeps run timing, and tolerates old runs without it", () => {
    const timed = withRun({
      name: "Review",
      steps: [],
      startedAt: 1_000,
      endedAt: 2_000,
    });
    expect(timed).toMatchObject({ startedAt: 1_000, endedAt: 2_000 });
    const old = withRun({ name: "Review", steps: [] });
    expect(old).not.toHaveProperty("startedAt");
    expect(old).not.toHaveProperty("endedAt");
    expect(withRun({ name: "Review", steps: [], startedAt: "x" } as never)).not.toHaveProperty(
      "startedAt",
    );
  });

  it("drops steps a provider left malformed", () => {
    expect(
      withRun({
        name: "Correctness review",
        steps: [
          { id: "", kind: "tool", text: "Read" },
          { id: "s2", kind: "bogus", text: "Read" },
          { id: "s3", kind: "tool", text: "Read src/App.tsx" },
        ] as never,
      })?.steps,
    ).toEqual([{ id: "s3", kind: "tool", text: "Read src/App.tsx" }]);
  });

  it("keeps only the tail of a long run", () => {
    const steps = Array.from({ length: 260 }, (_, index) => ({
      id: `s${index}`,
      kind: "tool" as const,
      text: `Read file-${index}.ts`,
    }));
    const saved = withRun({ name: "Correctness review", steps });
    expect(saved?.steps).toHaveLength(100);
    expect(saved?.steps[99].id).toBe("s259");
  });

  describe("results and prompt", () => {
    const run = (output?: string, count = 100): NonNullable<Block["agentRun"]> => ({
      name: "Correctness review",
      prompt: "Review the reducer.",
      steps: Array.from({ length: count }, (_, index) => ({
        id: `s${index}`,
        kind: "tool" as const,
        text: `Read file-${index}.ts`,
        toolKind: "read",
        status: "completed",
        ...(output ? { output } : {}),
      })),
    });
    const size = (value: unknown) => JSON.stringify(value).length;

    it("keeps a short result and the prompt", () => {
      const saved = withRun({
        ...run("export const a = 1;", 1),
        steps: [
          {
            id: "s1",
            kind: "tool",
            text: "Read a.ts",
            output: "export const a = 1;",
            outputTruncated: true,
          },
        ],
      });
      expect(saved?.prompt).toBe("Review the reducer.");
      expect(saved?.steps[0]).toMatchObject({
        output: "export const a = 1;",
        outputTruncated: true,
      });
    });

    it("saves a heavy 100-step run in a small fraction of its live size", () => {
      // What the live run holds: every step at the per-step cap.
      const live = run("z".repeat(4_000));
      const saved = withRun(live);
      const kept = (saved?.steps ?? []).reduce((sum, step) => sum + (step.output?.length ?? 0), 0);
      const bare = size(withRun(run()));
      // Measured for the report: no outputs, live outputs, saved outputs.
      expect(size(live)).toBeGreaterThan(400_000);
      expect(kept).toBeLessThanOrEqual(16_000);
      expect(size(saved)).toBeLessThan(bare + 20_000);
      // Newest results survive; older ones say they were left out.
      expect(saved?.steps[99].output).toBeDefined();
      expect(saved?.steps[0].output).toBeUndefined();
      expect(saved?.steps[0].outputTruncated).toBe(true);
    });

    it("re-trims a result longer than the saved per-step cap", () => {
      const saved = withRun(run("a".repeat(4_000), 1));
      expect(saved?.steps[0].output?.length).toBeLessThan(1_400);
      expect(saved?.steps[0].outputTruncated).toBe(true);
    });

    it("loads an old saved run without outputs exactly as before", () => {
      const saved = withRun({ name: "Review", steps: [{ id: "s1", kind: "tool", text: "Read" }] });
      expect(saved).toEqual({
        name: "Review",
        steps: [{ id: "s1", kind: "tool", text: "Read" }],
      });
    });
  });
});

describe("sanitizeSessionForPersist", () => {
  it("persists unresolved workspace preparation only on submitted user blocks", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      { id: "pending", role: "user", text: "Retry me", workspacePreparationPending: true },
      {
        id: "answer",
        role: "assistant",
        text: "Ignore malformed metadata",
        workspacePreparationPending: true,
      },
    ];
    const saved = sanitizeSessionForPersist(session);
    expect(saved.blocks[0].workspacePreparationPending).toBe(true);
    expect(saved.blocks[1].workspacePreparationPending).toBeUndefined();
    expect(saved.workspaceMode).toBeUndefined();
  });

  it.each(["pending", "undelivered", "uncertain"] as const)(
    "preserves %s follow-up recovery across local persistence",
    (followUpDelivery) => {
      const session = newSession("codex", "/repo");
      session.blocks = [
        {
          id: "held-follow-up",
          role: "user",
          text: "Retain this request",
          draft: true,
          followUpDelivery,
        },
      ];
      expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
        id: "held-follow-up",
        text: "Retain this request",
        draft: true,
        followUpDelivery,
      });
    },
  );

  it("does not attach follow-up recovery state to a submitted block", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      { id: "sent", role: "user", text: "Already delivered", followUpDelivery: "pending" },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0].followUpDelivery).toBeUndefined();
  });

  it("keeps the stripped /operator turn marker for later turns", () => {
    const submitted = appendUser(newSession("codex", "/repo"), "list notes", [], {
      bycoda: true,
    });
    expect(sanitizeSessionForPersist(submitted).blocks[0]).toMatchObject({
      role: "user",
      text: "list notes",
      bycoda: true,
    });
  });

  it("persists the request ID for an agent-sent follow-up", () => {
    const submitted = appendUser(newSession("codex", "/repo"), "Continue", [], {
      appRequestId: "app-source-request-1",
    });
    expect(sanitizeSessionForPersist(submitted).blocks[0]).toMatchObject({
      text: "Continue",
      appRequestId: "app-source-request-1",
    });
  });

  it("persists the request ID on an unsent agent-created draft", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      {
        id: "draft",
        role: "user",
        text: "Review later",
        draft: true,
        appRequestId: "app-source-draft-1",
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      draft: true,
      appRequestId: "app-source-draft-1",
    });
  });

  it("keeps an unsent user turn appended to a started thread", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      { id: "sent", role: "user", text: "Start here" },
      { id: "reply", role: "assistant", text: "Done" },
      { id: "draft", role: "user", text: "Explore this", draft: true },
    ];
    expect(sanitizeSessionForPersist(session).blocks).toEqual([
      { id: "sent", role: "user", text: "Start here" },
      { id: "reply", role: "assistant", text: "Done" },
      { id: "draft", role: "user", text: "Explore this", draft: true },
    ]);
  });

  it("persists generated image metadata without binary payloads", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      { id: "u", role: "user", text: "Draw this" },
      {
        id: "image",
        role: "image",
        text: "",
        image: {
          path: "/app-data/generated-images/image.png",
          name: "generated-image",
          mimeType: "image/png",
          size: 8,
          alt: "A clean product photo",
        },
      },
    ];

    expect(sanitizeSessionForPersist(session).blocks[1]).toEqual({
      id: "image",
      role: "image",
      text: "",
      image: {
        path: "/app-data/generated-images/image.png",
        name: "generated-image",
        mimeType: "image/png",
        size: 8,
        alt: "A clean product photo",
      },
    });
  });

  it("drops malformed generated image metadata", () => {
    const session = newSession("codex", "/repo");
    session.blocks = [
      { id: "u", role: "user", text: "Draw this" },
      {
        id: "image",
        role: "image",
        text: "",
        image: {
          path: "",
          name: "generated-image",
          mimeType: "image/png",
          size: 0,
        },
      },
    ];

    expect(sanitizeSessionForPersist(session).blocks).toEqual([
      { id: "u", role: "user", text: "Draw this" },
    ]);
  });

  it("persists a removed worktree as an explicit unselected working-copy state", () => {
    const session = newSession("codex", "/repo");
    session.worktreeCwd = "/repo-worktrees/feature";
    session.worktreeRemoved = true;
    session.blocks = [{ id: "u", role: "user", text: "Build feature" }];
    expect(sanitizeSessionForPersist(session)).toMatchObject({
      worktreeCwd: "/repo-worktrees/feature",
      worktreeRemoved: true,
    });
  });

  it("preserves an internal worker's lead, hidden turns, and token metrics", () => {
    const session = {
      ...newSession("claude", "/repo"),
      orchestrationLeadId: "lead",
    };
    session.blocks = [
      {
        id: "u",
        role: "user",
        text: "Bounded assignment",
        internal: true,
        turnMetrics: { inputTokens: 100, outputTokens: 20 },
      },
    ];
    const saved = sanitizeSessionForPersist(session);
    expect(saved.blocks[0]).toMatchObject({
      orchestrationLeadId: "lead",
      internal: true,
      turnMetrics: { inputTokens: 100, outputTokens: 20 },
    });
    expect(session.blocks[0].orchestrationLeadId).toBeUndefined();
    expect(
      sanitizeSessionForPersist({
        ...session,
        orchestrationLeadId: undefined,
        blocks: saved.blocks,
      }).blocks[0],
    ).toEqual(saved.blocks[0]);
  });
  it("persists model provenance recorded on a user turn", () => {
    const session = newSession("claude", "/tmp/project", "claude:opus-5");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "remember this",
        turnModel: {
          harness: "claude",
          id: "claude:opus-5",
          name: "Claude Opus 5",
        },
      },
    ];

    expect(sanitizeSessionForPersist(session).blocks[0]?.turnModel).toEqual({
      harness: "claude",
      id: "claude:opus-5",
      name: "Claude Opus 5",
    });
  });

  it("persists a BTW thread's model and provider settings", () => {
    const session = newSession("codex", "/tmp/project");
    const thread: BtwThread = {
      id: "btw-1",
      sourceEndBlockId: "u1",
      createdAt: 1,
      updatedAt: 2,
      status: "ready",
      messages: [
        { id: "m1", role: "user", text: "Why?", createdAt: 1 },
        { id: "m2", role: "assistant", text: "Because.", createdAt: 2 },
      ],
      model: "codex:gpt-5.4",
      providerThreadId: "side-provider-thread",
      providerAccountId: "account-a",
      modelSettings: {
        reasoningEffort: "high",
        serviceTier: "fast",
      },
    };
    session.blocks = [{ id: "u1", role: "user", text: "Explain this", btwThreads: [thread] }];

    expect(sanitizeSessionForPersist(session).blocks[0]?.btwThreads).toEqual([thread]);
  });

  it("persists provider metrics recorded on a user turn", () => {
    const session = newSession("claude", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "remember this",
        turnMetrics: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 80,
          cacheHitPercent: 40,
        },
      },
    ];

    expect(sanitizeSessionForPersist(session).blocks[0]?.turnMetrics).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheHitPercent: 40,
    });
  });

  it("persists a canonical GitHub work-item identity", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [{ id: "u1", role: "user", text: "fix PR #42" }];
    session.linkedWorkItem = {
      kind: "pr",
      repo: "openai/codex",
      number: 42,
      url: "https://example.com/not-trusted",
    };

    expect(sanitizeSessionForPersist(session).linkedWorkItem).toEqual({
      kind: "pr",
      repo: "openai/codex",
      number: 42,
      url: "https://github.com/openai/codex/pull/42",
    });
  });

  it("persists the automation that started a session", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [{ id: "u1", role: "user", text: "review PRs" }];
    session.automationId = "automation-1";
    expect(sanitizeSessionForPersist(session).automationId).toBe("automation-1");
  });

  it("omits a path-like provider session id so upsert can still snapshot git", () => {
    const session = newSession("pi", "/tmp/project");
    session.providerSessionId = "/Users/me/.pi/agent/sessions/abc.jsonl";
    session.blocks = [{ id: "u1", role: "user", text: "hey" }];

    expect(sanitizeSessionForPersist(session).providerSessionId).toBeUndefined();
  });

  it("keeps a UUID provider session id", () => {
    const session = newSession("pi", "/tmp/project");
    session.providerSessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    session.blocks = [{ id: "u1", role: "user", text: "hey" }];

    expect(sanitizeSessionForPersist(session).providerSessionId).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("keeps a handoff divider and settles a preparing one", () => {
    const session = newSession("cursor", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "hey" },
      {
        id: "h1",
        role: "handoff",
        text: "",
        handoff: { from: "cursor", to: "claude", status: "preparing" },
      },
    ];
    const persisted = sanitizeSessionForPersist(session);
    expect(persisted.blocks[1]).toMatchObject({
      role: "handoff",
      handoff: { from: "cursor", to: "claude", status: "ready", pending: true },
    });
  });

  it("keeps valid interjection chrome only on system blocks", () => {
    const session = newSession("pi", "/tmp/project");
    session.blocks = [
      {
        id: "i1",
        role: "system",
        text: "Review the fallback.",
        interjection: { customType: " advisor ", severity: "blocker" },
      },
      {
        id: "a1",
        role: "assistant",
        text: "Not chrome",
        interjection: { customType: "advisor", severity: "nit" },
      },
    ];

    const persisted = sanitizeSessionForPersist(session);
    expect(persisted.blocks[0]).toMatchObject({
      role: "system",
      text: "Review the fallback.",
      interjection: { customType: "advisor", severity: "blocker" },
    });
    expect(persisted.blocks[1]?.interjection).toBeUndefined();
  });

  it("drops malformed interjection metadata without dropping its system row", () => {
    const session = newSession("pi", "/tmp/project");
    session.blocks = [
      {
        id: "i1",
        role: "system",
        text: "Still visible",
        interjection: {
          customType: " ",
          severity: "unknown",
        } as unknown as Block["interjection"],
      },
    ];

    expect(sanitizeSessionForPersist(session).blocks[0]).toEqual({
      id: "i1",
      role: "system",
      text: "Still visible",
    });
  });

  it("keeps a notice flag on system blocks and drops anything else", () => {
    const session = newSession("pi", "/tmp/project");
    session.blocks = [
      {
        id: "e1",
        role: "system",
        text: "Provider connection lost",
        notice: "error",
      },
      {
        id: "i1",
        role: "system",
        text: "Turn interrupted when Bycoda quit.",
        notice: "interrupt",
      },
      {
        id: "info",
        role: "system",
        text: "Earlier conversation was not transferred. Saved history: /history.json",
        notice: "info",
      },
      {
        id: "b1",
        role: "system",
        text: "Mystery",
        notice: "mystery" as Block["notice"],
      },
      {
        id: "a1",
        role: "assistant",
        text: "hi",
        notice: "error" as Block["notice"],
      },
    ];

    const persisted = sanitizeSessionForPersist(session).blocks;
    expect(persisted[0]?.notice).toBe("error");
    expect(persisted[1]?.notice).toBe("interrupt");
    expect(persisted[2]?.notice).toBe("info");
    expect(persisted[3]?.notice).toBeUndefined();
    expect(persisted[4]?.notice).toBeUndefined();
  });

  it("keeps a second-opinion card on the user turn", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "Second opinion",
        secondOpinion: {
          from: "claude",
          to: "codex",
          request: "fix the footer",
          files: 2,
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      role: "user",
      text: "Second opinion",
      secondOpinion: {
        from: "claude",
        to: "codex",
        request: "fix the footer",
        files: 2,
      },
    });
  });

  it("keeps a handoff card kind on the user turn", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "Handoff",
        secondOpinion: {
          from: "claude",
          to: "codex",
          kind: "handoff",
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      role: "user",
      text: "Handoff",
      secondOpinion: { from: "claude", to: "codex", kind: "handoff" },
    });
  });

  it("keeps a note card on the user turn without the note body", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "hi",
        noteCard: {
          id: "n1",
          slug: "overview",
          title: "agent-os project overview",
          sourceCwd: "/tmp/project",
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toEqual({
      id: "u1",
      role: "user",
      text: "hi",
      noteCard: {
        id: "n1",
        slug: "overview",
        title: "agent-os project overview",
        sourceCwd: "/tmp/project",
      },
    });
  });

  it("keeps edited and approved plan metadata", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "plan this" },
      {
        id: "p1",
        role: "plan",
        text: "# Edited plan",
        plan: {
          key: "turn:1",
          status: "built",
          originalText: "# Original plan",
          approvedText: "# Edited plan",
          edited: true,
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[1]).toMatchObject({
      role: "plan",
      text: "# Edited plan",
      plan: {
        key: "turn:1",
        status: "built",
        originalText: "# Original plan",
        approvedText: "# Edited plan",
        edited: true,
      },
    });
  });

  it("keeps structured task lists", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "fix it" },
      {
        id: "tasks1",
        role: "tasks",
        text: "[x] Inspect\n[~] Implement",
        taskList: {
          key: "turn_1",
          explanation: "Inspection complete.",
          items: [
            { id: "1", text: "Inspect", status: "completed" },
            { id: "2", text: "Implement", status: "in_progress" },
          ],
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[1]).toEqual(session.blocks[1]);
  });
});

describe("persistFingerprint", () => {
  const user: Block = { id: "u1", role: "user", text: "hi" };
  const answer: Block = { id: "a1", role: "assistant", text: "done" };

  // One base session: `newSession` mints a fresh id, and the id is part of the
  // fingerprint, so variants have to be spread off a single session.
  const base = (blocks: Block[] = [user, answer]): Session => ({
    ...newSession("codex", "/tmp/project"),
    blocks,
  });

  it("is stable while nothing changes", () => {
    const session = base();
    expect(persistFingerprint(session)).toBe(persistFingerprint(session));
  });

  it("matches a copy holding the same blocks", () => {
    const session = base();
    expect(persistFingerprint({ ...session })).toBe(persistFingerprint(session));
  });

  it("changes when an automation origin is stamped", () => {
    const before = base();
    expect(persistFingerprint({ ...before, automationId: "automation-1" })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("tracks rewind headers and durable stop markers", () => {
    const before = base([user]);
    const archive: Session = {
      ...before,
      rewindHistory: [
        {
          id: "rewind-1",
          createdAt: 1,
          fromBlockId: "u1",
          blocks: [{ id: "removed", role: "user", text: "archived" }],
        },
      ],
      pendingContextReplay: "retained context",
    };
    expect(persistFingerprint(archive)).not.toBe(persistFingerprint(before));
    expect(persistFingerprint({ ...archive, pendingContextReplay: undefined })).not.toBe(
      persistFingerprint(archive),
    );
    expect(
      persistFingerprint({
        ...before,
        blocks: [{ ...user, turnOutcome: "stopped", turnStoppedAt: 10 }],
      }),
    ).not.toBe(persistFingerprint(before));
  });

  it("changes when a block in the middle is replaced", () => {
    const tool: Block = {
      id: "t1",
      role: "tool",
      text: "run",
      tool: { status: "running" },
    };
    const before = base([user, tool, answer]);
    const after = {
      ...before,
      blocks: [user, { ...tool, tool: { status: "completed" } }, answer],
    };
    expect(persistFingerprint(after)).not.toBe(persistFingerprint(before));
  });

  it("changes when an approval is decided", () => {
    const approval: Block = {
      id: "p1",
      role: "approval",
      text: "allow?",
      approval: { requestId: 1 },
    };
    const before = base([user, approval]);
    const after = {
      ...before,
      blocks: [user, { ...approval, approval: { requestId: 1, decided: "allow" as const } }],
    };
    expect(persistFingerprint(after)).not.toBe(persistFingerprint(before));
  });

  it("changes when a block is appended", () => {
    const before = base([user]);
    expect(persistFingerprint({ ...before, blocks: [user, answer] })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("changes when a persisted field changes", () => {
    const before = base();
    expect(persistFingerprint({ ...before, title: "Renamed" })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("ignores state that is never written", () => {
    const before = base();
    expect(persistFingerprint({ ...before, busy: true })).toBe(persistFingerprint(before));
  });

  it("treats a path-like provider session id as absent", () => {
    const session = base();
    expect(
      persistFingerprint({
        ...session,
        providerSessionId: "/Users/me/.pi/agent/sessions/abc.jsonl",
      }),
    ).toBe(persistFingerprint(session));
  });

  it("matches persist for a zero context window", () => {
    const session = base();
    expect(persistFingerprint({ ...session, context: { used: 10, window: 0 } })).toBe(
      persistFingerprint({ ...session, context: { used: 10 } }),
    );
  });
});
it("saves the exact CI context alongside the compact user message", () => {
  const context =
    "Checked commit: abc123\n\nRun tests failed at src/app.test.ts:42\nExpected 2, received 1";
  const session = appendUser(
    newSession("codex", "/tmp/project"),
    "Fix 1 failed CI check for acme/web PR #42.",
    [],
    { ciContext: context },
  );
  const saved = JSON.parse(JSON.stringify(sanitizeSessionForPersist(session)));
  expect(saved.blocks[0]).toMatchObject({
    role: "user",
    text: "Fix 1 failed CI check for acme/web PR #42.",
    ciContext: context,
  });
});
