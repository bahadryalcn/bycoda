# Application languages

The UI supports Turkish, English, German, French, Spanish, Portuguese,
Simplified Chinese and Japanese. Settings → General → Application language
changes the language immediately. The default follows the system's preferred
supported language, falling back to English. Regional variants use the matching
catalog (for example, `tr-TR`, `pt-BR`, and `zh-Hans`).

Settings → General also provides **Git interface language** and **Technical interface
language**. Both default to English independently of the application language.
Each offers the eight languages or **Follow application language**. Git panels,
branch/worktree dialogs and diffs use the Git preference. File viewer/editor,
terminal and developer-tool controls use the technical preference; code, file
contents, command output and generated commit messages remain verbatim.
These choices persist under `bycoda.language.git` and
`bycoda.language.technical` and synchronize between windows.

The preference is stored under `bycoda.language` and synchronizes between
windows, including the quick composer. Language changes preserve mounted
sessions, terminal processes and composer drafts. A new language is activated
only after its bundled catalog loads; a failed load leaves the current language
available for retry. Application-owned Windows tray and macOS menu labels are
updated through `native_language_set`. macOS keybinding menu rebuilds reapply
the selected translations.

## Writing UI copy

Use `t("English source message")` for application-owned copy and `useLocale()`
in components that display it. Keep full sentences together. Interpolate
values through named slots: `t("Ask · {p0}", { p0: projectName })`. Values are
inserted once, kept verbatim, and rendered through React's normal escaping.
Use complete singular/plural messages rather than appending English suffixes.
Read `getLocale()` for Intl number/date formatting and include the locale in
memo dependencies when memoizing translated output.

Import the compatible `t`, `useLocale` and `getLocale` exports from
`shared/i18n/git` or `shared/i18n/technical` for those surfaces. Pass
`languageDomain="git"` or `languageDomain="technical"` to shared `Modal`
components so their close controls match the owning surface.

Module-level UI option metadata uses getters so a selected language is not
frozen during module evaluation. Settings search accepts both the translated
labels and their English source labels. Identifiers, enum values, paths,
commands, code examples, project/session names, user messages, generated agent
answers, release-note bodies and raw provider errors retain their original
content. Operating-system dialogs use the OS language.

## Catalog maintenance and checks

- `node scripts/i18n/check-locales.mjs --extract` adds newly referenced source copy.
- `python scripts/i18n/translate-ui.py` explicitly refreshes missing translations
  of public UI copy through Google's machine-translation endpoint. This is a
  development helper, requires network access, and is never run by the app.
  It keeps interpolation slots and resumes existing catalogs. No user data or
  credentials are included. The endpoint is not a supported production API.
- Turkish editorial corrections live in `src/shared/i18n/tr-overrides.json` and
  are applied by that helper after generation. Review new entries against their
  English source, including technical terms, action labels, product names,
  commands, paths and keyboard shortcuts. Other catalogs remain machine translations
  requiring editorial review before a public release.
- `node scripts/i18n/check-locales.mjs` validates source coverage, complete catalogs,
  nonempty translations, matching interpolation slots and preservation of the
  Turkish editorial corrections.
- `pnpm test src/shared/i18n/i18n.test.ts` checks persistence, system-language
  selection, window synchronization, interpolation, formatting and input state.
- `pnpm exec playwright test tests/browser/localization.spec.ts --project=chromium`
  checks the actual selector in all languages, Turkish search and narrow CJK UI.

Add explicit translations when authoring components and review catalog changes
before committing.

Source and browser validation do not establish installed desktop or macOS
acceptance. Use the documented local-update coordinator for a later authorized
build/install, then check native menu/tray labels on those machines.
