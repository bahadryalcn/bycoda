import { ProjectMascot } from "../../projects/ui/ProjectMascot";

/** A quiet shared-work illustration for an empty workspace. */
export function SessionsEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <div className="grid size-20 place-items-center rounded-2xl border border-accent/20 bg-accent/5">
        <ProjectMascot project="workspace" name="bridge" className="size-10 text-accent/70" />
      </div>
      <p className="max-w-sm text-[13px] leading-relaxed text-content/60">{message}</p>
    </div>
  );
}
