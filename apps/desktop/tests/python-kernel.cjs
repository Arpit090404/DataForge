const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const executable = process.env.DATAFORGE_TEST_PYTHON;
if (!executable) throw new Error('Set DATAFORGE_TEST_PYTHON to an existing ipykernel Python executable.');
const source = fs.readFileSync(path.resolve(__dirname, '../src-tauri/src/python_kernel.py'), 'utf8');
const child = spawn(executable, ['-u', '-c', source], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = readline.createInterface({ input: child.stdout });
const queue = [];
let wake;
lines.on('line', line => { const item = JSON.parse(line); if (wake) { const next = wake; wake = null; next(item); } else queue.push(item); });
const receive = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Kernel reply timed out')), 20000);
  wake = item => { clearTimeout(timer); resolve(item); };
});
const send = (id, action, code) => child.stdin.write(JSON.stringify({ version: 1, id, action, code }) + '\n');
(async () => {
  try {
    assert.equal((await receive()).status, 'ready');
    send('one', 'execute', 'x = 7\nprint("hello")\nx');
    const one = await receive();
    assert.equal(one.id, 'one'); assert.equal(one.status, 'succeeded'); assert.equal(one.count, 1);
    assert.ok(one.outputs.some(item => item.kind === 'stdout' && item.text.includes('hello')));
    assert.ok(one.outputs.some(item => item.kind === 'result' && item.text.includes('7')));
    send('two', 'execute', 'x + 1');
    const two = await receive(); assert.equal(two.count, 2); assert.ok(two.outputs.some(item => item.text.includes('8')));
    send('three', 'execute', 'raise ValueError("test error")');
    const three = await receive(); assert.equal(three.status, 'failed'); assert.ok(three.outputs.some(item => item.kind === 'error' && item.text.includes('ValueError')));
    send('long', 'execute', 'import time; time.sleep(10)');
    await new Promise(resolve => setTimeout(resolve, 500));
    send('interrupt', 'interrupt');
    const interrupted = await receive(); assert.equal(interrupted.id, 'long'); assert.equal(interrupted.status, 'failed');
    assert.ok(interrupted.outputs.some(item => item.kind === 'error' && item.text.includes('KeyboardInterrupt')));
    send('restart', 'restart'); assert.equal((await receive()).status, 'restarted');
    send('four', 'execute', 'x');
    const four = await receive(); assert.equal(four.count, 1); assert.equal(four.status, 'failed');
    send('shutdown', 'shutdown'); child.stdin.end();
    await new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error('Kernel did not shut down')); }, 10000); child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Bridge exited ${code}`)); }); });
    console.log('Jupyter kernel stdout, result, error, state, count, restart, and cleanup passed.');
  } catch (error) { child.kill(); throw error; }
})().catch(error => { console.error(error); process.exitCode = 1; });
