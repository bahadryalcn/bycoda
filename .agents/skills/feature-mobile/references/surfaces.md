# Mobile entry map

All code paths are repository-root relative; mobile/ has its own Git identity and local rules. Re-enumerate exported routes and actual adapters before a broad change.

- `mobile/AGENTS.md`, `mobile/package.json` and local artifact rules: platform workflow, pinned tooling and check commands.
- `mobile/app/`: Expo route/layout exports, with `(tabs)`, project, session, manage, tools and legal route groups. Follow imported screen components rather than treating wrappers as complete surfaces; include pairing/onboarding when affected.
- `mobile/src/ui/panelui.ts` owns the shared PanelUI facade; `mobile/src/` owns platform theme, persistence and domain features. Keep one scroll owner and safe-area/keyboard treatment through nested layouts.
- `mobile/src/api/hostClient.ts`, `mobile/src/api/transport.ts`, `mobile/src/domain/sessionSync.ts`, `mobile/src/domain/session-authority.ts`, `mobile/src/domain/approval-command.ts`: active transport, sync, source authority and approval identity. Compatibility workspace producers still need separate caller inspection.
- `mobile/src/features/workspace/`: conversation state, composer, transcript, tool previews and active Host transport producers. Search `use-composer-catalog`, `transcript-tool-preview`, `transcript-block` and actual approval producers when changing those features.
- Host/mobile RPC families are defined by the active client and Host schema, not this map. Search exact `sessions`, `workspace.run`, `projects`, `models`, `tasks`, `goals`, `crews`, `notes`, `inbox`, `browser`, `devices`, `logs` and development-server call sites only as relevant; inspect compatibility paths as separate producers.
- Desktop pairing/access wiring: `src/features/connections/`, native remote/local-Host adapters in `src-tauri/src/`, corresponding authenticated handlers in `host/`. Follow the existing credential owner instead of putting bearer material in renderer state.
- Native mobile inline-render capability, SSH/PTY and external session-link launch are distinct from desktop implementations; inspect actual platform support before offering controls.
- Locate locale catalogs and tests from `mobile/package.json` and `mobile/src/`; search affected visible labels, operation names and translated state copy. Run normal nested typecheck plus focused affected suites, then the appropriate simulator/physical-device/live-Host scenarios.

For cross-platform authority, refer to repository-root `docs/reference/host-runtime.md`; for workspace identity and capability gates, `docs/reference/managed-workspaces.md`. Prior route counts, captured external HEADs and old read-only grants are historical evidence, not current capabilities or authorization.
