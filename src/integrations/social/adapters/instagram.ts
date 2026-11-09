import type { SocialAdapter, SocialHttp } from "../adapter";
import { createMetaAdapter } from "./meta-shared";

export function createInstagramAdapter(http: SocialHttp, graphVersion: string): SocialAdapter {
  return createMetaAdapter(http, graphVersion, "instagram");
}
