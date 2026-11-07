import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { fitOutputEnvelope, OutputEnvelopeFitError, createPmCliExpectedError, writeSettingsSection, readSettingsSection } from '@unbrained/pm-cli/sdk';
import { readFileSync } from 'node:fs';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import extension, { createReduction, readReduction, nextReductionTrial, reductionCertificate, requestReductionTrial, recordReductionOutcome, reductionPacket, envelope, fitEnvelope, ReductionRefusal, digest, exitCode } from '../dist/index.js';
import type { ReductionResult, Host } from '../dist/index.js';
import { runCommand, inputJson } from '../dist/src/commands.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import { refusal, insist } from '../dist/src/errors.js';
import { wire, renderOutput, refusalEnvelope } from '../dist/src/output.js';
import { fixture, definition, outcome, hasCode, runTrial, reserve, historyEvents } from './helpers.ts';
import { mountedHomePaths, homeProbePaths } from './home-paths.ts';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';

/** Exercise the actual registered serializers for every inert pre-write privacy refusal. */
async function assertCliPrivacy(ext: Awaited<ReturnType<typeof createExtensionTestHarness>>, command: string, result: ReductionResult, path: string, proof: string): Promise<void> {
  assert.equal(result.refusal?.code, 'invalid_input', proof);
  for (const format of ['json', 'toon'] as const) {
    const rendered = await ext.runRendererOverride({ format, command: `reduce ${command}`, result }); const text = String(rendered.rendered);
    assert.ok(!text.includes(path), proof); assert.equal((format === 'json' ? JSON.parse(text) : decodeToon(text)).refusal.code, 'invalid_input');
  }
}

test('CLI mounted-home refusals are inert in JSON and TOON and cannot change a non-git tracker', async t => {
  const { host, pmRoot, id, birth, native } = await fixture(t, true, definition(1)); const paths = [mountedHomePaths().forbidden[0], ...homeProbePaths()];
  const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  const pending = await reserve(host); const snapshot = await readReduction(host, id); const events = await historyEvents(pmRoot, id);
  for (const [index, path] of paths.entries()) for (const command of ['create', 'record']) {
    const options = command === 'create' ? { id: 'corpus-mounted', op: 'birth', input: JSON.stringify({ title: 'Public', definition: { ...birth.definition, atoms: birth.definition.atoms.map(atom => ({ ...atom, label: path })) } }) } : { op: 'mounted', revision: snapshot.revision, request: pending.receipt.result.identity, input: JSON.stringify(outcome(birth.definition, pending.candidate.subset_digest, 'target_fail', { reason: path })) };
    const ran = await ext.runCommand({ command: `reduce ${command}`, args: command === 'create' ? [] : [id], options, pmRoot }); if (ran.cause) throw ran.cause;
    await assertCliPrivacy(ext, command, ran.result as ReductionResult, path, index === 0 ? 'proof:mounted_cli' : 'proof:home_cli_boundaries');
  }
  await assert.rejects(native.get('corpus-mounted'), hasCode('item_not_found')); assert.equal((await readReduction(host, id)).revision, snapshot.revision); assert.equal(await historyEvents(pmRoot, id), events);
});

test('native harness contracts dispatch all six commands and scoped renderers through the same SDK', async t => {
  const { pmRoot } = await fixture(t); const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  for (const name of ['create', 'next', 'request', 'record', 'certificate', 'packet']) ext.assertCommandContract({ command: `reduce ${name}` }); ext.assertItemField({ name: 'reduce_state', type: 'object' }); ext.assertItemType({ name: 'Reduction', folder: 'reductions' });
  const run = async (command: string, args: string[] = ['corpus-cli'], options: Record<string, unknown> = {}, global: Record<string, unknown> = {}) => { const value = await ext.runCommand({ command: `reduce ${command}`, args, options, global, pmRoot }); if (value.cause) throw value.cause; return value.result as ReductionResult; };
  const def = definition(1); const birth = await run('create', [], { id: 'corpus-cli', op: 'birth', input: JSON.stringify({ title: 'CLI reduction', definition: def }) }); assert.equal(birth.ok, true);
  let next = await run('next');
  for (let at = 0; at < 2; at++) {
    assert.ok(next.data && 'candidate' in next.data);
    const request = await run('request', undefined, { op: `request-${at}`, revision: next.revision, proposal: next.data!.proposal_digest }); assert.equal(request.ok, true); assert.ok(request.data && 'result' in request.data);
    const candidate = next.data!.candidate as { subset_digest: string }; const result = request.data!.result as { identity: string };
    const record = await run('record', undefined, { op: `record-${at}`, revision: request.revision, request: result.identity, input: JSON.stringify(outcome(def, candidate.subset_digest, at === 0 ? 'target_fail' : 'pass')) }); assert.equal(record.ok, true); next = await run('next');
  }
  assert.equal((await run('certificate')).ok, true);
  const page = await run('packet', undefined, { limit: '1' }); assert.ok(page.next_cursor);
  assert.equal((await run('packet', undefined, { limit: '1', cursor: page.next_cursor })).ok, true);
  assert.equal((await run('packet', undefined, { limit: '1' }, { outputCursor: page.next_cursor })).ok, true);
  for (const format of ['json', 'toon'] as const) { ext.assertRendererOverride({ format }); const rendered = await ext.runRendererOverride({ format, command: 'reduce packet', result: page }); assert.deepEqual(format === 'json' ? JSON.parse(String(rendered.rendered)) : decodeToon(String(rendered.rendered)), page); }
  for (const [command, options, global] of [
    ['packet', { cursor: page.next_cursor }, { outputCursor: page.next_cursor }], ['packet', { limit: '1' }, { outputLimit: '1' }], ['packet', { budget: '1600' }, { outputBudget: '1600' }],
    ['packet', { limit: '1.5' }, {}], ['packet', { limit: '101' }, {}], ['packet', {}, { outputBudget: [] }], ['packet', {}, { outputBudget: 0 }], ['packet', {}, { outputBudget: '99999999999999999999' }], ['packet', {}, { outputBudget: '1.5' }],
    ['packet', {}, { outputInclude: 'id' }], ['packet', {}, { outputSession: 'x' }], ['packet', {}, { outputRowContract: 'x' }], ['next', {}, { outputCursor: 'x' }], ['next', {}, { outputLimit: '1' }],
    ['create', { id: 'corpus-bad', op: 'bad', input: '{"id":"overridden"}' }, {}], ['record', { op: 'bad', revision: [], input: '{}' }, {}], ['request', { op: 'bad', proposal: '' }, {}],
  ] as const) { const result = await run(command, undefined, options, global); assert.equal(result.ok, false); assert.equal(result.refusal?.code, 'invalid_input'); }
  assert.equal((await run('packet', undefined, {}, { outputBudget: 'unbounded', outputLimit: '1' })).ok, true); assert.equal((await run('packet', undefined, { budget: '1600' })).ok, true);
  assert.equal((await runCommand('packet', { command: 'reduce packet', args: [], options: {}, global: {}, pm_root: pmRoot } as CommandHandlerContext) as ReductionResult).refusal?.code, 'backend_unsupported');
});
test('structured input rejects malformed UTF-8, scalar JSON, oversized and ambiguous values', async () => {
  async function* stream(data: Uint8Array) { yield data; }
  assert.deepEqual(await inputJson('-', stream(Buffer.from('{"safe":"é"}'))), { safe: 'é' });
  for (const text of ['{', 'null', '[]', '"scalar"', 'x'.repeat(262145)]) await assert.rejects(inputJson(text), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.from([255]))), hasCode('invalid_input'), 'proof:fatal_utf8');
  await assert.rejects(inputJson('-', stream(Buffer.concat([Buffer.from('{"safe":"'), Buffer.from([255]), Buffer.from('"}')]))), hasCode('invalid_input'), 'proof:fatal_utf8'); await assert.rejects(inputJson('-', stream(Buffer.alloc(262145))), hasCode('invalid_input'));
});
test('schema ownership, directory routing and native field preservation are explicit', async t => {
  const { native, host, id, birth, pmRoot } = await fixture(t); const port = persistedSchemaPort(native);
  await port.update(id, { description: 'Peer context stays intact' });
  for (const fields of [[], ['other=x'], ['reduce_state={'], ['reduce_state=null'], ['reduce_state=[]'], ['reduce_state=1'], ['reduce_state=true'], ['reduce_state="scalar"']]) await assert.rejects(port.update(id, { field: fields }), hasCode('invalid_input'), 'proof:adapter_json');
  await assert.rejects(port.create()); await native.create({ id: 'corpus-peer', title: 'Peer', type: 'Task' }); await assert.rejects(readReduction(host, 'corpus-peer'), hasCode('invalid_record'));
  await assert.rejects(createReduction(host, { ...birth, id: 'corpus-peer' }), hasCode('invalid_record'));
  const bare = { ...host, normalizeId: undefined, idPrefix: 'corpus', prepareCreate: undefined, fitOutputEnvelope: undefined }; await createReduction(bare, { ...birth, id: 'corpus-bare', related: ['corpus-peer'] });
  await assert.rejects(createReduction(host, { ...birth, id: 'corpus-missing-link', related: ['corpus-missing'] }));
  await native.schemaRemoveType('Reduction'); await native.schemaAddType('Reduction', { folder: 'peer', description: 'Peer type' }); await assert.rejects(createReduction(host, { ...birth, id: 'corpus-collision' }), hasCode('invalid_record'));
  const fresh = await fixture(t, false); const dynamic = persistedSchemaPort(fresh.native, true); const created = await dynamic.create({ id: 'corpus-route', title: 'Native', type: 'Task' }); await dynamic.update(created.item.id, { description: 'Native route' });
  const got = await dynamic.get(created.item.id, { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in got); assert.equal(got.item.description, 'Native route');
  const client = new PmClient({ pmRoot, noExtensions: true }); assert.ok(client);
});
test('settings validation and unavailable schemas refuse without domain writes', async t => {
  const { native, pmRoot, id } = await fixture(t, false);
  const context = (value: unknown): CommandHandlerContext => ({ command: 'reduce packet', args: [id], options: {}, global: {}, pm_root: pmRoot, sdk: { client: native, fitOutputEnvelope, readSettingsSection: async () => ({ value }) } } as unknown as CommandHandlerContext);
  assert.equal((await runCommand('unknown', context(undefined)) as ReductionResult).refusal?.code, 'invalid_input');
  for (const value of [null, [], { unknown: true }, { output_budget: 0 }]) assert.equal((await runCommand('packet', context(value)) as ReductionResult).ok, false);
  assert.equal((await runCommand('packet', context({ output_budget: 1600 })) as ReductionResult).refusal?.code, 'not_found');
  await native.schemaAddField('reduce_state', { type: 'string', description: 'Peer incompatible field' });
  assert.equal((await runCommand('packet', context(undefined)) as ReductionResult).refusal?.code, 'invalid_record');
});
test('documented settings budget endpoints match real stored CLI policy without side effects', async t => {
  const paragraph = readFileSync('README.md', 'utf8').split('\n').find(line => line.startsWith('Settings section'))!;
  assert.match(paragraph, /`1\.\.8192`/u, 'proof:settings_range_docs');
  const { pmRoot, id } = await fixture(t, true, definition(1));
  const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  for (const budget of [0, 1, 1600, 8192, 8193, -1, 1.5]) {
    await writeSettingsSection(pmRoot, 'reduce', { output_budget: budget }, { author: 'fixture' });
    const settings = await readSettingsSection(pmRoot, 'reduce'); const events = await historyEvents(pmRoot, id);
    for (const command of ['next', 'certificate', 'packet']) {
      const ran = await ext.runCommand({ command: `reduce ${command}`, args: [id], pmRoot }); if (ran.cause) throw ran.cause;
      const result = ran.result as ReductionResult;
      assert.equal(result.ok, budget === 1600 || budget === 8192, 'proof:settings_range');
      if (!result.ok) assert.equal(result.refusal?.code, budget === 1 ? 'output_budget' : 'invalid_input', 'proof:settings_range');
    }
    assert.equal((await readSettingsSection(pmRoot, 'reduce')).revision, settings.revision); assert.equal(await historyEvents(pmRoot, id), events);
  }
});
test('exact fitting provides usable minimums, hard ceilings and fail-closed host capability errors', async t => {
  const { host, id } = await fixture(t); const value = envelope(await reductionPacket(host, { id })); const fitted = fitEnvelope(host, value); assert.ok(fitted.output_fit.estimated_tokens <= 1600);
  assert.deepEqual(JSON.parse(wire(fitted, 'json')), decodeToon(wire(fitted, 'toon')));
  for (const budget of [0, -1, 8193, 1.5]) assert.throws(() => fitEnvelope(host, value, budget), hasCode('invalid_input'));
  let minimum = 0; try { fitEnvelope({}, value, 1); } catch (error) { assert.ok(error instanceof ReductionRefusal); minimum = Number(error.details.minimum_usable_budget); } assert.ok(minimum > 1); fitEnvelope({}, value, minimum);
  assert.throws(() => fitEnvelope({}, { ...value, warnings: ['x'.repeat(40000)] }, 8192), hasCode('output_budget'));
  const denied: typeof fitOutputEnvelope = () => { throw new ReductionRefusal('permission_denied', 'Host denied fitting'); }; assert.throws(() => fitEnvelope({ fitOutputEnvelope: denied }, value), hasCode('permission_denied'));
  const fault = (mode: 'missing' | 'stuck' | 'deny' | 'short'): typeof fitOutputEnvelope => {
    let count = 0; return (...args) => { count++; try { return fitOutputEnvelope(...args); } catch (error) { assert.ok(error instanceof OutputEnvelopeFitError); if (mode === 'deny' && count > 1) throw new ReductionRefusal('permission_denied', 'Host denied retry'); Object.defineProperty(error, 'minimum_tokens', { value: mode === 'missing' ? undefined : mode === 'stuck' || count === 1 ? 1 : error.minimum_tokens }); throw error; } };
  };
  for (const mode of ['missing', 'stuck'] as const) assert.throws(() => fitEnvelope({ fitOutputEnvelope: fault(mode) }, value, 1), hasCode('backend_unsupported'));
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: fault('deny') }, value, 1), hasCode('permission_denied'));
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: fault('short') }, value, 1), hasCode('output_budget'));
});

test('SDK fitter failures stay typed on every read, initial probe and minimum-budget retry', async t => {
  const { host, id } = await fixture(t); const value = envelope(await reductionPacket(host, { id }));
  for (const phase of ['initial', 'retry']) for (const read of [nextReductionTrial, reductionCertificate, reductionPacket]) {
    let calls = 0; const fitter: typeof fitOutputEnvelope = (...args) => { if (++calls === 1 && phase === 'retry') return fitOutputEnvelope(...args); throw new Error('sensitive host diagnostics'); }; const broken = { ...host, fitOutputEnvelope: fitter };
    await assert.rejects(read(broken, { id, budget: phase === 'retry' ? 1 : 1600 }), error => error instanceof ReductionRefusal && error.code === 'output_unavailable' && error.retryable && exitCode(error.code) === 5 && !error.message.includes('sensitive'), 'proof:sdk_fitter_read');
  }
  const native = createPmCliExpectedError('not reflected', { exitCode: 5, context: { code: 'outcome_unknown' } });
  for (const error of [native, createPmCliExpectedError('not reflected', { exitCode: 5, context: { code: 'permission_denied' } }), new ReductionRefusal('permission_denied', 'Explicit host policy')]) assert.throws(() => fitEnvelope({ fitOutputEnvelope: () => { throw error; } }, value), found => found instanceof ReductionRefusal && found.code === error.code);
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: () => undefined as never }, value), hasCode('output_unavailable'), 'proof:sdk_fitter_read');
  const broken = { fitOutputEnvelope: () => { throw new Error('untrusted host diagnostics'); } };
  assert.throws(() => fitEnvelope(broken, { ...value, operation_id: 'untrusted-mirror' }), hasCode('output_unavailable'), 'proof:sdk_fitter_read');
  assert.throws(() => fitEnvelope(broken, refusalEnvelope(new ReductionRefusal('invalid_input', 'Refused'))), hasCode('output_unavailable'));
});

test('SDK mutation fitter failures preserve pre-write refusal and post-write same-key recovery', async t => {
  const { host, birth, id, pmRoot, native } = await fixture(t, true, definition(1));
  const mutation = envelope(await createReduction(host, birth)); const { operation_id, ...withoutMirror } = mutation; void operation_id;
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: () => { throw new Error('untrusted'); } }, withoutMirror), hasCode('outcome_unknown'), 'proof:sdk_fitter_mutation');
  /** Fail the selected measurement boundary while leaving real native storage intact. */
  const broken = (phase: number): Host => { let calls = 0; return { ...host, fitOutputEnvelope: (...args) => { if (++calls === phase) throw new Error('sensitive host diagnostics'); return fitOutputEnvelope(...args); } }; };
  for (const phase of [1, 2]) {
    const input = { ...birth, id: `corpus-fitter-${phase}` };
    await assert.rejects(createReduction(broken(phase), input), hasCode('outcome_unknown'), 'proof:sdk_fitter_mutation');
    if (phase === 1) await assert.rejects(native.get(input.id), hasCode('item_not_found'));
    else assert.equal((await createReduction(host, input)).replayed, true);
  }
  const next = await nextReductionTrial(host, { id }); const request = { id, op: 'fitter-request', revision: next.revision, proposal: next.proposal_digest! }; const events = await historyEvents(pmRoot, id);
  await assert.rejects(requestReductionTrial(broken(1), request), hasCode('outcome_unknown')); assert.equal(await historyEvents(pmRoot, id), events);
  await assert.rejects(requestReductionTrial(broken(2), request), hasCode('outcome_unknown')); const requested = await requestReductionTrial(host, request); assert.equal(requested.replayed, true);
  const record = { id, op: 'fitter-record', revision: requested.revision, request: requested.result.identity, outcome: outcome(birth.definition, next.candidate!.subset_digest) }; const reservedEvents = await historyEvents(pmRoot, id);
  await assert.rejects(recordReductionOutcome(broken(1), record), hasCode('outcome_unknown')); assert.equal(await historyEvents(pmRoot, id), reservedEvents);
  await assert.rejects(recordReductionOutcome(broken(2), record), hasCode('outcome_unknown')); assert.equal((await recordReductionOutcome(host, record)).replayed, true);
});
test('refusal mapping and rendering never emit raw exceptions or active control sequences', () => {
  for (const [code, expected] of [['not_found', 3], ['revision_conflict', 4], ['operation_conflict', 4], ['stale_cursor', 4], ['stale_proposal', 4], ['backend_unsupported', 5], ['permission_denied', 5], ['incomplete_read', 5], ['outcome_unknown', 5], ['output_unavailable', 5], ['invalid_input', 2]] as const) assert.equal(exitCode(code), expected);
  assert.equal(exitCode('stale_revision', 4), 4);
  assert.equal(refusal(new Error('untrusted sensitive content')).code, 'outcome_unknown');
  const expected = createPmCliExpectedError('not reflected', { exitCode: 4, context: { code: 'item_revision_conflict', required: 'Reread' } }); assert.equal(refusal(expected).code, 'revision_conflict'); assert.match(refusal(expected).remedy, /original operation key/); Object.assign(expected, { remedy: '/' + ['home','example','private'].join('/') }); assert.match(refusal(expected).remedy, /original operation key/); assert.ok(!refusal(expected).remedy.includes('private'));
  assert.equal(refusal(createPmCliExpectedError('safe', { context: { code: 'permission_denied' } })).code, 'permission_denied');
  assert.equal(refusalEnvelope(new ReductionRefusal('not_found', 'Missing')).exit_code, 3); assert.throws(() => insist(false, 'invalid_input', 'Refused', 'Review', { count: 1 }), hasCode('invalid_input'));
  for (const value of [null, 'data', {}, { read_output: {} }]) assert.ok(renderOutput(value, 'json').endsWith('\n'));
  for (const value of [{ output_budget_exceeded: {} }, { read_output: { strings_compacted: true } }, { read_output: { rows_compacted: true } }, { read_output: { result_omitted: true } }]) assert.equal(JSON.parse(renderOutput(value, 'json')).refusal.code, 'output_budget');
  assert.equal(JSON.parse(renderOutput({ huge: 'x'.repeat(40000) }, 'json')).refusal.code, 'output_budget');
  for (const format of ['json', 'toon'] as const) { const value = { text: '\u001b[31m\u0085\u202e', rows: ['\u0085', '\u202e'] }; const rendered = wire(value, format); assert.ok(!/[\u001b\u0085\u202e]/u.test(rendered), 'proof:inert_roundtrip'); assert.deepEqual(format === 'json' ? JSON.parse(rendered) : decodeToon(rendered), value, 'proof:inert_roundtrip'); }
});

test('creation identity policy and failing fitter refuse safely before effects', async t => {
  const { host, native, birth, pmRoot } = await fixture(t);
  const bare = { ...host, normalizeId: undefined };
  await assert.rejects(createReduction(bare, { ...birth, id: 'unprefixed' }), hasCode('backend_unsupported'), 'proof:identity_policy');
  const explicit = { ...bare, idPrefix: 'corpus' };
  const created = await createReduction(explicit, { ...birth, id: 'canonical' });
  assert.equal((await readReduction(explicit, created.owner_id)).id, 'corpus-canonical', 'proof:identity_policy');
  const methodHost: Host = { ...host, normalizeId: async function (id: string) { assert.ok(this === methodHost); return host.normalizeId!(id); } };
  await assert.doesNotReject(() => createReduction(methodHost, { ...birth, id: 'method-owner' }), 'proof:normalizer_binding');
  const canonical = await createReduction(explicit, { ...birth, id: 'corpus-already' }); assert.equal((await readReduction(explicit, canonical.owner_id)).id, 'corpus-already');
  const context = { command: 'reduce packet', args: [birth.id], options: {}, global: {}, pm_root: pmRoot, sdk: { client: native, readSettingsSection: async () => ({ value: undefined }), fitOutputEnvelope: () => { throw new Error('fitter unavailable'); } } } as unknown as CommandHandlerContext;
  let result!: ReductionResult; await assert.doesNotReject(async () => { result = await runCommand('packet', context) as ReductionResult; }, 'proof:fitter_fallback');
  assert.equal(result.ok, false, 'proof:fitter_fallback'); assert.equal(result.refusal?.code, 'outcome_unknown'); assert.ok(Buffer.byteLength(wire(result, 'json')) < 6400);
  context.sdk!.fitOutputEnvelope = () => { throw new ReductionRefusal('permission_denied', 'x'.repeat(40000)); }; const bounded = await runCommand('packet', context) as ReductionResult; assert.equal(bounded.refusal?.code, 'outcome_unknown'); assert.ok(Buffer.byteLength(wire(bounded, 'json')) < 6400);
  const stale = refusal(createPmCliExpectedError('safe', { exitCode: 4, context: { code: 'stale_revision' } })); assert.equal(refusalEnvelope(stale).exit_code, 4, 'proof:native_exit'); assert.equal(stale.retryable, true);
});
