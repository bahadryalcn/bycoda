import { dirname, join } from "node:path";
import {
  AssistantAvatarGenerateParamsSchema,
  AssistantAvatarReadParamsSchema,
  AssistantProfileInterviewParamsSchema,
} from "../../src/shared/model/host-contracts/assistant-builder";
import { generateAssistantAvatar, readAssistantAvatar } from "../assistant/builder/avatar";
import { runAssistantInterview } from "../assistant/builder/interview";
import { AssistantRepository } from "../assistant/repository";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

export async function handleAssistantBuilderRpc(
  dependencies: Pick<ServerBindings, "engine">,
  request: OwnerRpcRequest,
) {
  const store = dependencies.engine.store;
  // Generated avatars live beside the Host database, in persistent Host state.
  const directory = join(dirname(store.attachmentDir), "assistant", "avatars");
  switch (request.input.method) {
    case "assistant.builder.interview":
      request.result = await runAssistantInterview(
        AssistantProfileInterviewParamsSchema.parse(request.params),
      );
      break;
    case "assistant.builder.avatarGenerate":
      request.result = await generateAssistantAvatar(
        AssistantAvatarGenerateParamsSchema.parse(request.params),
        {
          directory,
          savedAvatar: async () =>
            (await new AssistantRepository(store).get<{ avatar?: string }>("profile", "profile"))
              ?.avatar,
        },
      );
      break;
    case "assistant.builder.avatarRead":
      request.result = await readAssistantAvatar(
        AssistantAvatarReadParamsSchema.parse(request.params).id,
        directory,
      );
      break;
    default:
      throw new Error("Unsupported host method");
  }
}
