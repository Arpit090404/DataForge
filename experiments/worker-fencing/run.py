"""Disposable Windows Job Object fencing matrix; only synthetic files under runs/."""
import ctypes
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parent
APP = ROOT / 'bin' / 'Release' / 'net10.0-windows' / 'WorkerFencing.exe'
WORKER = ROOT / 'worker.py'
RUNS = ROOT / 'runs' / 'matrix'
RESULTS = ROOT / 'results.json'
if RUNS.exists():
    assert RUNS.resolve().is_relative_to((ROOT / 'runs').resolve())
    shutil.rmtree(RUNS)
RUNS.mkdir(parents=True)

def exited(pid, wait_ms=5000):
    k = ctypes.windll.kernel32
    k.OpenProcess.argtypes = (ctypes.c_uint, ctypes.c_int, ctypes.c_uint)
    k.OpenProcess.restype = ctypes.c_void_p
    h = k.OpenProcess(0x100000, 0, pid)
    if not h:
        return k.GetLastError() == 87 # ERROR_INVALID_PARAMETER: PID no longer exists.
    try:
        return k.WaitForSingleObject(ctypes.c_void_p(h), wait_ms) == 0
    finally:
        k.CloseHandle(ctypes.c_void_p(h))

def wait_file(p, ms=10000):
    start = time.monotonic()
    while not p.exists():
        if (time.monotonic() - start) * 1000 > ms:
            raise RuntimeError(f'timeout waiting for {p.name}')
        time.sleep(0.01)

def read_ownership(path):
    for _ in range(200):
        try:
            return json.loads(path.read_text())
        except (PermissionError, json.JSONDecodeError):
            time.sleep(0.01)
    raise RuntimeError('ownership record remained unreadable')

def rows(base):
    con = duckdb.connect(str(base / 'analytics.duckdb'), read_only=True)
    try:
        return con.execute('SELECT count(*) FROM ticks').fetchone()[0]
    finally:
        con.close()

def case(name, worker_mode, abrupt, race=False):
    base = RUNS / name
    base.mkdir()
    host = subprocess.Popen([str(APP), 'host', str(base), sys.executable, str(WORKER), worker_mode],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    replacement = None
    try:
        wait_file(base / 'worker_ready')
        wait_file(base / 'ownership.json')
        if worker_mode in ('descendant', 'breakaway'):
            wait_file(base / 'child_in_job.txt')
            wait_file(base / 'child_ready')
            wait_file(base / 'child_ticks.log')
            start_ticks = time.monotonic()
            while not (base / 'child_ticks.log').read_text():
                if time.monotonic() - start_ticks > 5:
                    raise RuntimeError('child made no ticks')
                time.sleep(0.01)
            start_manifest = time.monotonic()
            while read_ownership(base / 'ownership.json')['Descendant'] is None:
                if time.monotonic() - start_manifest > 5:
                    raise RuntimeError('descendant not recorded')
                time.sleep(0.01)
        ownership = read_ownership(base / 'ownership.json')
        worker_pid = ownership['Worker']['Pid']
        desc_pid = ownership['Descendant']['Pid'] if ownership['Descendant'] else None
        start = time.monotonic()
        while not (base / 'rows_written.txt').exists() or int((base / 'rows_written.txt').read_text()) < 3:
            if time.monotonic() - start > 5:
                raise RuntimeError('no DuckDB writes')
            time.sleep(0.02)
        pre_rows = int((base / 'rows_written.txt').read_text())
        blocked_before_kill = None
        if race:
            replacement = subprocess.Popen([str(APP), 'recover', str(base), sys.executable, str(WORKER)],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                           creationflags=subprocess.CREATE_NO_WINDOW)
            time.sleep(0.12) # Observation only; recovery itself waits on process handles.
            blocked_before_kill = replacement.poll() is None
        kill_utc = int(time.time() * 1000)
        if abrupt:
            host.kill()
        else:
            (base / 'stop').write_text('stop')
        host_out, host_err = host.communicate(timeout=10)
        worker_exited = exited(worker_pid)
        descendant_exited = exited(desc_pid) if desc_pid else None
        if not replacement:
            replacement = subprocess.Popen([str(APP), 'recover', str(base), sys.executable, str(WORKER)],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                           creationflags=subprocess.CREATE_NO_WINDOW)
        recover_out, recover_err = replacement.communicate(timeout=20)
        after_rows = rows(base) if worker_exited and replacement.returncode == 0 else None
        time.sleep(0.15) # Post-exit mutation observation, not the recovery gate.
        stable_rows = rows(base) if after_rows is not None else None
        ticks = (base / 'child_ticks.log')
        child_count = len(ticks.read_text().splitlines()) if ticks.exists() else None
        time.sleep(0.05)
        child_stable = (len(ticks.read_text().splitlines()) == child_count) if ticks.exists() else None
        events = [json.loads(line) for line in (host_out + recover_out).splitlines() if line.startswith('{')]
        ready = next((x for x in events if x.get('event_name') == 'worker_ready'), None)
        recovered = next((x for x in events if x.get('event_name') == 'recovery_start'), None)
        passed = ((host.returncode != 0 if abrupt else host.returncode == 0) and worker_exited and replacement.returncode == 0
                  and after_rows == stable_rows and after_rows >= pre_rows and ready is not None and recovered is not None
                  and (descendant_exited is True and child_stable is True if desc_pid else True)
                  and ((base / 'child_in_job.txt').read_text() == '1' if desc_pid else True)
                  and (blocked_before_kill is True if race else True)
                  and recovered['utc_ms'] >= kill_utc
                  and (base / 'job_handle_inherited.txt').read_text() == '0')
        return {'id': name, 'status': 'pass' if passed else 'fail', 'session': ownership['Session'],
                'host_pid': ownership['Host']['Pid'], 'worker_pid': worker_pid, 'descendant_pid': desc_pid,
                'host_exit': host.returncode, 'worker_exited': worker_exited, 'descendant_exited': descendant_exited,
                'replacement_exit': replacement.returncode, 'blocked_before_kill': blocked_before_kill,
                'pre_rows': pre_rows, 'after_rows': after_rows, 'stable_rows': stable_rows,
                'child_ticks_stable': child_stable, 'kill_utc_ms': kill_utc,
                'child_in_job': (base / 'child_in_job.txt').read_text() if desc_pid else None,
                'recovery_utc_ms': recovered['utc_ms'] if recovered else None,
                'breakaway_error': (base / 'breakaway_error.txt').read_text() if (base / 'breakaway_error.txt').exists() else None,
                'job_handle_inherited': (base / 'job_handle_inherited.txt').read_text(),
                'events': events, 'errors': (host_err + recover_err)[:300]}
    except Exception as e:
        return {'id': name, 'status': 'fail', 'error': str(e), 'host_exit': host.poll()}
    finally:
        if host.poll() is None:
            host.kill(); host.wait(timeout=5)
        if replacement and replacement.poll() is None:
            replacement.kill(); replacement.wait(timeout=5)

tests = [case('normal','normal',False), case('abrupt','normal',True),
         case('restart_race','normal',True,True), case('descendant','descendant',True),
         case('breakaway','breakaway',True)]
for i in range(10):
    tests.append(case(f'repeated_{i+1}','descendant',True,True))
missing = RUNS / 'missing_manifest'
missing.mkdir()
blocked = subprocess.run([str(APP), 'recover', str(missing), sys.executable, str(WORKER)],
                         capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
tests.append({'id':'missing_manifest', 'status':'pass' if blocked.returncode == 4 and 'recovery_start' not in blocked.stdout else 'fail',
              'replacement_exit':blocked.returncode, 'errors':blocked.stderr.strip()})
uncertain = RUNS / 'uncertain_identity'
uncertain.mkdir()
(uncertain / 'ownership.json').write_text(json.dumps({'Session':'synthetic',
    'Host':{'Pid':__import__('os').getpid(),'StartTicks':0},
    'Worker':{'Pid':__import__('os').getpid(),'StartTicks':0},
    'Descendant':None,'CreatedUtcMs':0}))
blocked = subprocess.run([str(APP), 'recover', str(uncertain), sys.executable, str(WORKER)],
                         capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
tests.append({'id':'uncertain_identity', 'status':'pass' if blocked.returncode == 5 and 'recovery_start' not in blocked.stdout else 'fail',
              'replacement_exit':blocked.returncode, 'errors':blocked.stderr.strip()})
# Protocol-state model only: real IPC delivery was exercised in the prior IPC spike.
current = {'session':'new', 'generation':2, 'pending':{'request-new':'operation-new'}, 'completed':set()}
def accept(response):
    if response['session'] != current['session'] or response['generation'] != current['generation']:
        return False
    if current['pending'].get(response['request_id']) != response['operation_id']:
        return False
    if response['request_id'] in current['completed']:
        return False
    current['completed'].add(response['request_id'])
    return True
stale = {'session':'old','generation':1,'request_id':'request-old','operation_id':'operation-old'}
fresh = {'session':'new','generation':2,'request_id':'request-new','operation_id':'operation-new'}
outcomes = [accept(stale), accept(fresh), accept(fresh)]
tests.append({'id':'stale_response_model', 'status':'pass' if outcomes == [False,True,False] else 'fail',
              'outcomes':outcomes, 'completed':sorted(current['completed'])})
RESULTS.write_text(json.dumps({'tests':tests, 'summary':{'pass':sum(t['status']=='pass' for t in tests),
                   'fail':sum(t['status']=='fail' for t in tests)}},indent=2))
print(json.dumps({'pass':sum(t['status']=='pass' for t in tests),'fail':sum(t['status']=='fail' for t in tests)}))
sys.exit(1 if any(t['status'] != 'pass' for t in tests) else 0)
