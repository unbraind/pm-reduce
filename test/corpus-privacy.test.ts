import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import { digest, validateReductionCertificate } from '../dist/index.js';
import { runtimeSources } from '../scripts/inventory.ts';
import { mountedHomePaths } from './home-paths.ts';
import { containsPrivateHomePath } from '../dist/src/privacy.js';
/** Bound public citations by repository identity, without accessing a named repository. */
function publicText(text: string) {
  for (const name of ['pm-observer', 'pm-web-hosted', 'pm-gpt']) assert.ok(!new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'i').test(text), 'Corpus contains a private repository reference');
  assert.ok(!containsPrivateHomePath(text), 'Corpus contains an absolute home path');
}
/** Traverse syntax as data; never execute a harvested source during privacy inspection. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) { for (const row of value) walk(row, visit); return; }
  if (value === null || typeof value !== 'object') return; const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) walk(child, visit);
}
/** Recognize direct, computed and optional member capabilities in both guards. */
function calledName(node: Record<string, unknown>): string {
  const callee = node.callee as { name?: string; property?: { name?: string; value?: string } };
  return callee.name ?? callee.property?.name ?? callee.property?.value ?? '';
}
/** Corpus harness reads only the frozen local provenance file and imports reviewed modules. */
function confined(source: string) {
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript'] }); let reads = 0; const readNames = new Set(['readFile', 'readFileSync']);
  const imports = new Set(['zod', 'node:assert/strict', './fixtures/history.ts', 'node:fs/promises', 'node:crypto', '../dist/index.js', '../dist/src/output.js', './helpers.ts']);
  walk(tree, node => {
    if (node.type === 'ImportSpecifier' && ['readFile', 'readFileSync'].includes((node.imported as { name?: string }).name ?? '')) readNames.add((node.local as { name: string }).name);
    if (node.type === 'VariableDeclarator' && readNames.has((node.init as { name?: string } | null)?.name ?? '')) readNames.add((node.id as { name: string }).name);
  });
  walk(tree, node => {
    if (node.type === 'ImportDeclaration') {
      const from = (node.source as { value: string }).value; assert.ok(imports.has(from), 'Unreviewed corpus import');
      if (from === 'node:fs/promises') assert.ok((node.specifiers as { type: string; imported?: { name: string }; local: { name: string } }[]).every(specifier => specifier.type === 'ImportSpecifier' && specifier.imported?.name === 'readFile' && specifier.local.name === 'readFile'), 'Only the reviewed provenance reader may be imported');
    }
    assert.ok(node.type !== 'ImportExpression', 'Dynamic corpus imports are forbidden');
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const name = calledName(node);
      assert.ok(!['fetch', 'eval', 'require', 'execFile', 'execFileSync', 'exec', 'execSync', 'spawn', 'spawnSync', 'fork', 'resolve'].includes(name), 'Unreviewed corpus capability');
      if (readNames.has(name)) { reads++; assert.equal(source.slice(node.start as number, node.end as number), "readFile('test/fixtures/provenance.json', 'utf8')", 'Unreviewed corpus read'); }
    }
  });
  assert.equal(reads, 1);
}
test('public corpus guard confines reads and rejects private citations and source-root mutations', () => {
  for (const path of mountedHomePaths().forbidden) assert.throws(() => publicText(path), /Corpus contains an absolute home path/, 'proof:mounted_corpus');
  for (const path of mountedHomePaths().allowed) assert.doesNotThrow(() => publicText(path), 'proof:corpus_absolute_scope');
  for (const file of ['test/corpus.ts', 'test/fixtures/history.ts', 'test/fixtures/provenance.json', 'docs/real-data-receipt.json']) publicText(readFileSync(file, 'utf8'));
  for (const name of ['pm-observer', 'pm-web-hosted', 'pm-gpt']) { assert.throws(() => publicText(`https://github.com/example/${name}`)); publicText(`${name}-tools`); }
  const source = readFileSync('test/corpus.ts', 'utf8'); confined(source);
  for (const changed of [source.replace('test/fixtures/provenance.json', '../unreviewed/input.json'), source + "\nawait fetch('https://example.invalid');", source + "\nawait import('node:fs');", source.replace("'./fixtures/history.ts'", "'../unreviewed.ts'"), source + "\nimport * as fs from 'node:fs/promises'; await fs.readFile('extra', 'utf8');", source + "\nimport {readFile as load} from 'node:fs/promises'; await load('extra', 'utf8');", source + "\nconst load = readFile; await load('extra', 'utf8');", source + "\nawait globalThis.fetch('https://example.invalid');", source + "\nawait globalThis?.fetch?.('https://example.invalid');"]) assert.throws(() => confined(changed));
});
test('frozen historical excerpts retain exact source and fixture content identities', () => {
  const fixture = readFileSync('test/fixtures/history.ts', 'utf8');
  const provenance = JSON.parse(readFileSync('test/fixtures/provenance.json', 'utf8')) as { fixture_sha256: string; sources: { repository: string; revision: string; license: string; excerpts: { name: string; sha256: string }[]; native_anchor: { item_id: string; item_hash: string; field_pointer: string; description: string; content_digest: string } }[] };
  assert.equal(createHash('sha256').update(fixture).digest('hex'), provenance.fixture_sha256);
  const tree = parse(fixture, { sourceType: 'module', plugins: ['typescript'] });
  const receipts = JSON.parse(readFileSync('docs/real-data-receipt.json', 'utf8')) as { receipts: { reduction_snapshot: Parameters<typeof validateReductionCertificate>[0]; certificate: ReturnType<typeof validateReductionCertificate>; oracle_evidence: {source_ref:{content_digest:string};description:string}[] }[] };
  for (const row of receipts.receipts) { validateReductionCertificate(row.reduction_snapshot, row.certificate); for (const evidence of row.oracle_evidence) assert.equal(evidence.source_ref.content_digest, digest(evidence.description)); }

  for (const source of provenance.sources) { assert.match(source.repository, /^https:\/\/github\.com\/unbraind\/(pm-jev|pm-beads)$/); assert.match(source.revision, /^[a-f0-9]{40}$/); assert.equal(source.license, 'MIT'); assert.match(source.native_anchor.item_hash, /^[a-f0-9]{64}$/); assert.equal(source.native_anchor.field_pointer, '/description'); assert.equal(source.native_anchor.content_digest, digest(source.native_anchor.description));
    for (const excerpt of source.excerpts) { const node = tree.program.body.find(row => row.type === 'FunctionDeclaration' && row.id?.name === excerpt.name); assert.ok(node); assert.equal(createHash('sha256').update(fixture.slice(node.start!, node.end!)).digest('hex'), excerpt.sha256); }
  }
});
/** Inspect production syntax without executing submitted module text. */
function production(source: string) {
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  walk(tree, node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String(node.type)) && node.source) assert.ok(!/^(?:node:)?(?:child_process|fs|https?|http2|net|tls|dgram)(?:\/|$)|sqlite|postgres/u.test((node.source as { value: string }).value), 'Production import is forbidden');
    assert.ok(node.type !== 'ImportExpression', 'Dynamic production imports are forbidden');
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const name = calledName(node);
      assert.ok(!['fetch', 'eval', 'require', 'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].includes(name), 'Production capability is forbidden');
    }
  });
}
test('production has no subprocess, network, payload-file or alternate storage entry points', () => {
  for (const file of runtimeSources()) production(readFileSync(file, 'utf8'));
  for (const source of ["globalThis.fetch('https://example.invalid')", "globalThis['fetch']('https://example.invalid')", "globalThis?.fetch?.('https://example.invalid')", "processModule.spawn('unused')", "processModule.execSync('unused')", "processModule['fork']?.('unused')"]) assert.throws(() => production(source), /Production capability is forbidden/, 'proof:production_guard');
  for (const source of ["await import('node:child_process')", "const cp = await import('node:child_process'); cp.spawn('unused')", "(await import('node:child_process')).exec('unused')"]) assert.throws(() => production(source), /Dynamic production imports are forbidden|Production capability is forbidden/, 'proof:production_guard');
  for (const source of ["import fs from 'fs'", "import fs from 'node:fs/promises'", "import https from 'https'", "export * from 'node:child_process'", "export { readFile } from 'fs/promises'"]) assert.throws(() => production(source), /Production import is forbidden/, 'proof:production_import');
  for (const source of ["import {createHash} from 'node:crypto'", "import {parse} from './schema.ts'", "const value = object.read();", "export { value } from './local.ts'"]) assert.doesNotThrow(() => production(source));
});

test('documented public metrics match the preserved published receipt', () => {
  const receipt = JSON.parse(readFileSync('docs/real-data-receipt.json', 'utf8')) as { receipts: { scenario: string; initial_atoms: number; final_atoms: number; original_bytes: number; reduced_bytes: number; reserved_trials: number; actual_trials: number; outcomes: { target_fail: number; pass: number; unresolved: number }; resumes: number; packet_estimated_tokens: number; raw_estimated_tokens: number; latency_ms: number; packet_bytes: number; manual_log_bytes: number; total_delivered_bytes: number; delivered_results: number; complete_sdk_snapshot_bytes: number; auxiliary_sdk_bytes: number }[] };
  const document = readFileSync('docs/real-data.md', 'utf8');
  for (const row of receipt.receipts) {
    assert.ok(document.includes(`| ${row.scenario} | ${row.initial_atoms} → ${row.final_atoms} | ${row.original_bytes} → ${row.reduced_bytes} | ${row.reserved_trials} / ${row.actual_trials} | ${row.outcomes.target_fail} / ${row.outcomes.pass} / ${row.outcomes.unresolved} | ${row.resumes} | ${row.packet_estimated_tokens} | ${row.raw_estimated_tokens} |`));
    const paragraph = document.split('\n').find(line => line.startsWith(`- [${row.scenario}]`))!;
    for (const text of [`${row.packet_bytes} delivered packet bytes`, `${row.manual_log_bytes} bytes for the complete native owner log`, `${row.total_delivered_bytes} bytes across ${row.delivered_results} results`, `${row.complete_sdk_snapshot_bytes} raw SDK snapshot bytes`, `${row.auxiliary_sdk_bytes} auxiliary SDK bytes`, `${row.latency_ms} ms`]) assert.ok(paragraph.includes(text), `Published metric drift: ${row.scenario} ${text}`);
  }
  assert.ok(!readFileSync('test/real-data.acceptance.ts', 'utf8').includes("writeFile('docs/real-data-receipt.json'"));
});
