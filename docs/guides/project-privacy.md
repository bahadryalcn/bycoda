# Project group privacy

## Start in privacy mode

Enable **Settings → General → Workspace → Start in privacy mode**
to open new app windows with a privacy screen. The option is off by default and
applies on the next launch; changing it does not conceal an existing workspace.
The workspace and draft recovery notices stay unmounted until **Show workspace**
is selected. Quick composer and Git popup windows use the same screen.

If a lock password exists, continuing requires that password and uses the same
wrong-password cooldown as group locks. Cancel and Escape keep the screen closed.
**Forgot the password?** opens the existing explicit password-reset flow. Without
a password, continuing immediately reveals the workspace. Leaving this screen
does not unlock protected groups or reveal hidden groups, and does not disable
the next-launch preference. Every new window requires its own continuation.

This is a visibility screen, not encryption or an incognito session: saved
history remains intact and host work is not stopped by the screen.

## Hide and restore groups

Right-click a project group and choose **Hide group**. This removes its header,
projects, pinned shortcuts and activity from the app's visible project lists.
Search, task views and notification text use the same project visibility filter.
An open hidden project switches to a visible project or an empty session; its
sessions and running work are preserved.

To restore a group, open **Settings → Group privacy → Hidden groups**, or click
the eye icon beside Settings. The icon is always available and has no hidden
group count. Settings remains the recovery path if the icon is overlooked.

- **Show temporarily** reveals one group until the app restarts or all groups
  are locked. **Hide again** conceals it immediately.
- **Make visible** removes that group's saved hiding preference.
- If a lock password is set, group names and restoration controls require that
  password. Restoring one group never unlocks other groups, even with the
  unlock-all option enabled.

Hidden preferences belong to this device and persist across restarts. Other
windows follow visibility changes; temporary visibility is not saved to disk.
Hiding does not change group membership, delete data or stop agents. Password
recovery keeps hidden preferences; groups can then be restored from Settings.
This controls app visibility and does not encrypt files or transcripts on disk.
