using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

if (args.Length < 4) { Console.Error.WriteLine("usage: host|recover BASE PYTHON WORKER [normal|descendant|breakaway]"); return 2; }
var mode = args[0]; var baseDir = Path.GetFullPath(args[1]); var python = Path.GetFullPath(args[2]); var worker = Path.GetFullPath(args[3]);
Directory.CreateDirectory(baseDir);
var manifestPath = Path.Combine(baseDir, "ownership.json");
try {
    if (mode == "host") return Host(baseDir, python, worker, args.Length > 4 ? args[4] : "normal", manifestPath);
    if (mode == "recover") return Recover(baseDir, python, manifestPath);
    return 2;
} catch (Exception ex) { Console.Error.WriteLine(ex.GetType().Name + ": " + ex.Message); return 3; }

static int Host(string baseDir, string python, string worker, string workerMode, string manifestPath) {
    var session = Guid.NewGuid().ToString("N");
    var job = Win.CreateJobObjectW(IntPtr.Zero, null); // Unnamed: replacement must not keep an old job handle alive.
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject: " + Marshal.GetLastWin32Error());
    var limits = new Win.JobExtended { Basic = new Win.JobBasic { LimitFlags = 0x2000 } }; // KILL_ON_JOB_CLOSE only; no breakaway.
    if (!Win.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<Win.JobExtended>()))
        throw new Exception("SetInformationJobObject: " + Marshal.GetLastWin32Error());
    var si = new Win.StartupInfo { cb = (uint)Marshal.SizeOf<Win.StartupInfo>() };
    var cmd = new StringBuilder($"\"{python}\" \"{worker}\" \"{baseDir}\" {workerMode} {job.ToInt64()}");
    // No inherited handles or credential-bearing environment. Python imports from its own venv.
    var envText = "SystemRoot=" + Environment.GetEnvironmentVariable("SystemRoot") + "\0TEMP=" + Path.GetTempPath().TrimEnd('\\') + "\0\0";
    var envPtr = Marshal.StringToHGlobalUni(envText);
    Win.ProcessInfo pi;
    try {
        if (!Win.CreateProcessW(python, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000004 | 0x08000000 | 0x00000400,
                                envPtr, baseDir, ref si, out pi))
            throw new Exception("CreateProcess suspended: " + Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(envPtr); }
    try {
        if (!Win.AssignProcessToJobObject(job, pi.hProcess)) {
            Win.TerminateProcess(pi.hProcess, 99);
            throw new Exception("AssignProcessToJobObject: " + Marshal.GetLastWin32Error());
        }
        if (!Win.IsProcessInJob(pi.hProcess, job, out bool member) || !member) throw new Exception("worker not in job");
        var hostId = Id(Process.GetCurrentProcess());
        var workerId = Id(Process.GetProcessById((int)pi.dwProcessId));
        var record = new Ownership(session, hostId, workerId, null, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        Save(manifestPath, record); // Persist identity before a suspended worker can mutate.
        if (Win.ResumeThread(pi.hThread) == uint.MaxValue) throw new Exception("ResumeThread: " + Marshal.GetLastWin32Error());
        WaitFile(Path.Combine(baseDir, "worker_ready"), 8000);
        var childPidPath = Path.Combine(baseDir, "descendant.pid");
        if (File.Exists(childPidPath)) {
            var childPid = int.Parse(File.ReadAllText(childPidPath));
            using var child = Process.GetProcessById(childPid);
            var childId = Id(child);
            if (!Win.IsProcessInJob(child.Handle, job, out bool childMember)) throw new Exception("child job query failed: " + Marshal.GetLastWin32Error());
            File.WriteAllText(Path.Combine(baseDir, "child_in_job.txt"), childMember ? "1" : "0");
            record = record with { Descendant = childId };
            Save(manifestPath, record);
        }
        Console.WriteLine(JsonSerializer.Serialize(new { event_name="worker_ready", session, host=hostId, worker=workerId, descendant=record.Descendant, utc_ms=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
        Console.Out.Flush();
        while (!File.Exists(Path.Combine(baseDir, "stop"))) Thread.Sleep(20);
        using (var p=Process.GetProcessById(workerId.Pid)) if (!p.WaitForExit(8000)) throw new Exception("worker did not stop");
        Console.WriteLine(JsonSerializer.Serialize(new { event_name="clean_exit", utc_ms=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
        return 0;
    } finally { Win.CloseHandle(pi.hThread); Win.CloseHandle(pi.hProcess); Win.CloseHandle(job); }
}
static int Recover(string baseDir, string python, string manifestPath) {
    if (!File.Exists(manifestPath)) { Console.Error.WriteLine("missing ownership manifest; recovery blocked"); return 4; }
    var rec = JsonSerializer.Deserialize<Ownership>(File.ReadAllText(manifestPath)) ?? throw new Exception("bad manifest");
    Console.WriteLine(JsonSerializer.Serialize(new { event_name="recovery_wait", utc_ms=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), rec.Session })); Console.Out.Flush();
    // Wait on process handles with creation-time identity, never PID alone or a fixed delay.
    foreach (var id in new[] { rec.Host, rec.Worker, rec.Descendant }.Where(x => x is not null)) {
        if (!WaitExited(id!, 15000)) { Console.Error.WriteLine("ownership process still alive or identity uncertain; recovery blocked"); return 5; }
    }
    using var check = Process.Start(new ProcessStartInfo(python) {
        ArgumentList={Path.Combine(AppContext.BaseDirectory,"storage_check.py"),baseDir},
        UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true
    }) ?? throw new Exception("storage check launch failed");
    if (!check.WaitForExit(5000) || check.ExitCode != 0) { Console.Error.WriteLine("exclusive DuckDB access unavailable; recovery blocked"); return 6; }
    var count=check.StandardOutput.ReadToEnd().Trim();
    Console.WriteLine(JsonSerializer.Serialize(new { event_name="recovery_start", utc_ms=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), worker=rec.Worker, descendant=rec.Descendant, rows=count }));
    return 0;
}
static bool WaitExited(ProcessId id, int timeoutMs) {
    try { using var p=Process.GetProcessById(id.Pid);
        if (p.StartTime.ToUniversalTime().Ticks != id.StartTicks) return false; // PID reuse or ambiguous identity.
        return p.WaitForExit(timeoutMs);
    } catch (ArgumentException) { return true; } // No process at that PID.
}
static ProcessId Id(Process p) => new(p.Id,p.StartTime.ToUniversalTime().Ticks);
static void Save(string path, Ownership rec) { using var s=new FileStream(path,FileMode.Create,FileAccess.Write,FileShare.None);JsonSerializer.Serialize(s,rec);s.Flush(true); }
static void WaitFile(string path,int timeout) { var t=Stopwatch.StartNew();while (!File.Exists(path)) {if (t.ElapsedMilliseconds>timeout) throw new Exception("worker startup timeout");Thread.Sleep(10);} }
record ProcessId(int Pid,long StartTicks);
record Ownership(string Session,ProcessId Host,ProcessId Worker,ProcessId? Descendant,long CreatedUtcMs);

static class Win {
    [StructLayout(LayoutKind.Sequential)] public struct JobBasic {public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
    [StructLayout(LayoutKind.Sequential)] public struct IoCounters {public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
    [StructLayout(LayoutKind.Sequential)] public struct JobExtended {public JobBasic Basic;public IoCounters Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct StartupInfo {public uint cb;public string? lpReserved,lpDesktop,lpTitle;public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;public ushort wShowWindow,cbReserved2;public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;}
    [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo {public IntPtr hProcess,hThread;public uint dwProcessId,dwThreadId;}
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObjectW(IntPtr attributes,string? name);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool SetInformationJobObject(IntPtr job,int info,ref JobExtended data,uint length);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,[MarshalAs(UnmanagedType.Bool)]bool inherit,uint flags,IntPtr environment,string currentDirectory,ref StartupInfo startup,out ProcessInfo process);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool IsProcessInJob(IntPtr process,IntPtr job,[MarshalAs(UnmanagedType.Bool)]out bool result);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr handle);
}
