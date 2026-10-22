# Antigravity CLI and legacy Gemini CLI

Google [announced the transition on June 18, 2026](https://github.com/google-gemini/gemini-cli/discussions/28017). Individual free, Google AI Pro and Ultra accounts use Antigravity CLI. Gemini CLI continues to support enterprise Gemini Code Assist licenses and supported API key authentication. These are separate binaries and protocols; renaming the Gemini adapter would break existing sessions.

## Install and authenticate

Use the [official installer and authentication instructions](https://antigravity.google/docs/cli/install/):

Windows PowerShell:

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

macOS / Linux:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Run `agy` in a terminal on the computer that executes sessions and complete the provider's browser sign-in. For an SSH host, follow the URL/code instructions in that host's terminal. In bycoda, use Settings → Providers → Accounts → Antigravity CLI account → Set up account → Check installation and models, then choose Antigravity in the model picker. Model discovery is not proof of account authentication.

## Account limitations

The Accounts section exposes the shared Antigravity CLI account and its setup instructions. It does not create named Antigravity profiles. The locally installed CLI's help has no account/profile selection command, and Google's [config-root feature request remains open](https://github.com/google-antigravity/antigravity-cli/issues/155). The native keyring sign-in is shared on the computer; changing only `HOME` is not sufficient proof of isolated credentials. Do not add Antigravity to bycoda's isolated-profile provider list until login, identity verification, credential isolation, cleanup and turn routing can all be validated.

To change the shared account manually, run `/logout` inside `agy` and sign in again. This changes the account used by other Antigravity sessions on that computer. bycoda does not automatically log out or modify keyring credentials from the setup panel.

For API key use, set `modelProvider` to `gemini` in `~/.gemini/antigravity-cli/settings.json` and supply `GEMINI_API_KEY` in the CLI process environment. The environment variable alone does not enable this mode. Keep credentials out of repository files.

The [official migration guide](https://antigravity.google/docs/cli/gcli-migration/) describes importing Gemini configuration. bycoda preserves existing Gemini session IDs, models and configured executable paths; it does not rewrite private CLI settings or credentials.

The desktop resolver supports the native `agy` binary on Windows, macOS and Linux, with the existing separate ACP server preferred when installed. The host's existing ACP integration remains separate; its credentials and availability must be checked on the host. CLI sign-in does not prove authentication of the separate ACP server.
