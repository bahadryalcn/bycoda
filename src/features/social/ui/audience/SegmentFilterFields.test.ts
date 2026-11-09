// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudienceFilter } from "../../model/audience";
import { SegmentFilterFields, withFilterField } from "./SegmentFilterFields";
import { fieldByLabel, mountHost, setFieldValue, type MountedHost } from "./audienceTestKit";

describe("withFilterField", () => {
  it("sets a field and keeps the others", () => {
    expect(withFilterField({ language: "tr" }, { minScore: 40 })).toEqual({
      language: "tr",
      minScore: 40,
    });
  });

  it("drops a field once it is emptied, so an empty filter stays empty", () => {
    expect(withFilterField({ language: "tr", tags: ["vip"] }, { language: "" })).toEqual({
      tags: ["vip"],
    });
    expect(withFilterField({ tags: ["vip"] }, { tags: [] })).toEqual({});
    expect(withFilterField({ minScore: 10 }, { minScore: undefined })).toEqual({});
  });

  it("keeps a minimum score of zero, which is a real condition", () => {
    expect(withFilterField({}, { minScore: 0 })).toEqual({ minScore: 0 });
  });

  it("does not change the filter it was given", () => {
    const original: AudienceFilter = { language: "tr" };
    withFilterField(original, { language: "" });
    expect(original).toEqual({ language: "tr" });
  });
});

let host: MountedHost;
let latest: AudienceFilter = {};
const onChange = vi.fn();

beforeEach(() => {
  host = mountHost();
  latest = {};
  onChange.mockClear();
});

afterEach(() => {
  host.unmount();
});

function Harness({ initial = {} }: { initial?: AudienceFilter }) {
  const [value, setValue] = useState<AudienceFilter>(initial);
  latest = value;
  return createElement(SegmentFilterFields, {
    value,
    onChange: (next: AudienceFilter) => {
      onChange(next);
      setValue(next);
    },
  });
}

function checkbox(text: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll("label")).find(
    (item) => item.textContent?.trim() === text,
  );
  const input = label?.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!input) throw new Error(`No checkbox "${text}"`);
  return input;
}

describe("SegmentFilterFields", () => {
  it("toggles a platform on and off", () => {
    host.render(createElement(Harness));
    act(() => checkbox("X").click());
    expect(latest).toEqual({ platforms: ["x"] });
    act(() => checkbox("Instagram").click());
    expect(latest).toEqual({ platforms: ["x", "instagram"] });
    act(() => checkbox("X").click());
    expect(latest).toEqual({ platforms: ["instagram"] });
    act(() => checkbox("Instagram").click());
    expect(latest).toEqual({});
  });

  it("filters by stage and by how the person came in", () => {
    host.render(createElement(Harness));
    act(() => checkbox("Replied").click());
    act(() => checkbox("Comment").click());
    expect(latest).toEqual({ stages: ["replied"], sources: ["comment"] });
  });

  it("shows the checked state of the filter it is given", () => {
    host.render(createElement(Harness, { initial: { platforms: ["x"], stages: ["new"] } }));
    expect(checkbox("X").checked).toBe(true);
    expect(checkbox("Instagram").checked).toBe(false);
    expect(checkbox("New").checked).toBe(true);
  });

  it("stores the language trimmed and removes it when the field is emptied", () => {
    host.render(createElement(Harness));
    setFieldValue(fieldByLabel("Language"), " tr ");
    expect(latest).toEqual({ language: "tr" });
    setFieldValue(fieldByLabel("Language"), "");
    expect(latest).toEqual({});
  });

  it("stores a minimum interest score and removes it when the field is cleared", () => {
    host.render(createElement(Harness));
    setFieldValue(fieldByLabel("Minimum interest score"), "40");
    expect(latest).toEqual({ minScore: 40 });
    setFieldValue(fieldByLabel("Minimum interest score"), "");
    expect(latest).toEqual({});
  });

  it("stores the name or text to search for", () => {
    host.render(createElement(Harness));
    setFieldValue(fieldByLabel("Name or text contains"), "ada");
    expect(latest).toEqual({ query: "ada" });
  });

  it("stores each tag the owner adds with the Enter key", () => {
    host.render(createElement(Harness));
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Add a tag"]');
    expect(input).toBeTruthy();
    setFieldValue(input!, "vip");
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(latest).toEqual({ tags: ["vip"] });
  });
});
