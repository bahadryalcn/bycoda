import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { markdownEdit, type MarkdownCommand } from "./markdownCommands";

/** Runs a command on text where `{` and `}` mark the selection, `|` the caret. */
function run(command: MarkdownCommand, marked: string): string {
  const caret = marked.indexOf("|");
  const from = caret >= 0 ? caret : marked.indexOf("{");
  const to = caret >= 0 ? caret : marked.indexOf("}") - 1;
  const doc = marked.replace(/[{}|]/g, "");
  const edit = markdownEdit(command, doc, from, to);
  const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
  if (edit.anchor === edit.head) {
    return `${next.slice(0, edit.anchor)}|${next.slice(edit.anchor)}`;
  }
  return `${next.slice(0, edit.anchor)}{${next.slice(edit.anchor, edit.head)}}${next.slice(edit.head)}`;
}

describe("inline formatting", () => {
  it("wraps and unwraps the selection in bold", () => {
    expect(run("bold", "a {word} b")).toBe("a **{word}** b");
    expect(run("bold", "a **{word}** b")).toBe("a {word} b");
  });

  it("places the caret between new markers", () => {
    expect(run("bold", "a | b")).toBe("a **|** b");
    expect(run("italic", "a | b")).toBe("a *|* b");
  });

  it("keeps surrounding whitespace outside the markers", () => {
    expect(run("bold", "a{ word }b")).toBe("a **{word}** b");
  });

  it("adds italic to bold text instead of removing a bold marker", () => {
    expect(run("italic", "**{word}**")).toBe("***{word}***");
    expect(run("italic", "***{word}***")).toBe("**{word}**");
    expect(run("italic", "*{word}*")).toBe("{word}");
  });
});

describe("line formatting", () => {
  it("cycles a heading through three levels and back", () => {
    expect(run("heading", "Ti|tle")).toBe("# Ti|tle");
    expect(run("heading", "# Ti|tle")).toBe("## Ti|tle");
    expect(run("heading", "### Ti|tle")).toBe("Ti|tle");
  });

  it("turns the selected lines into a list and back", () => {
    expect(run("bullet", "{one\ntwo}")).toBe("{- one\n- two}");
    expect(run("bullet", "{- one\n- two}")).toBe("{one\ntwo}");
    expect(run("numbered", "{one\n\ntwo}")).toBe("{1. one\n\n2. two}");
  });

  it("switches between list kinds without stacking markers", () => {
    expect(run("checklist", "{- one\n2. two}")).toBe("{- [ ] one\n- [ ] two}");
    expect(run("bullet", "  - [x] do|ne")).toBe("  - do|ne");
  });

  it("starts a list item on an empty line", () => {
    expect(run("checklist", "|")).toBe("- [ ] |");
  });

  it("quotes and unquotes every selected line", () => {
    expect(run("quote", "{one\n\ntwo}")).toBe("{> one\n> \n> two}");
    expect(run("quote", "{> one\n> two}")).toBe("{one\ntwo}");
  });
});

describe("code and links", () => {
  function renderCommand(command: MarkdownCommand, text: string) {
    const edit = markdownEdit(command, text, 0, text.length);
    const markdown =
      command === "link" && edit.insert.slice(edit.anchor, edit.head) === "url"
        ? `${edit.insert.slice(0, edit.anchor)}https://example.com${edit.insert.slice(edit.head)}`
        : edit.insert;
    return renderToStaticMarkup(
      createElement(Streamdown, {
        mode: "static",
        children: markdown,
        components: {
          code: ({ children }) => createElement("code", null, children),
          a: ({ href, children }) => createElement("a", { href }, children),
        },
      }),
    );
  }

  it("renders embedded backticks and padding as one intact code example", () => {
    for (const text of ["a`b", "a``b`c", "`word", "word`", "`", " word ", "   "]) {
      expect(renderCommand("code", text)).toContain(`<code>${text}</code>`);
    }
    expect(renderCommand("code", "one\n```\ntwo\n````")).toContain(
      "<code>one\n```\ntwo\n````\n</code>",
    );
  });

  it("renders escaped selected labels and absolute www destinations", () => {
    expect(renderCommand("link", "a]b\\[c")).toContain(
      '<a href="https://example.com/">a]b\\[c</a>',
    );
    expect(renderCommand("link", "www.example.com")).toContain(
      '<a href="https://www.example.com/">text</a>',
    );
  });

  it("uses inline code for part of a line and a fence otherwise", () => {
    expect(run("code", "run {npm test} now")).toBe("run `{npm test}` now");
    expect(run("code", "text|")).toBe("text\n```\n|\n```");
    expect(run("code", "{a\nb}")).toBe("```\n{a\nb}\n```");
  });

  it("uses delimiters longer than every embedded backtick run", () => {
    expect(run("code", "{a`b}")).toBe("``{a`b}``");
    expect(run("code", "{a``b`c}")).toBe("```{a``b`c}```");
    expect(run("code", "{one\n```\ntwo\n````}")).toBe("`````\n{one\n```\ntwo\n````}\n`````");
  });

  it("pads inline code when backticks touch its edges", () => {
    expect(run("code", "{`word}")).toBe("`` {`word} ``");
    expect(run("code", "{word`}")).toBe("`` {word`} ``");
    expect(run("code", "{`}")).toBe("`` {`} ``");
  });

  it("handles large selections containing many separate backtick runs", () => {
    const selected = "a`".repeat(150_000) + "b";
    const edit = markdownEdit("code", selected, 0, selected.length);
    expect(edit.insert).toBe(`\`\`${selected}\`\``);
    expect(edit.anchor).toBe(2);
    expect(edit.head).toBe(selected.length + 2);
  });

  it("preserves whitespace through CommonMark inline padding", () => {
    expect(run("code", "{ word }")).toBe("` { word } `");
    expect(run("code", "{ word}")).toBe("`{ word}`");
    expect(run("code", "{word }")).toBe("`{word }`");
    expect(run("code", "{   }")).toBe("`{   }`");
  });

  it("unwraps code selections with matching safe delimiters and padding", () => {
    expect(run("code", "`{word}`")).toBe("{word}");
    expect(run("code", "``{a`b}``")).toBe("{a`b}");
    expect(run("code", "`` {`word} ``")).toBe("{`word}");
    expect(run("code", "` { word } `")).toBe("{ word }");
    expect(run("code", "{`` `word ``}")).toBe("{`word}");
  });

  it("selects the part of a link that still needs typing", () => {
    expect(run("link", "see {docs}")).toBe("see [docs]({url})");
    expect(run("link", "{https://example.com}")).toBe("[{text}](https://example.com)");
    expect(run("link", "|")).toBe("[{text}](url)");
  });

  it("escapes brackets and literal backslashes in link labels", () => {
    expect(run("link", "see {a]b}")).toBe("see [a\\]b]({url})");
    expect(run("link", "{[docs]}")).toBe("[\\[docs\\]]({url})");
    expect(run("link", "{a\\]b}")).toBe("[a\\\\\\]b]({url})");
  });

  it("normalizes recognized www destinations to HTTPS", () => {
    expect(run("link", "see {www.example.com}")).toBe("see [{text}](https://www.example.com)");
    expect(run("link", "{www.example.com/docs?q=test#intro}")).toBe(
      "[{text}](https://www.example.com/docs?q=test#intro)",
    );
    expect(run("link", "{http://example.com}")).toBe("[{text}](http://example.com)");
  });
});

describe("strikethrough and blocks", () => {
  it("wraps and unwraps the selection in strikethrough", () => {
    expect(run("strike", "a {word} b")).toBe("a ~~{word}~~ b");
    expect(run("strike", "a ~~{word}~~ b")).toBe("a {word} b");
  });

  it("puts a table on its own paragraph with the first header selected", () => {
    expect(run("table", "text|")).toBe("text\n\n| {Column} | Column |\n| --- | --- |\n|  |  |\n\n");
    expect(run("table", "|")).toBe("| {Column} | Column |\n| --- | --- |\n|  |  |\n\n");
  });

  it("keeps a rule apart from the text so it is not read as a heading", () => {
    expect(run("rule", "text|\nmore")).toBe("text\n\n---\n|\nmore");
  });
});
