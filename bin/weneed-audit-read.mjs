// Offline reader for the WeNeed plugin injection audit (方案 A 取证工具).
// The plugin records every injection decision to ~/.dsh/weneed-audit.jsonl
// (third-party plugins cannot write in-log records; see WORKLOG §76). This tool
// reads that durable record so injection decisions are auditable without the
// plugin installed, and correlates with a session log by taskHash.
//
// Usage:
//   node bin/weneed-audit-read.mjs [--last N] [--task <taskHash>] [--reason <r>] [--json]
//   node bin/weneed-audit-read.mjs --path <audit.jsonl> ...
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const has = (flag) => args.includes(flag);
const auditPath = get('--path') || path.join(homedir(), '.dsh', 'weneed-audit.jsonl');
const last = Number(get('--last') || 0);
const taskFilter = get('--task');
const reasonFilter = get('--reason');

if (!fs.existsSync(auditPath)) {
  console.log(`no audit file at ${auditPath} (plugin writes it on first injection)`);
  process.exit(0);
}
let rows = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
if (taskFilter) rows = rows.filter(r => r.taskHash === taskFilter);
if (reasonFilter) rows = rows.filter(r => r.reason === reasonFilter);
if (last > 0) rows = rows.slice(-last);

if (has('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const counts = {};
for (const r of rows) counts[r.reason || r.event || '?'] = (counts[r.reason || r.event || '?'] || 0) + 1;
console.log(`audit: ${auditPath}`);
console.log(`entries: ${rows.length}  byReason: ${JSON.stringify(counts)}`);
console.log('---');
console.log('at                       v       model                          purpose     reason                 inj   taskIdx seedHash         taskHash');
for (const r of rows) {
  const at = String(r.at || '').slice(0, 23).padEnd(24);
  const v = String(r.v || '').padEnd(7);
  const model = String(r.model || '').slice(0, 30).padEnd(30);
  const purpose = String(r.purpose ?? '').slice(0, 11).padEnd(11);
  const reason = String(r.reason || r.event || '').slice(0, 22).padEnd(22);
  const inj = (r.injected === true ? 'yes' : r.injected === false ? 'no' : '-').padEnd(5);
  const ti = String(r.taskIndex ?? '').padEnd(7);
  const sh = String(r.seedHash || '').padEnd(16);
  const th = String(r.taskHash || '');
  console.log(`${at} ${v} ${model} ${purpose} ${reason} ${inj} ${ti} ${sh} ${th}`);
}
console.log('---');
console.log("correlate with a session log: match taskHash to the task message; use the");
console.log("dsh-live-session-debug read-session.mjs for the model-visible picture.");