using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;

// Disposable AppContainer + Job Object experiment. No DataForge application code uses this.
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../windows-isolation-fixture"));
var expected = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../"));
if (Path.GetDirectoryName(root) != expected.TrimEnd(Path.DirectorySeparatorChar)) throw new Exception("fixture escaped experiment");
if (Directory.Exists(root) && (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new Exception("linked fixture refused");
Directory.CreateDirectory(root);
var source = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../target/debug/sql_boundary_prototype.exe"));
var worker = Path.Combine(root, "worker.exe");
var approved = Path.Combine(root, "approved.duckdb");
var privateFile = Path.Combine(root, "project.sqlite");
var scratch = Path.Combine(root, "scratch");
Directory.CreateDirectory(scratch);
var childMarker = Path.Combine(scratch, "child.pid");
if (File.Exists(childMarker)) File.Delete(childMarker);
File.Copy(source, worker, true);
var syntheticDb = Path.Combine(expected, "sql-boundary-fixture", "approved.duckdb");
if (!File.Exists(syntheticDb)) throw new Exception("run sql-boundary-proof.cjs first to create the synthetic database");
File.Copy(syntheticDb, approved, true);
File.WriteAllText(privateFile, "SYNTHETIC_PROJECT_DATA");
static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
var approvedHash = Hash(approved);
var projectHash = Hash(privateFile);
var moniker = "DataForgeSqlProof." + Guid.NewGuid().ToString("N");
IntPtr sid = IntPtr.Zero;
var hr = Native.CreateAppContainerProfile(moniker, moniker, "Disposable security proof", IntPtr.Zero, 0, out sid);
if (hr != 0) throw new Exception($"CreateAppContainerProfile 0x{hr:X8}");
var evidence = new List<object>();
var checks = new List<bool>();
try {
    if (!Native.ConvertSidToStringSidW(sid, out var sidStringPtr)) throw new Exception("SID conversion failed");
    var sidString = Marshal.PtrToStringUni(sidStringPtr)!;
    Native.LocalFree(sidStringPtr);
    Grant(root, sidString, "RX"); Grant(worker, sidString, "RX"); Grant(approved, sidString, "R"); Grant(scratch, sidString, "M");
    using var listener = new TcpListener(IPAddress.Loopback, 45678);
    listener.Start();
    var cases = new[] {
        ("approved_read", "read-file", approved, true),
        ("approved_db", "db-open", approved, true),
        ("approved_query", "db-query", approved, true),
        ("project_read", "read-file", privateFile, false),
        ("project_write", "write-file", privateFile, false),
        ("approved_write", "write-file", approved, false),
        ("network", "network", approved, false),
        ("job_allocation", "alloc-test", approved, false),
    };
    foreach (var (name, mode, target, shouldSucceed) in cases) {
        var before = File.ReadAllBytes(privateFile);
        var result = Launch(worker, mode, target, sid, 5000);
        var passed = result.Started && result.Exited && (result.ExitCode == 0) == shouldSucceed && before.SequenceEqual(File.ReadAllBytes(privateFile));
        checks.Add(passed);
        evidence.Add(new { name, passed, result.Started, result.Exited, result.ExitCode, result.Error });
        Console.WriteLine($"{name}: {(passed ? "PASS" : "FAIL")} started={result.Started} exited={result.Exited} exit={result.ExitCode} error={result.Error}");
    }
    var networkAccepted = listener.Pending();
    checks.Add(!networkAccepted);
    evidence.Add(new { name = "network_listener", passed = !networkAccepted, networkAccepted });
    using (var outsideNetwork = Process.Start(new ProcessStartInfo(source) { ArgumentList = { "network", approved }, UseShellExecute = false, CreateNoWindow = true }) ?? throw new Exception("network control launch failed")) {
        outsideNetwork.WaitForExit(5000);
        var controlConnected = outsideNetwork.HasExited && outsideNetwork.ExitCode == 0 && listener.Pending();
        checks.Add(controlConnected);
        evidence.Add(new { name = "network_control", passed = controlConnected });
        if (listener.Pending()) using (listener.AcceptTcpClient()) { }
        Console.WriteLine($"network_control: connected={controlConnected}");
    }
    listener.Stop();
    var unboundedJob = Launch(worker, "alloc-test", approved, sid, 5000, limitMemory: false);
    checks.Add(unboundedJob.Started && unboundedJob.Exited && unboundedJob.ExitCode == 0);
    evidence.Add(new { name = "appcontainer_allocation_control", passed = checks[^1], unboundedJob });
    Console.WriteLine($"appcontainer_allocation_control: exit={unboundedJob.ExitCode}");
    using (var outside = Process.Start(new ProcessStartInfo(source) { ArgumentList = { "alloc-test", approved }, UseShellExecute = false, CreateNoWindow = true }) ?? throw new Exception("outside allocation launch failed")) {
        outside.WaitForExit(5000);
        checks.Add(outside.HasExited && outside.ExitCode == 0);
        evidence.Add(new { name = "allocation_control", passed = outside.HasExited && outside.ExitCode == 0, exitCode = outside.ExitCode });
        Console.WriteLine($"allocation_control: exit={outside.ExitCode}");
    }
    var normalChild = Launch(worker, "spawn-child", childMarker, sid, 5000);
    checks.Add(normalChild.Started && normalChild.ExitCode == 0 && normalChild.ChildMember == true && normalChild.ChildExited == true);
    evidence.Add(new { name = "normal_child", passed = normalChild.Started && normalChild.ExitCode == 0 && normalChild.ChildMember == true && normalChild.ChildExited == true, normalChild });
    Console.WriteLine($"normal_child: member={normalChild.ChildMember} exitedAfterJobClose={normalChild.ChildExited} error={normalChild.Error}");
    if (File.Exists(childMarker)) File.Delete(childMarker);
    var breakaway = Launch(worker, "breakaway", childMarker, sid, 5000);
    checks.Add(breakaway.Started && breakaway.Exited && breakaway.ExitCode != 0 && !File.Exists(childMarker));
    evidence.Add(new { name = "breakaway", passed = breakaway.Started && breakaway.Exited && breakaway.ExitCode != 0 && !File.Exists(childMarker), breakaway });
    Console.WriteLine($"breakaway: exit={breakaway.ExitCode} childMember={breakaway.ChildMember} error={breakaway.Error}");
    var timeout = Launch(worker, "hold", approved, sid, 150);
    checks.Add(timeout.Started && timeout.Exited && timeout.TimedOut);
    evidence.Add(new { name = "timeout_cleanup", passed = timeout.Started && timeout.Exited && timeout.TimedOut, timeout.Started, timeout.Exited, timeout.TimedOut, timeout.Error });
    Console.WriteLine($"timeout_cleanup: started={timeout.Started} exited={timeout.Exited} timedOut={timeout.TimedOut}");
    var cancelled = Launch(worker, "hold", approved, sid, 150, cancelRequested: true);
    checks.Add(cancelled.Started && cancelled.Exited && cancelled.Cancelled);
    evidence.Add(new { name = "cancellation_cleanup", passed = cancelled.Started && cancelled.Exited && cancelled.Cancelled, cancelled });
    Console.WriteLine($"cancellation_cleanup: started={cancelled.Started} exited={cancelled.Exited} cancelled={cancelled.Cancelled}");
    var memory = Launch(worker, "memory", approved, sid, 5000);
    evidence.Add(new { name = "memory_limit", observed = memory });
    Console.WriteLine($"memory_limit: started={memory.Started} exited={memory.Exited} exit={memory.ExitCode} timedOut={memory.TimedOut}");
    checks.Add(approvedHash == Hash(approved) && projectHash == Hash(privateFile));
    evidence.Add(new { name = "fixture_hashes", passed = checks[^1] });
    File.WriteAllText(Path.Combine(root, "isolation-results.json"), JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));
    if (checks.Any(pass => !pass)) throw new Exception("one or more isolation assertions failed");
} finally {
    Native.LocalFree(sid);
    var deleted = Native.DeleteAppContainerProfile(moniker);
    Console.WriteLine($"profile_cleanup_hresult=0x{deleted:X8}");
}

static void Grant(string target, string sid, string rights) {
    using var proc = Process.Start(new ProcessStartInfo("icacls.exe") {
        ArgumentList = { target, "/grant", "*" + sid + ":(" + rights + ")" },
        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
    }) ?? throw new Exception("icacls launch failed");
    proc.WaitForExit();
    if (proc.ExitCode != 0) throw new Exception("icacls grant failed: " + proc.StandardError.ReadToEnd());
}

static Result Launch(string executable, string mode, string target, IntPtr sid, int timeoutMs, bool cancelRequested = false, bool limitMemory = true) {
    var job = Native.CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return new(false, false, false, -1, "create_job_" + Marshal.GetLastWin32Error());
    IntPtr attrs = IntPtr.Zero, capsPtr = IntPtr.Zero, envPtr = IntPtr.Zero;
    Native.ProcessInfo pi = default;
    var resumed = false;
    try {
        var limits = new Native.JobExtended { Basic = new Native.JobBasic { LimitFlags = (uint)(0x2000 | 0x8 | (limitMemory ? 0x100 | 0x200 : 0)), ActiveProcessLimit = 2 }, ProcessMemoryLimit = limitMemory ? (UIntPtr)(128UL * 1024 * 1024) : UIntPtr.Zero, JobMemoryLimit = limitMemory ? (UIntPtr)(192UL * 1024 * 1024) : UIntPtr.Zero };
        if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<Native.JobExtended>())) return new(false, false, false, -1, "set_job_" + Marshal.GetLastWin32Error());
        IntPtr size = IntPtr.Zero;
        Native.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        attrs = Marshal.AllocHGlobal(size);
        if (!Native.InitializeProcThreadAttributeList(attrs, 1, 0, ref size)) return new(false, false, false, -1, "init_attrs_" + Marshal.GetLastWin32Error());
        var caps = new Native.SecurityCapabilities { AppContainerSid = sid };
        capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf<Native.SecurityCapabilities>());
        Marshal.StructureToPtr(caps, capsPtr, false);
        if (!Native.UpdateProcThreadAttribute(attrs, 0, (IntPtr)0x00020009, capsPtr, (IntPtr)Marshal.SizeOf<Native.SecurityCapabilities>(), IntPtr.Zero, IntPtr.Zero)) return new(false, false, false, -1, "update_attrs_" + Marshal.GetLastWin32Error());
        var start = new Native.StartupInfoEx { StartupInfo = new Native.StartupInfo { cb = (uint)Marshal.SizeOf<Native.StartupInfoEx>() }, lpAttributeList = attrs };
        var cmd = new StringBuilder($"\"{executable}\" {mode} \"{target}\"");
        var systemRoot = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var user = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var temp = Path.GetTempPath().TrimEnd('\\');
        envPtr = Marshal.StringToHGlobalUni($"LOCALAPPDATA={local}\0SystemRoot={systemRoot}\0TEMP={temp}\0TMP={temp}\0USERPROFILE={user}\0windir={systemRoot}\0\0");
        if (!Native.CreateProcessW(executable, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00080000 | 0x00000004 | 0x08000000 | 0x00000400, envPtr, Path.GetDirectoryName(executable)!, ref start, out pi)) return new(false, false, false, -1, "create_process_" + Marshal.GetLastWin32Error());
        if (!Native.AssignProcessToJobObject(job, pi.hProcess)) return new(false, false, false, -1, "assign_job_" + Marshal.GetLastWin32Error());
        if (!Native.IsProcessInJob(pi.hProcess, job, out bool member) || !member) return new(false, false, false, -1, "not_in_job");
        if (Native.ResumeThread(pi.hThread) == uint.MaxValue) return new(false, false, false, -1, "resume_" + Marshal.GetLastWin32Error());
        resumed = true;
        if (cancelRequested) { Thread.Sleep(timeoutMs); Native.TerminateJobObject(job, 98); }
        var wait = Native.WaitForSingleObject(pi.hProcess, cancelRequested ? 5000u : (uint)timeoutMs);
        var timedOut = wait == 0x102;
        if (timedOut) Native.TerminateJobObject(job, 99);
        var exited = Native.WaitForSingleObject(pi.hProcess, 5000) == 0;
        Native.GetExitCodeProcess(pi.hProcess, out var exitCode);
        bool? childMember = null, childExited = null;
        if (mode == "spawn-child" || mode == "breakaway") {
            for (var i = 0; i < 100 && !File.Exists(target); i++) Thread.Sleep(10);
        }
        if ((mode == "spawn-child" || mode == "breakaway") && File.Exists(target)) {
            using var child = Process.GetProcessById(int.Parse(File.ReadAllText(target)));
            childMember = Native.IsProcessInJob(child.Handle, job, out bool childInJob) && childInJob;
            Native.CloseHandle(job); job = IntPtr.Zero;
            childExited = child.WaitForExit(5000);
            if (!childExited.Value) { child.Kill(); child.WaitForExit(5000); }
        }
        return new(true, exited, timedOut, (int)exitCode, null, childMember, childExited, cancelRequested);
    } finally {
        if (pi.hProcess != IntPtr.Zero && !resumed) { Native.TerminateProcess(pi.hProcess, 97); Native.WaitForSingleObject(pi.hProcess, 5000); }
        if (pi.hThread != IntPtr.Zero) Native.CloseHandle(pi.hThread);
        if (pi.hProcess != IntPtr.Zero) Native.CloseHandle(pi.hProcess);
        if (envPtr != IntPtr.Zero) Marshal.FreeHGlobal(envPtr);
        if (attrs != IntPtr.Zero) { Native.DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs); }
        if (capsPtr != IntPtr.Zero) Marshal.FreeHGlobal(capsPtr);
        if (job != IntPtr.Zero) Native.CloseHandle(job);
    }
}

record Result(bool Started, bool Exited, bool TimedOut, int ExitCode, string? Error, bool? ChildMember = null, bool? ChildExited = null, bool Cancelled = false);

static class Native {
    [StructLayout(LayoutKind.Sequential)] public struct JobBasic { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] public struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] public struct JobExtended { public JobBasic Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct StartupInfo { public uint cb; public string? lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] public struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] public struct SecurityCapabilities { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] public static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr value);
    [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateJobObjectW(IntPtr attrs, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref JobExtended data, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll")] public static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll")] public static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr handle);
}
