import { useQuery } from "@tanstack/react-query";
import { createAppQueryClient } from "../../../shared/lib/queryClient";
import { localVoiceBackend } from "../model/localVoiceClient";

// Both settings and the composer observe one catalog and share in-flight requests.
const transcriptionCatalogClient = createAppQueryClient();

export function useTranscriptionModels(enabled: boolean) {
  return useQuery(
    {
      queryKey: ["voice-transcription-models", "openrouter"],
      enabled,
      queryFn: async () => {
        const available = await localVoiceBackend.transcriptionModels();
        if (!available.length) throw new Error("Empty transcription catalog");
        return available;
      },
      staleTime: 0,
      gcTime: 0,
      retry: false,
    },
    transcriptionCatalogClient,
  );
}
