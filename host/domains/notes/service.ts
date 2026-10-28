import * as dto from "../../../src/shared/model/host-contracts/notes";
import { assertDomainAuthority, HostDomainOutcomeError, type HostDomainContext } from "../context";

export interface HostNotesServicePorts {
  session(id: string): Promise<{ projectId: string; session: { id: string } }>;
  project(id: string): Promise<{ cwd: string }>;
  notes: {
    list(cwd?: string, sessionId?: string): Promise<dto.HostNotesList>;
    get(id: unknown): Promise<dto.HostNote | null>;
    save(
      note: unknown,
      expectedUpdatedAt: unknown,
      cwd: undefined,
      authorize: () => Promise<boolean>,
    ): Promise<dto.HostNote>;
    delete(
      id: unknown,
      expectedUpdatedAt: unknown,
      cwd: undefined,
      authorize: () => Promise<boolean>,
    ): Promise<{ deleted: boolean }>;
  };
}
type Options = { legacy?: boolean };
export function createHostNotesService(ports: HostNotesServicePorts) {
  const authorize = (context: HostDomainContext) => async () => {
    await assertDomainAuthority(context);
    return true;
  };
  async function sessionScope(params: { sessionId?: string; projectId?: string }) {
    if (params.sessionId === undefined) return undefined;
    const session = await ports.session(params.sessionId);
    if (params.projectId !== undefined && session.projectId !== params.projectId)
      throw new Error("Session belongs to another project.");
    return session;
  }
  return {
    async list(
      raw: unknown,
      context: HostDomainContext,
      options: Options = {},
    ): Promise<dto.HostNotesList> {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? dto.NotesListParamsSchema.strip() : dto.NotesListParamsSchema
      ).parse(raw);
      const session = await sessionScope(params);
      const cwd =
        !session && params.projectId !== undefined
          ? (await ports.project(params.projectId)).cwd
          : undefined;
      await assertDomainAuthority(context);
      const result = await ports.notes.list(cwd, session?.session.id);
      await assertDomainAuthority(context);
      return result;
    },
    async get(
      raw: unknown,
      context: HostDomainContext,
      options: Options = {},
    ): Promise<dto.HostNote | null> {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? dto.NotesGetParamsSchema.strip() : dto.NotesGetParamsSchema
      ).parse(raw);
      const session = await sessionScope(params);
      await assertDomainAuthority(context);
      const result = await ports.notes.get(params.id);
      await assertDomainAuthority(context);
      if (session && result && result.sourceSessionId !== session.session.id)
        throw new Error("Note belongs to another session.");
      return result;
    },
    async upsert(
      raw: unknown,
      context: HostDomainContext,
      options: Options = {},
    ): Promise<dto.HostNote> {
      await assertDomainAuthority(context);
      const schema = options.legacy
        ? dto.NotesUpsertParamsSchema.extend({ note: dto.HostNoteUpsertSchema.strip() }).strip()
        : dto.NotesUpsertParamsSchema;
      const params = schema.parse(raw);
      const result = await ports.notes.save(
        params.note,
        params.expectedUpdatedAt,
        undefined,
        authorize(context),
      );
      await assertDomainAuthority(context);
      return result;
    },
    async delete(
      raw: unknown,
      context: HostDomainContext,
      options: Options = {},
    ): Promise<{ deleted: true }> {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? dto.NotesDeleteParamsSchema.strip() : dto.NotesDeleteParamsSchema
      ).parse(raw);
      let result;
      try {
        result = await ports.notes.delete(
          params.id,
          params.expectedUpdatedAt,
          undefined,
          authorize(context),
        );
      } catch (cause) {
        if (
          cause instanceof Error &&
          "code" in cause && cause.code === "NOTES_DELETE_NOTIFICATION_FAILED" &&
          "committed" in cause && cause.committed === true
        ) {
          throw new HostDomainOutcomeError(
            "The note was deleted, but its update notification failed. Refresh before continuing.",
            "accepted",
            { cause },
          );
        }
        throw cause;
      }
      await assertDomainAuthority(context);
      return dto.NotesDeleteResultSchema.parse(result);
    },
  };
}
