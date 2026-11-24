// Disposable probe. All fixture paths are owned by this experiment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = __dirname;
const fixture = path.join(root, 'sql-boundary-fixture');
const exe = path.join(root, 'target', 'debug', 'sql_boundary_prototype.exe');
const parser = path.join(root, '..', 'duckdb-sql-boundary', 'tools', 'duckdb.exe');
const db = path.join(fixture, 'approved.duckdb');
const sentinel = path.join(fixture, 'not-approved.txt');
if (!fs.existsSync(exe)) throw new Error('Build sql_boundary_prototype first');
if (!fs.existsSync(parser)) throw new Error('Pinned 1.4.2 CLI parser missing; see ../duckdb-sql-boundary/README.md');
if (fs.existsSync(fixture) && fs.lstatSync(fixture).isSymbolicLink()) throw new Error('Refusing linked fixture directory');
fs.mkdirSync(fixture, { recursive: true });
if (path.dirname(fs.realpathSync(fixture)) !== fs.realpathSync(root)) throw new Error('Fixture escaped experiment directory');
for (const name of ['approved.duckdb', 'approved.duckdb.wal', 'not-approved.txt', 'copy-output.csv']) {
  const target = path.join(fixture, name);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
fs.writeFileSync(sentinel, 'SYNTHETIC_PRIVATE_MARKER\n');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const call = (mode, sql = '', timeout = 4000) => {
  const result = spawnSync(exe, [mode, db], { input: sql, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return { ok: result.status === 0, code: result.error?.code ?? result.stderr.trim() ?? '', output: result.stdout.trim() };
};
assert(call('setup').ok);
const before = { db: hash(db), sentinel: hash(sentinel) };

function policy(sql) {
  if (Buffer.byteLength(sql, 'utf8') > 8192) return 'sql_too_large';
  const quoted = "'" + sql.replaceAll("'", "''") + "'";
  const parsed = spawnSync(parser, ['-json', '-no-stdin', '-bail', ':memory:', '-c', `SELECT json_serialize_sql(${quoted}) AS ast`], { encoding: 'utf8', timeout: 4000, windowsHide: true });
  if (parsed.status !== 0) return 'parse_error';
  let ast;
  try { ast = JSON.parse(parsed.stdout)[0].ast; } catch { return 'ast_invalid'; }
  if (ast.error || ast.statements?.length !== 1 || ast.statements[0]?.node?.type !== 'SELECT_NODE') return 'statement_denied';
  let tables = 0; let selects = 0;
  const allowedFunctions = new Set(['count', 'count_star', 'sum', 'avg', 'min', 'max', 'abs']);
  function walk(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.node?.type === 'SELECT_NODE') selects++;
    if (x.cte_map?.map?.length) throw Error('cte_denied');
    if (x.from_table && x.from_table.type !== 'BASE_TABLE') throw Error('table_source_denied');
    if (x.type === 'BASE_TABLE') {
      tables++;
      if (x.table_name !== 'approved' || x.schema_name || x.catalog_name) throw Error('unapproved_table');
    }
    if (x.class === 'FUNCTION' && !allowedFunctions.has(String(x.function_name).toLowerCase())) throw Error('function_denied');
    if (x.class === 'WINDOW') throw Error('window_denied');
    for (const value of Object.values(x)) walk(value);
  }
  try { walk(ast); } catch (error) { return error.message; }
  return tables === 1 && selects === 1 ? null : 'shape_denied';
}
function attempt(sql) {
  const denied = policy(sql);
  return denied ? { outcome: 'rejected', reason: denied } : (() => {
    const result = call('run', sql);
    return { outcome: result.ok ? 'ok' : result.code === 'ETIMEDOUT' ? 'timeout' : 'worker_error', detail: result.ok ? result.output : result.code };
  })();
}
const tests = [
  ['select', 'SELECT id, value FROM approved', 'ok'],
  ['filter', "SELECT value FROM approved WHERE id = 2", 'ok'],
  ['aggregate', 'SELECT count(*) FROM approved', 'ok'],
  ['insert', "INSERT INTO approved VALUES (3, 'x')", 'rejected'],
  ['delete', 'DELETE FROM approved', 'rejected'],
  ['create', 'CREATE TABLE extra AS SELECT * FROM approved', 'rejected'],
  ['copy', `COPY approved TO '${path.join(fixture, 'copy-output.csv').replaceAll('\\', '/')}'`, 'rejected'],
  ['attach', "ATTACH ':memory:' AS other", 'rejected'],
  ['install', 'INSTALL httpfs', 'rejected'],
  ['load', 'LOAD httpfs', 'rejected'],
  ['setting', 'SET enable_external_access=true', 'rejected'],
  ['pragma', 'PRAGMA database_list', 'rejected'],
  ['multi', 'SELECT * FROM approved; DELETE FROM approved', 'rejected'],
  ['external_file', `SELECT * FROM read_text('${sentinel.replaceAll('\\', '/')}')`, 'rejected'],
  ['external_url', "SELECT * FROM read_csv('https://example.com/x.csv')", 'rejected'],
  ['unknown_table', 'SELECT * FROM not_approved', 'rejected'],
  ['cte', 'WITH x AS (SELECT * FROM approved) SELECT * FROM x', 'rejected'],
  ['subquery', 'SELECT * FROM (SELECT * FROM approved) x', 'rejected'],
  ['join', 'SELECT * FROM approved a JOIN approved b USING (id)', 'rejected'],
  ['unknown_function', 'SELECT read_text(value) FROM approved', 'rejected'],
  ['oversize', 'SELECT ' + '1'.repeat(8200), 'rejected'],
];
const results = tests.map(([name, sql, expected]) => {
  const result = attempt(sql);
  assert.equal(result.outcome, expected, `${name}: ${JSON.stringify(result)}`);
  return { name, ...result };
});
const directExternal = call('probe', `SELECT * FROM read_text('${sentinel.replaceAll('\\', '/')}')`);
const directNetwork = call('probe', "SELECT * FROM read_csv('https://example.invalid/x.csv')");
const directCopy = call('probe', `COPY approved TO '${path.join(fixture, 'copy-output.csv').replaceAll('\\', '/')}'`);
const directSetting = call('probe', 'SET enable_external_access=true');
const directLoad = call('probe', 'LOAD httpfs');
const directInstall = call('probe', 'INSTALL httpfs');
assert(!directExternal.ok && !directCopy.ok);
assert(!directNetwork.ok && !directSetting.ok && !directLoad.ok && !directInstall.ok);
assert(!fs.existsSync(path.join(fixture, 'copy-output.csv')));
const rowLimit = call('run', 'SELECT i FROM range(300) t(i)');
const byteLimit = call('run', 'SELECT repeat(value, 600000) FROM approved');
assert.equal(rowLimit.code, 'row_limit');
assert.equal(byteLimit.code, 'byte_limit');
const deadline = call('run', 'SELECT count(*) FROM range(1000000000) a CROSS JOIN range(1000000000) b', 150);
assert.equal(deadline.code, 'ETIMEDOUT');

function cancelDirectQuery() {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['run', db], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end('SELECT count(*) FROM range(1000000000) a CROSS JOIN range(1000000000) b');
    const timer = setTimeout(() => child.kill(), 150);
    child.on('error', reject);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, exited: true }); });
  });
}
(async () => {
  const cancellation = await cancelDirectQuery(); // Direct worker input isolates termination behavior from policy rejection.
  assert.equal(cancellation.signal, 'SIGTERM');
  const after = { db: hash(db), sentinel: hash(sentinel) };
  assert.deepEqual(after, before);
  assert(attempt('SELECT count(*) FROM approved').outcome === 'ok');
  const report = { version: call('run', 'SELECT version()').output, cases: results, directControls: { externalReadDenied: !directExternal.ok, networkReadDenied: !directNetwork.ok, copyDenied: !directCopy.ok, settingDenied: !directSetting.ok, extensionLoadDenied: !directLoad.ok, extensionInstallDenied: !directInstall.ok }, limits: { rowLimit: rowLimit.code, byteLimit: byteLimit.code, deadline: deadline.code }, cancellation, unchanged: true, postCancelQuery: 'ok' };
  fs.writeFileSync(path.join(fixture, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`Passed ${results.length} policy cases; external read and COPY denied; child exit observed; fixture hashes unchanged.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
