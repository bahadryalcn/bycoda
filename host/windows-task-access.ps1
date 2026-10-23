# Read-only access check against the caller's effective token, including UAC
# deny-only groups. Never repair a task's ACL automatically.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

public static class BycodaTaskAccess {
    [StructLayout(LayoutKind.Sequential)]
    private struct GenericMapping { public uint Read, Write, Execute, All; }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateToken(IntPtr token, int level, out IntPtr duplicate);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AccessCheck(byte[] descriptor, IntPtr token, uint desired,
        ref GenericMapping mapping, IntPtr privileges, ref uint length, out uint granted,
        [MarshalAs(UnmanagedType.Bool)] out bool allowed);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static bool CanDelete(string sddl) {
        var descriptor = new RawSecurityDescriptor(sddl);
        var bytes = new byte[descriptor.BinaryLength];
        descriptor.GetBinaryForm(bytes, 0);
        using (var identity = WindowsIdentity.GetCurrent()) {
            IntPtr token;
            if (!DuplicateToken(identity.Token, 2, out token))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var privileges = Marshal.AllocHGlobal(4096);
            try {
                // Task Scheduler uses file access rights in task descriptors.
                var mapping = new GenericMapping {
                    Read = 0x120089, Write = 0x120116, Execute = 0x1200a0, All = 0x1f01ff
                };
                uint length = 4096, granted;
                bool allowed;
                if (!AccessCheck(bytes, token, 0x10000, ref mapping, privileges,
                                 ref length, out granted, out allowed))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return allowed;
            } finally {
                Marshal.FreeHGlobal(privileges);
                CloseHandle(token);
            }
        }
    }
}
'@

function Assert-BycodaTaskRemovalAccess([string] $Name) {
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    try { $task = $scheduler.GetFolder('\').GetTask($Name) }
    catch {
        # Only a confirmed missing task is safe to skip.
        $cause = $_.Exception
        while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
        if ($cause.HResult -eq -2147024894) { return }
        throw
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $principal = $task.Definition.Principal.UserId
    if ($principal -notmatch '^S-1-') {
        $principal = ([Security.Principal.NTAccount]::new($principal)).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    if ($principal -ne $sid) { throw 'The existing Bycoda task belongs to a different user.' }
    if (-not [BycodaTaskAccess]::CanDelete($task.GetSecurityDescriptor(7))) {
        throw 'This Windows account cannot remove the bycoda Host scheduled task. Ask an administrator to repair this task for its owner, then retry. The running host has not been stopped.'
    }
}
