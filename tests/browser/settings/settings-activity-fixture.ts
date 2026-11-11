/**
 * Synthetic Today / active-time data for Settings > Account (`?activity=1`). Never reaches the
 * owner's host, logs or provider accounts. Returns undefined for commands it does not own.
 */
export function activityFixture(command: string, args: Record<string, unknown>): unknown {
  if (new URLSearchParams(location.search).get("activity") !== "1") return undefined;
  const hour = 3_600_000;
  const now = Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = Math.max(midnight.getTime(), now - 9 * hour);
  if (command === "remote_machines")
    return [
      {
        id: "fixture-local",
        name: "This computer",
        localHost: true,
        endpoint: "http://127.0.0.1:9999",
        environmentId: "fixture-local",
      },
    ];
  if (command === "remote_request" && args.method === "activity.summary") {
    const last7Days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now - (6 - index) * 24 * hour);
      const pad = (value: number) => String(value).padStart(2, "0");
      return {
        date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
        minutes: [45, 120, 0, 210, 95, 160, 101][index]!,
      };
    });
    return { today: 101, week: 466, month: 1_240, year: 8_310, last7Days };
  }
  if (command === "session_usage_report") {
    const projects = [
      ["/fixture/upstream", "Backend performance", 4.1],
      ["/fixture/upstream", "Session detail card", 1.6],
      ["/fixture/bycode-website", "Landing copy", 0.4],
      ["/fixture/accounts-admin", "Admin roles", 0.9],
      ["/fixture/mobile", "Push setup", 0.25],
    ] as const;
    return {
      truncated: false,
      turns: projects.map(([project, title, hours], index) => ({
        sessionId: `fixture-session-${index}`,
        title,
        project,
        provider: index % 2 ? "codex" : "claude",
        accountId: null,
        model: index % 2 ? "gpt-5.5" : "claude-opus-5-5",
        startedAt: start + index * 20 * 60_000,
        durationMs: hours * hour,
        inputTokens: 120_000 * (index + 1),
        outputTokens: 18_000 * (index + 1),
        cacheReadTokens: 900_000,
        cacheWriteTokens: 0,
      })),
    };
  }
  if (command === "provider_usage_report")
    return {
      found: true,
      filesScanned: 1,
      rows: ["/fixture/upstream", "/fixture/bycode-website", "/fixture/accounts-admin"].map(
        (project, index) => ({
          slot: Math.floor((start + index * 30 * 60_000) / 1000),
          model: args.provider === "codex" ? "gpt-5.5" : "claude-opus-5-5",
          project,
          input: 400_000 / (index + 1),
          cacheRead: 2_000_000 / (index + 1),
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          output: 60_000 / (index + 1),
        }),
      ),
    };
  return undefined;
}
