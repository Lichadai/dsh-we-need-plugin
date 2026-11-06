import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const seed = read('seed.txt').replace(/^\uFEFF/, '').trim();
const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));
const patch = read('cordis.patch.yml');

assert.equal(seed.length, 728, 'seed must be 728 chars');
assert.equal(Buffer.byteLength(seed), 728, 'seed must be 728 bytes');
assert.ok(readme.includes(seed), 'README must contain the exact seed text');
assert.ok(pkg.files.includes('seed.txt'), 'package.json files must include seed.txt');
assert.ok(pkg.files.includes('cordis.patch.yml'), 'package.json files must include cordis.patch.yml');
assert.ok(pkg.files.includes('index.js'), 'package.json files must include index.js');
assert.equal(pkg.exports['./seed.txt'], './seed.txt', 'seed.txt should be exported for tooling');
assert.ok(patch.includes(`name: '${pkg.name}'`), 'patch row name must match package name');
assert.ok(patch.includes('targetRules:'), 'patch must declare targetRules');
assert.ok(patch.includes('[deepseek, flash]'), 'release targetRules should be deepseek + flash');
assert.ok(patch.includes('matchName: false'), 'release should match the upstream model id by default');
assert.ok(!patch.includes('interceptModels'), 'release should not require provider routes');
assert.ok(!patch.includes('captureDir'), 'release must not contain captureDir');
assert.ok(!pkg.files.includes('harness.js'), 'release must not ship harness.js');

const packed = process.platform === 'win32'
  ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  : execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
const files = JSON.parse(packed)[0].files.map((entry) => entry.path);
for (const required of ['index.js', 'seed.txt', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json', 'README.md', 'LICENSE']) {
  assert.ok(files.includes(required), `tarball must include ${required}`);
}
assert.ok(!files.includes('harness.js'), 'tarball must not include harness.js');
assert.ok(!files.some((file) => file.startsWith('tests/')), 'tests should stay out of the npm tarball');

console.log('PASS package integrity: seed 728/728, README seed, patch name/rules, tarball files, no harness');
