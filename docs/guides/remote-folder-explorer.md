# Open connected-machine folders in Explorer

Open the chat's remote folder browser from a connected folder link or its context menu. There are two ways to open the folder in the file manager on the computer running bycoda.

## Live folder access

Choose **Open live folder (read-only)** to browse the connected folder through the saved bycoda connection. Changes made on the connected computer appear in the live folder; the file manager cannot write through this connection. Access is limited to the selected folder inside an authorized project or worktree, including checks against symbolic links that leave that folder.

This uses the operating system's existing WebDAV client: WebClient on Windows, `mount_webdav` on macOS, or GIO/GVfs on Linux. bycoda does not install a client or change system services. If the client is unavailable, the error explains the missing prerequisite; configured shared folders and local file copies remain available. Native clients can impose their own file-size and caching limits.

The temporary connection stays on this computer's loopback interface and expires after inactivity or when the saved connection is removed or changed. It is also closed when bycoda exits. Reopen the action to create a new connection.

## Existing shared or mounted folders

Choose **Reveal in File Explorer** (Finder on macOS) to use an existing share or mount. This accesses the shared original with the permissions provided by that share.

On first use, enter the same folder's two addresses:

- Connected machine: for example `remote://<environment-id>/Users/dev/projects`.
- This computer: the share or mounted folder you already access, for example `\\MacBook\dev\projects` or `Z:\projects`. On macOS, use a mounted path such as `/Volumes/dev/projects`.

Use **Save and open**. bycoda remembers the mapping on this computer, applies it to children, and prefers the most specific matching folder. **Shared folder settings** allows changing a saved mapping. The connected folder must contain the folder currently being browsed.

Explorer opens on the computer running bycoda. An SSH connection alone does not create an SMB share or mount. Share access and authentication use the operating system's existing setup. Failed share access is shown in the folder browser; navigation inside bycoda continues to use the connected host.

For individual files, **Open local copy** downloads a snapshot. Editing that copy does not sync changes back. See [chat outputs and connected files](chat-artifacts-and-connected-files.md) for document, media, and development-server access.
