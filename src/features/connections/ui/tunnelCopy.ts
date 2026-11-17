import type { TunnelProvider } from "../../../integrations/external-tunnels";
import type { TunnelUiIssue } from "../model/externalTunnelController";

export const issueCopy: Record<TunnelUiIssue, string> = {
  "cli-missing":
    "The tunnel CLI is missing on this computer. Install the selected provider and check again.",
  "credential-missing": "ngrok needs a valid authtoken. Save one for this computer and try again.",
  "credential-store-unavailable":
    "The secure credential store is unavailable. Unlock it on this computer and try again.",
  "invalid-target": "Enter a loopback HTTP or HTTPS URL, or a port from 1 to 65535.",
  "host-target-required": "This is the bycoda host port. Select bycoda host access to share it.",
  "origin-unreachable":
    "The local service is not listening on this computer. Start it or check the URL and port.",
  "connection-failed":
    "The tunnel provider could not connect. Check this computer's internet connection and provider account.",
  "startup-timeout": "The tunnel did not connect in time. Check the network and try again.",
  "unexpected-exit":
    "The tunnel process closed unexpectedly. Its public URL is no longer available. Start a new tunnel.",
  "process-error": "The tunnel process could not start. Check the provider CLI on this computer.",
  "stop-failed": "The tunnel process did not stop. Retry stopping it on this computer.",
  "host-restarted":
    "The host restarted. This previous tunnel is interrupted. Start a new tunnel to get a new URL.",
  "storage-unavailable":
    "Tunnel state could not be read or saved. Check the host's data directory permissions.",
  "host-update": "Update bycoda Host on this computer to manage external tunnels.",
  connection: "The selected computer could not be reached. Reconnect it and check again.",
  "invalid-response":
    "The host returned an invalid tunnel status. Check the selected computer and update its host.",
};

export const stateCopy = {
  starting: "Starting",
  ready: "Connected",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
  interrupted: "Interrupted",
};

export const providerName = (provider: TunnelProvider) =>
  provider === "ngrok" ? "ngrok" : "Cloudflare";
