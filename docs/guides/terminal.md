# Terminal appearance and reading tools

Terminals use the saved terminal font, size, weight and line spacing. These
preferences remain independent of the code editor. Ctrl+wheel changes the hovered
terminal's text size; ordinary wheel input continues to scroll. Open the terminal's
**Terminal pane actions** menu to adjust its current size with − / + or **Reset**
to the saved terminal size. Changing text size does not start another shell.

The dock keeps one header for creating, splitting, choosing profiles and hiding
terminals. **Terminal dock actions** applies to the dock. Each pane has compact
controls at its upper right, visible on hover or keyboard focus (always available
on touch). **Terminal pane actions** offers Scroll to bottom, Clear terminal and
text size for that pane. The terminal list and split panes retain their layout.

Ctrl/Cmd+F opens a compact **Find** overlay that searches the terminal buffer.
Escape closes Find and returns focus to the terminal. Next/previous actions and Enter/Shift+Enter
move between matches. The result indicator shows the current match and count when
the search addon supplies them, or a bounded-results notice for large result sets.
Searching does not send text to the shell. Selection and copying retain the original
terminal text.

Terminal colors follow the surrounding pane and shared appearance roles. Where the
pane's effective solid background can be resolved, the renderer applies its normal
text contrast correction to foreground glyphs. ANSI colors remain unchanged as
background colors, preserving their meaning in terminal applications. Dim text and
background-like drawing glyphs retain the renderer's separate treatment.

Selection uses the shared accent/background and readable foreground pair, including
when the terminal loses focus. The cursor follows the shared focus color and stops
blinking when reduced motion is requested. Image, filtered and native glass
backdrops require separate visual verification; a nominal contrast calculation
does not establish readability against those backgrounds or every colored cell.
