const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../src');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const tailwind = fs.readFileSync(path.join(root, 'tailwind.css'), 'utf8');
const button = fs.readFileSync(path.join(root, 'components/ui/button.tsx'), 'utf8');
const tokens = css.slice(0, css.indexOf('}') + 1);
const rules = css.slice(tokens.length);
for (const token of ['app-bg', 'sidebar', 'surface', 'surface-secondary', 'surface-elevated', 'hover', 'selected', 'text', 'text-secondary', 'text-muted', 'border', 'input-border', 'focus-ring', 'action', 'destructive', 'success', 'warning', 'error']) {
  assert.match(tokens, new RegExp(`--color-${token}:`), `Missing semantic color ${token}`);
}
for (const control of ['input', 'select', 'textarea']) {
  assert.match(rules, new RegExp(`\\.ui-${control}\\b`), `Missing shared ${control} styling`);
}
assert.match(tailwind, /@import "tailwindcss\/utilities\.css"/, 'Tailwind utilities are missing');
assert.doesNotMatch(tailwind, /preflight\.css|@import "tailwindcss"/, 'Preflight must stay disabled during the pilot');
assert.match(tailwind, /--color-primary: var\(--color-action\)/, 'Tailwind must use the existing action token');
assert.match(button, /@base-ui\/react\/button/, 'Button must use the selected Base UI foundation');
for (const variant of ['primary', 'secondary', 'ghost', 'destructive', 'icon']) {
  assert.match(button, new RegExp(`\\b${variant}:`), `Missing Button variant ${variant}`);
}
assert.doesNotMatch(rules, /^\.ui-button(?:--[\w-]+)?\s*\{/m, 'Legacy Button styling must not compete with Tailwind');
assert.doesNotMatch(rules, /\.(?:primary|secondary|icon|text)-button\s*\{/, 'Legacy button styling must use the shared Button rules');
for (const [name, source] of [['styles.css', rules], ...['App.tsx', 'Notebook.tsx'].map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')])]) {
  assert.doesNotMatch(source, /#[\da-f]{3,8}\b|\brgba?\s*\(/i, `${name} has a color outside the token palette`);
  if (name.endsWith('.tsx')) for (const match of source.matchAll(/\bsize=\{(\d+)\}/g)) {
    assert.ok([14, 16, 20, 28].includes(Number(match[1])), `${name} uses an undocumented icon size ${match[1]}`);
  }
}
function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map(channel => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
function color(name) {
  const value = tokens.match(new RegExp(`--color-${name}:(#[\\da-f]{6})`, 'i'))?.[1];
  assert.ok(value, `Missing six-digit color ${name}`);
  return luminance(value.slice(1));
}
for (const name of ['text', 'text-secondary', 'text-muted', 'text-subtle']) {
  assert.ok((color(name) + 0.05) / (color('hover') + 0.05) >= 4.5, `${name} must remain readable on the lightest surface`);
}
console.log('Design token checks passed.');
