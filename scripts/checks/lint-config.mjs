/**
 * The `lint` and `fmt` blocks of vite.config.ts (Vite+: `vp lint`, `vp fmt`). They live in their
 * own module so the check scripts (rule-index.mjs, check-invariants.mjs,
 * check-host-contracts.mjs) read the same objects Vite+ runs with.
 */

/** Formatter options. */
export const fmt = {
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  endOfLine: "lf",
  sortImports: false,
  sortPackageJson: false,
  sortTailwindcss: false,
  ignorePatterns: [
    "vendor/**",
    "scripts/checks/ui-reviewed-baseline.json",
    "src/styles/palette.css",
    "docs/reference/ui-components.md",
    "docs/reference/rules.md",
  ],
};

/** Lint rules. A rule set to "error" is a code invariant; a rule set to "warn" is lint debt. */
export const lint = {
  categories: {
    correctness: "warn",
  },
  plugins: ["unicorn", "typescript", "oxc", "react", "jsx-a11y"],
  jsPlugins: [
    {
      name: "react-hooks-js",
      specifier: "eslint-plugin-react-hooks",
    },
    {
      name: "bycoda",
      specifier: "./scripts/checks/oxlint-plugin/index.mjs",
    },
  ],
  ignorePatterns: ["vendor/**", "temp/**", "node_modules/**", "build/**", "dist/**"],
  rules: {
    "react/refs": "off",
    "react/globals": "off",
    "react/set-state-in-effect": "off",
    "react/immutability": "off",
    "react/no-children-prop": "off",
    "react/purity": "off",
    "react/preserve-manual-memoization": "off",
    "react/incompatible-library": "off",
    "react/error-boundaries": "off",
    "jsx-a11y/prefer-tag-over-role": "off",
    "jsx-a11y/no-autofocus": "off",
    "jsx-a11y/interactive-supports-focus": "off",
    "jsx-a11y/control-has-associated-label": "off",
    "jsx-a11y/no-interactive-element-to-noninteractive-role": "off",
    "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
    "jsx-a11y/media-has-caption": "off",
    "jsx-a11y/mouse-events-have-key-events": "off",
    "jsx-a11y/anchor-has-content": "off",
  },
  overrides: [
    {
      files: ["src/**"],
      rules: {
        "react-hooks-js/static-components": "warn",
        "react-hooks-js/use-memo": "warn",
        "react-hooks-js/preserve-manual-memoization": "warn",
        "react-hooks-js/incompatible-library": "warn",
        "react-hooks-js/immutability": "warn",
        "react-hooks-js/globals": "warn",
        "react-hooks-js/refs": "off",
        "react-hooks-js/error-boundaries": "warn",
        "react-hooks-js/purity": "warn",
        "react-hooks-js/set-state-in-render": "warn",
        "react-hooks-js/unsupported-syntax": "warn",
        "react-hooks-js/config": "warn",
        "react-hooks-js/gating": "warn",
        "react/rules-of-hooks": "warn",
        "react/exhaustive-deps": "warn",
      },
    },
    {
      files: [
        "src/shared/ui/**",
        "src/features/sessions/ui/**",
        "src/features/sync/**",
        "src/features/terminal/**",
        "src/features/projects/**",
        "src/features/notifications/**",
        "src/app/shell/**",
      ],
      rules: {
        "react-hooks-js/refs": "warn",
      },
    },
    {
      files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/test-support/**"],
      rules: {
        "react-hooks-js/globals": "off",
      },
    },
    {
      files: ["src/**", "host/**", "packages/**"],
      rules: {
        "bycoda/safe-timestamp-render": "error",
        "bycoda/shared-formatters-only": "error",
        "bycoda/whole-sentence-translation": "error",
        "bycoda/utf8-child-locale": "error",
        "bycoda/app-locale-formatting": "error",
        "bycoda/shared-resize-observer": "error",
        "bycoda/compiler-stays-on": "error",
        "bycoda/effect-names-its-sync": "error",
        "bycoda/compiler-owns-memo": "error",
        "bycoda/suppression-has-reason": "error",
        "bycoda/grapheme-safe-truncate": "error",
        "bycoda/handled-background-promise": "error",
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@tauri-apps/api/event",
                importNames: ["listen", "once"],
                message:
                  "A plain listen() receives events that Rust targeted at one window (Tauri 2 matches an `Any` listener against every emit_to). Use listenWindow() / onceWindow() from src/platform/tauri/listenWindow.ts, or pass { target: label } explicitly.",
              },
              {
                name: "@tauri-apps/plugin-opener",
                importNames: ["openUrl"],
                message:
                  "Open external links through openExternal() in src/platform/tauri/openExternal.ts so the URL scheme is validated once and every surface behaves the same.",
              },
              {
                name: "framer-motion",
                message:
                  "Feature code uses the shared motion adapters in src/shared/ui and the motion tokens; do not import a motion library directly.",
              },
              {
                name: "motion/react",
                message:
                  "Feature code uses the shared motion adapters in src/shared/ui and the motion tokens; do not import a motion library directly.",
              },
            ],
          },
        ],
        "no-restricted-globals": [
          "error",
          {
            name: "alert",
            message:
              "Native dialogs block the webview and bypass theming and i18n. Use useConfirm()/ConfirmDialog for decisions and InlineError/Alert/Toast for messages (src/shared/ui).",
          },
          {
            name: "confirm",
            message:
              "Native dialogs block the webview and bypass theming and i18n. Use useConfirm()/ConfirmDialog (src/shared/ui/ConfirmDialog.tsx).",
          },
          {
            name: "prompt",
            message:
              "Native dialogs block the webview and bypass theming and i18n. Use a Modal with a TextField (src/shared/ui).",
          },
        ],
        "no-restricted-properties": [
          "error",
          {
            object: "window",
            property: "alert",
            message:
              "Native dialogs block the webview and bypass theming and i18n. Use InlineError/Alert/Toast from src/shared/ui.",
          },
          {
            object: "window",
            property: "confirm",
            message:
              "Native dialogs block the webview and bypass theming and i18n. Use useConfirm()/ConfirmDialog from src/shared/ui/ConfirmDialog.tsx.",
          },
          {
            object: "window",
            property: "prompt",
            message:
              "Native dialogs block the webview and bypass theming and i18n. Use a Modal with a TextField from src/shared/ui.",
          },
          {
            object: "window",
            property: "open",
            message:
              "window.open is not routed through the desktop opener. Use openExternal() from src/platform/tauri/openExternal.ts.",
          },
        ],
        "react/no-danger": "error",
        "jsx-a11y/alt-text": "error",
        "jsx-a11y/anchor-is-valid": "error",
        "jsx-a11y/aria-props": "error",
        "jsx-a11y/aria-role": "error",
        "jsx-a11y/aria-unsupported-elements": "error",
        "jsx-a11y/click-events-have-key-events": "error",
        "jsx-a11y/no-static-element-interactions": "error",
        "jsx-a11y/no-noninteractive-element-interactions": "error",
        "jsx-a11y/no-noninteractive-tabindex": "error",
        "jsx-a11y/role-has-required-aria-props": "error",
        "jsx-a11y/role-supports-aria-props": "error",
        "jsx-a11y/tabindex-no-positive": "error",
        "jsx-a11y/label-has-associated-control": "error",
        "jsx-a11y/no-redundant-roles": "error",
      },
    },
    {
      files: ["src/platform/tauri/listenWindow.ts", "src/platform/tauri/openExternal.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
    {
      files: ["src/shared/ui/**", "src/platform/**"],
      rules: {
        "no-restricted-globals": "off",
        "no-restricted-imports": "off",
      },
    },
    {
      files: [
        "src/features/files/ui/FileTypeIcon.tsx",
        "src/features/sessions/ui/AgentMarkdown.tsx",
      ],
      rules: {
        "react/no-danger": "off",
      },
    },
    {
      files: ["src/app/**/*.tsx", "src/features/**/*.tsx"],
      rules: {
        "no-console": [
          "error",
          {
            allow: ["warn", "error"],
          },
        ],
      },
    },
    {
      files: ["host/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "node:fs",
                importNames: ["writeFileSync", "writeFile"],
                message:
                  "State files written in place are truncated to zero bytes by a crash mid-write. Use writeFileAtomic() / readStateFile() from host/storage/atomic-write.ts for anything the Host reads back at startup. Streaming logs and scratch files may use fs/promises writeFile with an `// oxlint-disable-next-line no-restricted-imports -- <why>` comment.",
              },
              {
                name: "node:fs/promises",
                importNames: ["writeFile"],
                message:
                  "State files written in place are truncated to zero bytes by a crash mid-write. Use writeFileAtomic() / readStateFile() from host/storage/atomic-write.ts for anything the Host reads back at startup.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["host/storage/atomic-write.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
    {
      files: [
        "host/automations/automations.ts",
        "host/stewards/stewards.ts",
        "host/sessions/sessionRuns.ts",
        "host/tasks/task-budgets.ts",
        "host/social/social-schedule.ts",
        "host/social/social-program-schedule.ts",
        "host/**/*schedul*.ts",
        "host/**/*budget*.ts",
        "host/**/*watchdog*.ts",
        "src/features/automations/model/**",
        "src/app/workspace/bridges/useAutomationLaunch.ts",
      ],
      rules: {
        "no-restricted-properties": [
          "error",
          {
            object: "Date",
            property: "now",
            message:
              "Run time limits and schedule gaps must not count time the machine spent asleep; Date.now() jumps across sleep and clock changes. Use monotonicNow()/elapsedSince() from src/shared/lib/time/timestamps.ts (or the Host clock port) for durations; Date.now() stays for persisted timestamps only, with an `// oxlint-disable-next-line no-restricted-properties -- timestamp` comment.",
          },
        ],
      },
    },
    {
      files: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.test.mjs",
        "**/test-support/**",
        "tests/**",
        "evals/**",
        "scripts/**",
      ],
      rules: {
        "bycoda/safe-timestamp-render": "off",
        "bycoda/shared-formatters-only": "off",
        "bycoda/whole-sentence-translation": "off",
        "bycoda/utf8-child-locale": "off",
        "bycoda/app-locale-formatting": "off",
        "bycoda/shared-resize-observer": "off",
        "bycoda/compiler-stays-on": "off",
        "bycoda/effect-names-its-sync": "off",
        "bycoda/compiler-owns-memo": "off",
        "bycoda/suppression-has-reason": "off",
        "bycoda/grapheme-safe-truncate": "off",
        "bycoda/handled-background-promise": "off",
        "no-restricted-imports": "off",
        "no-restricted-globals": "off",
        "no-restricted-properties": "off",
        "react/no-danger": "off",
        "jsx-a11y/alt-text": "off",
        "jsx-a11y/anchor-is-valid": "off",
        "jsx-a11y/aria-props": "off",
        "jsx-a11y/aria-role": "off",
        "jsx-a11y/aria-unsupported-elements": "off",
        "jsx-a11y/click-events-have-key-events": "off",
        "jsx-a11y/no-static-element-interactions": "off",
        "jsx-a11y/no-noninteractive-element-interactions": "off",
        "jsx-a11y/no-noninteractive-tabindex": "off",
        "jsx-a11y/role-has-required-aria-props": "off",
        "jsx-a11y/role-supports-aria-props": "off",
        "jsx-a11y/tabindex-no-positive": "off",
        "jsx-a11y/label-has-associated-control": "off",
        "jsx-a11y/no-redundant-roles": "off",
        "no-console": "off",
      },
    },
  ],
};
