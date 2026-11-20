import { expect, it } from "vitest";
import englishSource from "./locales/en.json";
import { NATIVE_LABEL_KEYS } from "./nativeLabelKeys";

// In-app menu copy is sentence case (#302). A Title Case twin would be a second catalog key
// for the same command, so the retired keys must stay out of the source catalog.
const RETIRED_TITLE_CASE_KEYS = [
  "Move to New Window",
  "Cancel Move to New Window",
  "New Folder",
  "New Tab",
];

const SENTENCE_CASE_KEYS = [
  "Move to new window",
  "Cancel move to new window",
  "New folder",
  "New tab",
  "Toggle sidebar",
  "Zoom in",
  "Select all",
];

it.each(RETIRED_TITLE_CASE_KEYS)("retires the Title Case menu key %s", (key) => {
  expect(englishSource).not.toHaveProperty([key]);
});

it.each(SENTENCE_CASE_KEYS)("keeps the sentence-case menu key %s", (key) => {
  expect(englishSource).toHaveProperty([key]);
});

// The native macOS and Windows menus translate these Title Case keys through `native_language_set`.
it.each(["Toggle Sidebar", "Zoom In", "Select All"])(
  "keeps %s as a native label key beside the in-app copy",
  (key) => {
    expect(NATIVE_LABEL_KEYS).toContain(key);
    expect(englishSource).toHaveProperty([key]);
  },
);
