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
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dS8AAAAASUVORK5CYII=';
    send('rich', 'execute', [
      'import pandas as pd, sys, base64',
      'from IPython.display import display, Image, Javascript',
      'print("first")',
      'display(pd.DataFrame({"name": ["Ada", "<script>alert(1)</script>"], "value": [1, 2]}))',
      `display(Image(data=base64.b64decode("${png}"), format="png"))`,
      'print("warning", file=sys.stderr)',
      '42',
    ].join('\n'));
    const rich = await receive();
    assert.equal(rich.status, 'succeeded');
    assert.deepEqual(rich.outputs.map(item => item.kind), ['stdout', 'table', 'image', 'stderr', 'result']);
    assert.deepEqual(rich.outputs[1].columns, ['', 'name', 'value']);
    assert.deepEqual(rich.outputs[1].rows[0], ['0', 'Ada', '1']);
    assert.equal(rich.outputs[1].rows[1][1], '<script>alert(1)</script>');
    assert.equal(rich.outputs[2].mime, 'image/png');
    assert.ok(rich.outputs[2].data.startsWith('iVBOR'));
    if (process.env.DATAFORGE_TEST_MATPLOTLIB === '1') {
      send('plot', 'execute', [
        '%matplotlib inline',
        'import matplotlib.pyplot as plt',
        'plt.figure(figsize=(2, 1))',
        'plt.plot([1, 2, 3], [3, 1, 2])',
        'plt.show()',
      ].join('\n'));
      const plot = await receive();
      assert.equal(plot.status, 'succeeded');
      assert.ok(plot.outputs.some(item => item.kind === 'image' && item.mime === 'image/png'));
      send('jpeg', 'execute', [
        'from PIL import Image as PILImage',
        'from io import BytesIO',
        'buffer = BytesIO()',
        "PILImage.new('RGB', (2, 2), 'red').save(buffer, format='JPEG')",
        "display(Image(data=buffer.getvalue(), format='jpeg'))",
      ].join('\n'));
      const jpeg = await receive();
      assert.equal(jpeg.status, 'succeeded');
      assert.ok(jpeg.outputs.some(item => item.kind === 'image' && item.mime === 'image/jpeg'));
    }
    send('unsafe', 'execute', 'from IPython.display import display, Javascript; display(Javascript("window.evil = true"))');
    const unsafe = await receive();
    assert.equal(unsafe.status, 'succeeded');
    assert.ok(unsafe.outputs.every(item => !item.data && !item.mime));
    send('large_html', 'execute', 'from IPython.display import display, HTML; display(HTML("<table class=\\"dataframe\\"><tr><th>x</th></tr><tr><td>" + "a" * 1100000 + "</td></tr></table>"))');
    const largeHtml = await receive();
    assert.equal(largeHtml.status, 'succeeded');
    assert.ok(largeHtml.outputs.every(item => item.kind !== 'table' && !item.data));
    send('oversized', 'execute', 'from IPython.display import display, Image; display(Image(data=b"\\x89PNG\\r\\n\\x1a\\n" + b"x" * 800000, format="png"))');
    const oversized = await receive();
    assert.equal(oversized.status, 'succeeded');
    assert.ok(oversized.outputs.every(item => item.kind !== 'image'));
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
