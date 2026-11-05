import { expect, it } from "vitest";
import { RuntimeLogsService } from "./runtime-logs";
import { RuntimeTerminalLogs } from "./runtime-terminal-logs";

const packet = (text: string, sequence: number, extra = {}) => ({
  terminalId: "term-1",
  sequence,
  data: Buffer.from(text).toString("base64"),
  ...extra,
});

it("captures Next.js terminal output without a mounted terminal or log view", () => {
  const logs = new RuntimeLogsService();
  const terminals = new RuntimeTerminalLogs(logs);
  terminals.append("project", packet("\x1b[32m✓ Ready in 120ms\x1b[0m\r\nGET / 200 in 12ms\n", 0));
  expect(
    logs.read({ projectId: "project", source: "server" }).entries.map((entry) => entry.message),
  ).toEqual(["✓ Ready in 120ms", "GET / 200 in 12ms"]);
  expect(logs.read({ projectId: "other" }).entries).toEqual([]);
  terminals.append("project", packet("", 1, { closed: true }));
  expect(logs.sources({ projectId: "project" })[0].available).toBe(false);
  expect(logs.read().entries).toHaveLength(2);
});

it("handles split UTF-8 and ANSI/OSC sequences and redacts split credentials before retention", () => {
  const logs = new RuntimeLogsService();
  const terminals = new RuntimeTerminalLogs(logs);
  const bytes = Buffer.from("\x1b]0;private title\x07\x1b[32mTürkçe\x1b[0m token=secret-value\n");
  for (let index = 0; index < bytes.length; index++)
    terminals.append("project", {
      terminalId: "term-1",
      sequence: index,
      data: bytes.subarray(index, index + 1).toString("base64"),
    });
  expect(logs.read().entries[0].message).toBe("Türkçe token=[REDACTED]");
  expect(JSON.stringify(logs.read())).not.toContain("private title");
});

it("discards a partial line after dropped chunks, rejects replay, and bounds unterminated lines", () => {
  const logs = new RuntimeLogsService();
  const terminals = new RuntimeTerminalLogs(logs);
  terminals.append("project", packet("token=sec", 0));
  terminals.append("project", packet("ret\nGET / 200 in 2ms\n", 2));
  terminals.append("project", packet("duplicate\n", 2));
  terminals.append("project", packet("x".repeat(20_000) + "\n", 3));
  expect(logs.read().entries).toHaveLength(3);
  expect(logs.read().entries[0]).toMatchObject({
    level: "warn",
    details: { captureGap: true, expectedSequence: 1, receivedSequence: 2 },
  });
  expect(logs.read().entries[1].message).toBe("GET / 200 in 2ms");
  expect(logs.read().entries[2].message.length).toBeLessThan(8300);
});

it("discards partial lines after native queue gaps within a batched packet", () => {
  const logs = new RuntimeLogsService();
  const terminals = new RuntimeTerminalLogs(logs);
  terminals.append("project", packet("password=sec", 0));
  terminals.append("project", packet("ret\nReady in 100ms\n", 1, { interrupted: true }));
  expect(logs.read().entries[0]).toMatchObject({
    sourceId: "server:terminal:term-1",
    level: "warn",
    details: { captureGap: true, interrupted: true },
  });
  expect(
    logs
      .read()
      .entries.slice(1)
      .map((entry) => entry.message),
  ).toEqual(["Ready in 100ms"]);
});

it("redacts multiline PEM across packets, stream gaps and closure with isolated terminal state", () => {
  const logs = new RuntimeLogsService();
  const terminals = new RuntimeTerminalLogs(logs);
  terminals.append("project", packet("-----BEGIN PRI", 0));
  terminals.append("project", packet("VATE KEY-----\nSYNTHETIC_BODY_A\n", 1));
  terminals.append("project", {
    ...packet("other terminal diagnostic\n", 0),
    terminalId: "term-2",
  });
  terminals.append("project", packet("lost-tail\nSYNTHETIC_BODY_B\n", 3));
  terminals.append("project", packet("-----END PRIVATE KEY-----\nrecovered\n", 4));
  terminals.append(
    "project",
    packet("-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC_FINAL", 5, { closed: true }),
  );
  expect(JSON.stringify(logs.read())).not.toContain("SYNTHETIC");
  expect(logs.read().entries.map((entry) => entry.message)).toContain("other terminal diagnostic");
  expect(logs.read().entries.map((entry) => entry.message)).toContain("recovered");
});

it("recognizes PEM openers beyond the retained line length", () => {
  const logs = new RuntimeLogsService();
  const terminals = new RuntimeTerminalLogs(logs);
  terminals.append(
    "project",
    packet("prefix".repeat(1500) + "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_BODY\n", 0),
  );
  expect(JSON.stringify(logs.read())).not.toContain("SYNTHETIC");
});
