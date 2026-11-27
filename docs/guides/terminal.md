# Terminal appearance and reading tools

## Open a remote project terminal

Use **Terminal** in the project's footer to open an interactive shell in the
selected checkout on the project's machine. The dock supports new terminals and
splits. A machine with a saved SSH connection opens the shell over SSH and uses
the paired machine's SSH host key; Windows starts PowerShell, macOS and Linux
start the account's login shell. A machine paired only through a Host URL runs
the shell on its bycoda Host in that machine's default shell. Its output is read
from the Host about every second while idle and faster while you type or the
shell prints. Closing the terminal ends the shell on the Host.

## Run commands from chat

Completed PowerShell (`powershell`, `pwsh`, `ps1`) and POSIX shell (`bash`, `sh`,
`zsh`, `shell`) code blocks show **Run in terminal** (Play) beside the code-block
actions. The command runs in a matching installed shell on the conversation's
machine, using its working copy. It opens in the current project's terminal dock
and shows the command before the process produces output. Remote runs stream
output from the conversation's machine and show **Stop** and the exit code in
the dock. Conversations outside the open project use the terminal dialog.
If completion cannot be confirmed, the status remains unknown.
The output feed keeps its last lines during a brief connection interruption and
checks again in the background. If the interruption lasts, the terminal reports
that the command status is unknown.

When the command finishes, its bounded output is added to the original
conversation's composer. Turn this off in **Settings → Terminal → Code blocks**
(**Add result to chat when finished**); the dialog's checkbox starts from that
setting and **Add result to chat** attaches it by hand. Existing draft text stays
intact; review and send the result when ready. Adding a result does not
automatically send a message to the model. Long output includes only the latest
retained terminal output.

CMD/batch fences and other programming-language blocks do not show Play because
their quoting is not yet supported safely.

## Appearance and reading

Terminals use the saved terminal font, size, weight and line spacing. These
preferences remain independent of the code editor. Ctrl+wheel changes the hovered
terminal's text size; ordinary wheel input continues to scroll. Open the terminal's
**Terminal pane actions** menu to adjust its current size with − / + or **Reset**
to the saved terminal size. Changing text size does not start another shell.

The terminal list starts at the top of the dock, next to the toolbar above the
terminal output. The toolbar groups new terminal, profiles and split together. Find,
Command suggestions and **Terminal pane actions** follow the selected terminal.
The pane menu offers Scroll to bottom, Clear terminal and text size. **Move
Terminal** opens the dock position menu.

**Hide terminal** (the collapse-panel icon, Ctrl/Cmd+J outside a focused terminal, or
Ctrl+" on Turkish layouts) hides the dock and keeps every shell running. The X at
the right opens a dialog with **Cancel**, **Close active terminal**, **Close
others** and **Close all terminals**. Running processes still require confirmation.
Closing the last terminal also closes the panel.
Holding the toggle chord switches the dock once, not on every key repeat.

Switching projects dismisses the previous dock's menus so their actions cannot
target the newly selected project. If a native terminal close request fails, a
replacement using that terminal identity retries the old close request before
starting; a close error is not treated as a successful shutdown.

Host terminal history no longer consumes active-terminal slots after confirmed
exit. Recent output remains bounded; do not treat it as permanent storage.
If a mobile terminal close reports that exit is unconfirmed, keep its existing
terminal identity and check again after the process exits. A close request alone
does not prove the shell stopped. Hiding or detaching still leaves it running.

Ctrl/Cmd+F opens a compact **Find** overlay that searches the terminal buffer.
Escape closes Find and returns focus to the terminal. Next/previous actions and Enter/Shift+Enter
move between matches. The result indicator shows the current match and count when
the search addon supplies them, or a bounded-results notice for large result sets.
Searching does not send text to the shell. Selection and copying retain the original
terminal text.

IME candidate confirmation leaves Find and suggestion selection unchanged,
including WebKit's final composition key event. Shell editing shortcuts also
leave composition to the terminal input handler.

Shift+Insert and a plain right-click in the terminal paste text from this
computer's clipboard, including in SSH tabs under **Servers**. Pasting adds no
Enter keystroke. Multiline clipboard text keeps its line breaks and follows the
shell's bracketed-paste behavior. Terminal applications that request mouse
events continue to receive right-clicks.

While a terminal has focus, plain Ctrl+letter chords (Ctrl+W, D, T, N, B, P, O, J,
K and the rest) go to the shell instead of the app's default shortcuts. Ctrl+Shift
chords, Ctrl+Tab, Ctrl+Alt+arrows, zoom, full screen and Escape keep working.
Shortcuts you record in Keybindings can still run app commands while the terminal
has focus. Characters typed with macOS Option or AltGr take priority over
workspace shortcuts while you type in the terminal.

On macOS, Option types characters from the active keyboard layout, such as `@`
with Option+Q on Turkish Q. It also starts accent composition. Option acts as
terminal Meta when the key has no Option character. Option+Left and Option+Right
move by word.

Terminal colors follow the surrounding pane and shared appearance roles. Where the
pane's effective solid background can be resolved, the renderer applies its normal
text contrast correction to foreground glyphs. ANSI colors remain unchanged as
background colors, preserving their meaning in terminal applications. Dim text and
background-like drawing glyphs retain the renderer's separate treatment.

Selection uses the shared accent/background and readable foreground pair, including
when the terminal loses focus. The cursor uses the terminal text color and stops
blinking when reduced motion is requested. Image, filtered and native glass
backdrops require separate visual verification; a nominal contrast calculation
does not establish readability against those backgrounds or every colored cell.
