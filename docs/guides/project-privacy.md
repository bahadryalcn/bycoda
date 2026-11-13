# Project group privacy

## Start in privacy mode

Enable **Settings > Privacy > Start in privacy mode**
to open new app windows with a privacy screen. The option is off by default and
applies on the next launch; changing it does not conceal an existing workspace.
If a choice applies only in this window because saving failed, its warning and
**Retry** remain visible when you return to Settings. Email masking follows the
same rule. A successful save is required for the next launch to use the new choice.
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

## Unavailable privacy settings

Unreadable or corrupt saved protection is not treated as a new installation.
The workspace and group names stay concealed; **Retry** only reads saved state.
It does not reset a password, overwrite damaged data, grant access or unlock groups.
After a successful read, leaving the privacy screen still requires **Show workspace**
and any existing password. Only an absent settings record enables first-use setup.

## System permissions

**Settings > Permissions** reads OS status without requesting access. **Allow**
explicitly requests OS access. **Review access…** opens the setup guide; its
**Open Settings** button opens the OS pane. **Check again** only rereads status.
Unknown or unavailable status never means access is allowed. Policy restrictions
may need an administrator. App and helper permissions remain separate facts.

On macOS, **Reveal bycoda in Finder** reveals the app. Drag the app from Finder
into the system permission list; the helper button itself is not a draggable app.
