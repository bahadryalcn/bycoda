import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { findTranscriptBlocks } from "./transcriptFind";

describe("findTranscriptBlocks", () => {
  const blocks: Block[] = [
    { id: "user", role: "user", text: "Find the sidebar chip" },
    {
      id: "tool",
      role: "tool",
      text: "",
      tool: {
        kind: "search",
        status: "completed",
        preview: { kind: "search", query: "sidebar chip" },
      },
    },
    { id: "assistant", role: "assistant", text: "The sidebar chip is fixed." },
    { id: "reasoning", role: "reasoning", text: "sidebar chip" },
  ];

  it("finds matching transcript blocks in reading order, including tool previews", () => {
    expect(findTranscriptBlocks(blocks, "SIDEBAR chip")).toEqual(["user", "tool", "assistant"]);
  });

  it("matches Turkish text across case and diacritics", () => {
    const turkish: Block[] = [
      { id: "a", role: "user", text: "ISPARTA'daki gül bahçesi" },
      { id: "b", role: "assistant", text: "İstanbul'da kırmızı ışık" },
    ];
    expect(findTranscriptBlocks(turkish, "ısparta")).toEqual(["a"]);
    expect(findTranscriptBlocks(turkish, "GUL BAHCESI")).toEqual(["a"]);
    expect(findTranscriptBlocks(turkish, "istanbul")).toEqual(["b"]);
    expect(findTranscriptBlocks(turkish, "Kırmızı Işık")).toEqual(["b"]);
  });

  it("accepts the words of a query in any order", () => {
    const words: Block[] = [
      { id: "a", role: "user", text: "fix the websocket reconnect" },
      { id: "b", role: "user", text: "websocket only" },
    ];
    expect(findTranscriptBlocks(words, "reconnect websocket")).toEqual(["a"]);
  });

  it("ignores empty queries and hidden reasoning", () => {
    expect(findTranscriptBlocks(blocks, "  ")).toEqual([]);
    expect(findTranscriptBlocks(blocks, "reasoning only")).toEqual([]);
  });

  it("re-folds replaced blocks and keeps ASCII/Turkish folding consistent", () => {
    const a: Block = { id: "a", role: "assistant", text: "ISTANBUL Chip" };
    expect(findTranscriptBlocks([a], "istanbul")).toEqual(["a"]);
    expect(findTranscriptBlocks([a], "İSTANBUL")).toEqual(["a"]);
    const b: Block = { ...a, text: "ıstanbul değil" };
    expect(findTranscriptBlocks([b], "ISTANBUL degil")).toEqual(["a"]);
    expect(findTranscriptBlocks([b], "chip")).toEqual([]);
  });
});
