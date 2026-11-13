// Experimental proof only. No DataForge application code depends on this file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const exe = path.join(root, 'tools', 'duckdb.exe');
const db = path.join(root, 'fixtures', 'proof.duckdb');
const source = path.join(root, 'fixtures', 'source.csv');
const secret = path.join(root, 'fixtures', 'not_registered.txt');
const report = path.join(root, 'results.json');
if (!fs.existsSync(exe)) throw new Error('Install pinned DuckDB CLI first; see README.md');
fs.mkdirSync(path.dirname(db), { recursive: true });
if (fs.existsSync(db)) fs.unlinkSync(db); // Only this harness-owned fixture database.
fs.writeFileSync(source, 'id,odd name,value\n1,a,10\n2,b,\n3,c,30\n');
fs.writeFileSync(secret, 'PRIVATE_TEST_MARKER\n');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const redact = s => String(s || '').replaceAll(root, '<experiment>')
  .replaceAll(root.replaceAll('\\','/'), '<experiment>')
  .replace(/C:[/\\]Users[/\\][^\s'"\r\n]+/gi, '<local-path>');
const before = hash(source);
const q = s => "'" + String(s).replaceAll("'", "''") + "'";
const cli = (sql, readOnly = true, timeout = 2500) => {
  const args = ['-json', '-no-stdin', '-bail'];
  if (readOnly) args.push('-readonly');
  args.push(db, '-c', sql);
  const t = Date.now();
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true });
  return { ok: r.status === 0 && !r.error, status: r.status, error: r.error?.code || null,
    stdout: r.stdout || '', stderr: r.stderr || '', ms: Date.now() - t };
};
// Setup is application-owned trusted work, never reached from the SQL entry point.
const init = cli("CREATE TABLE registered_a AS SELECT * FROM read_csv(" + q(source.replaceAll('\\','/')) + "); CREATE TABLE registered_b(id INTEGER, label VARCHAR); INSERT INTO registered_b VALUES (1,'one'),(2,'two'),(3,'three'); CREATE TABLE registered_big AS SELECT i AS id FROM range(200000) t(i); CREATE TABLE registered_wide AS SELECT repeat('x',1000) AS value FROM range(100)", false, 10000);
if (!init.ok) throw new Error('Fixture setup failed: ' + init.stderr);
const representationBefore = hash(db);
const allowedFunctions = new Set(['count','count_star','sum','avg','min','max','coalesce','row_number','lower','upper','abs','*']);
const allowedTableTypes = new Set(['BASE_TABLE','JOIN','SUBQUERY','EMPTY']);
const registered = new Set(['registered_a','registered_b','registered_big','registered_wide']);
function validate(sql) {
  if (Buffer.byteLength(sql, 'utf8') > 8192) throw new Error('sql_too_large');
  // The parser is DuckDB itself; no regex/keyword check decides permission.
  const parsed = cli('SELECT json_serialize_sql(' + q(sql) + ') AS ast', true);
  if (!parsed.ok) throw new Error('parse_failed');
  let ast;
  try { ast = JSON.parse(parsed.stdout)[0].ast; } catch { throw new Error('parse_output_invalid'); }
  if (ast.error || ast.statements?.length !== 1 || ast.statements[0]?.node?.type !== 'SELECT_NODE') throw new Error('statement_denied');
  const ctes = new Set();
  function collect(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(collect);
    for (const item of x.cte_map?.map || []) ctes.add(item.key.toLowerCase());
    for (const v of Object.values(x)) collect(v);
  }
  collect(ast);
  function visit(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(visit);
    if (x.node?.type && x.node.type !== 'SELECT_NODE') throw new Error('nested_statement_denied');
    if (x.from_table && !allowedTableTypes.has(x.from_table.type)) throw new Error('table_source_denied');
    if (x.type === 'BASE_TABLE') {
      if (x.schema_name || x.catalog_name || ![...registered,...ctes].includes(String(x.table_name).toLowerCase())) throw new Error('unregistered_table');
    }
    if (x.class === 'FUNCTION' || x.class === 'WINDOW') {
      if (!allowedFunctions.has(String(x.function_name || '').toLowerCase())) throw new Error('function_denied');
    }
    if (x.type === 'STAR' && x.relation_name && ![...registered,...ctes].includes(x.relation_name.toLowerCase())) throw new Error('unregistered_star');
    for (const v of Object.values(x)) visit(v);
  }
  visit(ast);
  return sql.trim().replace(/;$/, '');
}
function execute(sql, timeout = 2500) {
  const t = Date.now();
  let safe;
  try { safe = validate(sql); } catch (e) { return { outcome: 'rejected', reason: e.message, ms: Date.now()-t }; }
  // App-owned configuration. LIMIT bounds transfer, not intermediate work.
  const settings = "SET enable_external_access=false; SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET allow_community_extensions=false; SET memory_limit='128MB'; SET max_temp_directory_size='32MB'; SET threads=2; SET lock_configuration=true;";
  const r = cli(settings + ' SELECT * FROM (' + safe + ') AS bounded_result LIMIT 101', true, timeout);
  if (!r.ok) return { outcome: r.error === 'ETIMEDOUT' ? 'timeout' : 'duckdb_error',
    reason: r.error || redact(r.stderr).slice(0,150), ms: r.ms };
  if (Buffer.byteLength(r.stdout,'utf8') > 65536) return { outcome:'result_bytes_exceeded', ms:r.ms };
  let rows;
  try { rows = JSON.parse(r.stdout); } catch { return { outcome:'result_parse_error', ms:r.ms }; }
  if (rows.length > 100) return { outcome:'result_rows_exceeded', ms:r.ms };
  return { outcome:'ok', rows:rows.length, ms:r.ms };
}
const cases = [
  ['select','SELECT id FROM registered_a'],
  ['aggregate','SELECT sum(value) FROM registered_a'],
  ['filter_sort','SELECT id FROM registered_a WHERE id > 1 ORDER BY id DESC'],
  ['join','SELECT a.id,b.label FROM registered_a a JOIN registered_b b ON a.id=b.id'],
  ['cte','WITH x AS (SELECT id FROM registered_a) SELECT * FROM x'],
  ['subquery','SELECT * FROM (SELECT id FROM registered_a) x'],
  ['window','SELECT row_number() OVER (ORDER BY id) FROM registered_a'],
  ['null_odd_column','SELECT "odd name" FROM registered_a WHERE value IS NULL'],
  ['insert','INSERT INTO registered_b VALUES (9,\'x\')'],
  ['update','UPDATE registered_b SET label=\'x\''],
  ['delete','DELETE FROM registered_b'],
  ['create','CREATE TABLE hacked AS SELECT 1'],
  ['drop','DROP TABLE registered_a'],
  ['alter','ALTER TABLE registered_a ADD COLUMN x INT'],
  ['copy','COPY registered_a TO '+q(path.join(root,'fixtures','leak.csv'))],
  ['attach',"ATTACH ':memory:' AS leak"],
  ['detach','DETACH leak'],
  ['read_csv',"SELECT * FROM read_csv("+q(secret.replaceAll('\\','/'))+")"],
  ['read_parquet',"SELECT * FROM read_parquet('C:/Windows/win.ini')"],
  ['glob',"SELECT * FROM glob('C:/Users/*')"],
  ['read_text',"SELECT * FROM read_text("+q(secret.replaceAll('\\','/'))+")"],
  ['read_blob',"SELECT * FROM read_blob("+q(secret.replaceAll('\\','/'))+")"],
  ['unregistered','SELECT * FROM secret_table'],
  ['http',"SELECT * FROM read_csv('https://example.com/a.csv')"],
  ['install','INSTALL httpfs'],['load','LOAD httpfs'],
  ['set','SET enable_external_access=true'],['reset','RESET enable_external_access'],
  ['pragma','PRAGMA database_list'],
  ['env','SELECT current_setting(\'home_directory\')'],
  ['multi','SELECT 1; DELETE FROM registered_a'],
  ['unknown_function','SELECT mystery_function(id) FROM registered_a'],
  ['malformed','SELECT FROM'],
  ['oversized','SELECT ' + '1'.repeat(9000)],
  ['large_output','SELECT * FROM registered_big'],
  ['wide_output','SELECT * FROM registered_wide'],
  ['cross_join','SELECT count(*) FROM registered_big a CROSS JOIN registered_big b'],
  ['large_sort','SELECT id FROM registered_big ORDER BY id DESC'],
  ['expensive_aggregate','SELECT sum(a.id * b.id) FROM registered_big a CROSS JOIN registered_big b'],
];
const results = cases.map(([name,sql]) => ({name,...execute(sql, name==='cross_join'?1000:2500)}));
const after = hash(source);
const representationAfter = hash(db);
const post = execute('SELECT count(*) FROM registered_a');
const hardening = "SET enable_external_access=false; SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET allow_community_extensions=false; SET lock_configuration=true;";
const directExternal = cli(hardening + ' SELECT * FROM read_csv(' + q(secret.replaceAll('\\','/')) + ')');
const directWrite = cli(hardening + " COPY registered_a TO " + q(path.join(root,'fixtures','direct-write.csv').replaceAll('\\','/')));
fs.writeFileSync(report, JSON.stringify({version:cli('SELECT version() AS version').stdout.trim(),
  environment:{platform:process.platform,arch:process.arch,node:process.version},
  limits:{sqlBytes:8192,resultRows:100,resultBytes:65536,duckdbMemory:'128MB',duckdbTemp:'32MB',threads:2,wallMs:2500,crossJoinWallMs:1000},
  sourceHashBefore:before,sourceHashAfter:after,sourceUnchanged:before===after,
  representationHashBefore:representationBefore,representationHashAfter:representationAfter,
  representationUnchanged:representationBefore===representationAfter,
  results,postCancellationQuery:post,
  directDuckDBControls:{externalReadBlocked:!directExternal.ok,externalReadError:redact(directExternal.stderr).slice(0,200),
    copyBlocked:!directWrite.ok,copyError:redact(directWrite.stderr).slice(0,200)}},null,2));
console.log('Wrote results.json; cases:',results.length,'source unchanged:',before===after);
