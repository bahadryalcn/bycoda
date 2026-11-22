# SSH command approval

## Full-access coding sessions

Owner decision, 2026-11-06: "If full permission already exists for these, do not ask again; there is no need to ask." (translated)

Saved-server SSH commands may skip repeated native command approval only when the Host verifies current full-access permission for the original coding session. Recheck before execution; a downgrade revokes the bypass. Other modes, Assistant Room, host-key trust, authentication and proxy credential gates retain their existing approval boundaries.

# SFTP sheet opens on the home directory

Owner decision, 2026-11-22: "Kendiliğinden yüklesin." (translated: "Let it load by itself.")

Opening the SFTP sheet for a server lists its home directory (`.`) once; there is no separate Open button, and the remote directory field navigates on Enter. Only the owner opening the sheet triggers this. Host-key, identity and proxy approvals, and download, upload and recovery approvals, are unchanged.
