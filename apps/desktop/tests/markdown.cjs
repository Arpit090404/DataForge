const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/Markdown.tsx');
const compiled = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
const markdownModule = new Module(filename, module);
markdownModule.filename = filename;
markdownModule.paths = Module._nodeModulePaths(path.dirname(filename));
markdownModule._compile(compiled, filename);
const render = text => renderToStaticMarkup(React.createElement(markdownModule.exports.Markdown, { text }));

const supported = render('# Heading\n\nParagraph with **bold**, *italic*, `code`, and [link](https://example.com).\n\n- first\n- second\n\n1. one\n2. two');
for (const expected of ['<h1>Heading</h1>', '<strong>bold</strong>', '<em>italic</em>', '<code>code</code>', 'href="https://example.com"', '<ul>', '<ol>', '<li>second</li>']) assert.ok(supported.includes(expected), expected);
const unsafe = render('<img src=x onerror=alert(1)> [bad](javascript:alert) [bad](data:text/html)');
assert.ok(unsafe.includes('&lt;img'));
assert.ok(!unsafe.includes('<img'));
assert.ok(!unsafe.includes('href='));
assert.ok(render('[email](mailto:test@example.com)').includes('href="mailto:test@example.com"'));
assert.ok(render('Intro\n```sql\nSELECT <name>\n```').includes('<pre><code>SELECT &lt;name&gt;</code></pre>'));
const nested = render('- parent\n  3. child\n     - **grandchild**\n  4. sibling\n- next\n\nAfter the list.');
assert.ok(nested.includes('<ul><li>parent<ol start="3"><li>child<ul><li><strong>grandchild</strong></li></ul></li><li>sibling</li></ol></li><li>next</li></ul><p>After the list.</p>'));
assert.ok(render('1. parent\n\t- tab child\n2. sibling').includes('<ol><li>parent<ul><li>tab child</li></ul></li><li>sibling</li></ol>'));
console.log('Markdown rendering checks passed.');
