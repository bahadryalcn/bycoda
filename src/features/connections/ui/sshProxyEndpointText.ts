import { sshEndpointPreview } from "../model/sshEndpointReview";

/** One line for an HTTP(S) CONNECT proxy upstream, such as "HTTP CONNECT: proxy.example:3128". */
export function sshProxyEndpointText(proxy: {
  host: string;
  port: number;
  scheme?: "http" | "https";
}): string {
  return `${proxy.scheme === "https" ? "HTTPS" : "HTTP"} CONNECT: ${sshEndpointPreview(proxy)}`;
}
