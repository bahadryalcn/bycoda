// A GUI-subsystem entry point avoids allocating a console before PowerShell can
// parse -WindowStyle Hidden. Task Scheduler's restart setting only retries a task
// that fails to start, not one whose process exits later, so the launcher itself
// restarts a host that exits with an error (like systemd Restart=on-failure).
// A graceful stop exits 0 and ends the task. BYCODA_LAUNCHER_RESTARTS limits the
// restarts (tests); the last child exit code is the task's result.
// Bump the launcher file name (service-launcher-vN.exe) whenever this source changes:
// an existing launcher is reused, never recompiled.
export const windowsServiceLauncherSource = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

internal static class BycodaServiceLauncher
{
    private static readonly int[] RestartDelaySeconds = { 2, 5, 15, 30, 60 };
    // A host that stayed up this long was healthy; start backing off again from the shortest delay.
    private static readonly TimeSpan HealthyRun = TimeSpan.FromMinutes(5);

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1) return 2;
            int limit;
            if (!int.TryParse(Environment.GetEnvironmentVariable("BYCODA_LAUNCHER_RESTARTS"), out limit) || limit < 0)
                limit = int.MaxValue;
            var failures = 0;
            for (var restarts = 0; ; restarts++)
            {
                var started = DateTime.UtcNow;
                var code = Run(args[0]);
                if (code == 0 || restarts >= limit) return code;
                failures = DateTime.UtcNow - started >= HealthyRun ? 0 : failures + 1;
                Thread.Sleep(TimeSpan.FromSeconds(
                    RestartDelaySeconds[Math.Min(Math.Max(failures - 1, 0), RestartDelaySeconds.Length - 1)]));
            }
        }
        catch
        {
            return 1;
        }
    }

    private static int Run(string command)
    {
        var start = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe"),
            Arguments = "-NoLogo -NoProfile -NonInteractive -EncodedCommand " + command,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        // A parent running PowerShell 7 may have incompatible module paths.
        start.EnvironmentVariables.Remove("PSModulePath");
        start.EnvironmentVariables.Remove("BYCODA_LAUNCHER_RESTARTS");
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
}
`;
