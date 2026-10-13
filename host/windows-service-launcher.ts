// A GUI-subsystem entry point avoids allocating a console before PowerShell can
// parse -WindowStyle Hidden. Keep the child attached to the task's lifetime and
// propagate its exit code so Task Scheduler's restart-on-failure still works.
// Bump the launcher file name (service-launcher-vN.exe) whenever this source changes:
// an existing launcher is reused, never recompiled.
export const windowsServiceLauncherSource = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class BycodaServiceLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1) return 2;
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoLogo -NoProfile -NonInteractive -EncodedCommand " + args[0],
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            // A parent running PowerShell 7 may have incompatible module paths.
            start.EnvironmentVariables.Remove("PSModulePath");
            using (var child = Process.Start(start))
            {
                child.StandardInput.Close();
                var stdout = child.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
                var stderr = child.StandardError.BaseStream.CopyToAsync(Stream.Null);
                child.WaitForExit();
                // Grandchildren (provider CLIs) can inherit these pipes and keep them
                // open; never let them keep the task alive after the host exits.
                Task.WaitAll(new Task[] { stdout, stderr }, 5000);
                return child.ExitCode;
            }
        }
        catch
        {
            return 1;
        }
    }
}
`;
