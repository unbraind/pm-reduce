import { readSettings, normalizeItemId } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { createReduction, nextReductionTrial, requestReductionTrial, recordReductionOutcome, reductionCertificate, reductionPacket } from './api.ts';
import { parse, CreateReductionInputSchema, RecordOutcomeInputSchema } from './schema.ts';
import { persistedSchemaPort } from './host.ts';
import type { Host } from './host.ts';
import { insist, refusal, ReductionRefusal } from './errors.ts';
import { envelope, fitEnvelope, refusalEnvelope, renderOutput } from './output.ts';
import type { Data } from './output.ts';
/** Refuse empty or repeated guard values at the CLI boundary. */
function scalar(value: unknown): string { insist(typeof value === 'string' && value.trim().length > 0, 'invalid_input', 'A required scalar option is missing'); return value; }
/** Strict positive numeric flag decoder. */
function integer(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  insist((typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'invalid_input', 'Output control must be a positive integer'); return Number(value);
}
/** Bounded fatal UTF-8 ingestion; structured data is never executed or read from an arbitrary file. */
export async function inputJson(value: unknown, source: AsyncIterable<Uint8Array> = process.stdin): Promise<Record<string, unknown>> {
  let text = scalar(value);
  if (text === '-') {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of source) { const data = Buffer.from(chunk); bytes += data.length; insist(bytes <= 262144, 'invalid_input', 'Input exceeds 256 KiB'); chunks.push(data); }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new ReductionRefusal('invalid_input', 'Malformed UTF-8 JSON'); }
  }
  insist(Buffer.byteLength(text) <= 262144, 'invalid_input', 'Input exceeds 256 KiB'); let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch { throw new ReductionRefusal('invalid_input', 'Malformed JSON'); }
  insist(data !== null && typeof data === 'object' && !Array.isArray(data), 'invalid_input', 'Input must be a strict JSON object'); return data as Record<string, unknown>;
}
/** Native CLI dispatch shares the exact typed SDK mutation and read paths. */
export async function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown> {
  try {
    insist(ctx.sdk !== undefined, 'backend_unsupported', 'Host did not supply a native SDK client', 'Use pm-cli 2026.11.5 or a conforming authorized host');
    const persisted = (await ctx.sdk.client.schemaListFields()).fields.find(field => field.key === 'reduce_state');
    insist(persisted === undefined || persisted.type === 'object', 'invalid_record', 'reduce_state has an incompatible schema');
    const host: Host = { client: persisted ? persistedSchemaPort(ctx.sdk.client) : ctx.sdk.client, fitOutputEnvelope: ctx.sdk.fitOutputEnvelope, capabilities: { native_item_cas: true, create_if_absent: true, provider: 'directory-host' }, normalizeId: async id => normalizeItemId(id, (await readSettings(ctx.pm_root)).id_prefix) };
    const settings = (await ctx.sdk.readSettingsSection('reduce')).value;
    insist(settings === undefined || (settings !== null && typeof settings === 'object' && !Array.isArray(settings) && Object.keys(settings).every(key => key === 'output_budget')), 'invalid_record', 'Unsupported package settings');
    const policy = settings as { output_budget?: unknown } | undefined; const flags = ctx.options;
    insist(ctx.global.outputInclude === undefined && ctx.global.outputSession === undefined && ctx.global.outputRowContract === undefined, 'invalid_input', 'Generic projection would omit reduction witnesses', 'Use reduce packet --limit');
    insist(flags.budget === undefined || ctx.global.outputBudget === undefined, 'invalid_input', 'Choose one budget transport');
    const requestedBudget = flags.budget === undefined ? ctx.global.outputBudget : flags.budget;
    const budget = requestedBudget === 'unbounded' ? 8192 : integer(requestedBudget, integer(policy?.output_budget, 1600));
    insist(command === 'packet' || (ctx.global.outputCursor === undefined && ctx.global.outputLimit === undefined), 'invalid_input', 'Pagination applies only to reduce packet');
    insist(flags.cursor === undefined || ctx.global.outputCursor === undefined, 'invalid_input', 'Choose one continuation transport', 'Use package --cursor');
    insist(flags.limit === undefined || ctx.global.outputLimit === undefined, 'invalid_input', 'Choose one limit transport');
    const id = await host.normalizeId!(command === 'create' ? scalar(flags.id) : scalar(ctx.args[0])); let data: Data;
    if (command === 'create' || command === 'record') {
      const raw = await inputJson(flags.input); insist(!Object.keys(raw).some(key => ['id', 'op', 'revision', 'budget', 'request'].includes(key)), 'invalid_input', 'Use explicit identity and guard flags');
      const op = scalar(flags.op);
      if (command === 'create') data = await createReduction(host, parse(CreateReductionInputSchema, { ...raw, id, op, budget }));
      else data = await recordReductionOutcome(host, parse(RecordOutcomeInputSchema, { outcome: raw, id, op, revision: scalar(flags.revision), request: scalar(flags.request), budget }));
    } else if (command === 'request') data = await requestReductionTrial(host, { id, op: scalar(flags.op), revision: scalar(flags.revision), proposal: scalar(flags.proposal), budget });
    else if (command === 'next') data = await nextReductionTrial(host, { id, budget });
    else if (command === 'certificate') data = await reductionCertificate(host, { id, budget });
    else { insist(command === 'packet', 'invalid_input', 'Unknown reduce command'); data = await reductionPacket(host, { id, budget, limit: integer(ctx.global.outputLimit ?? flags.limit, 20), cursor: flags.cursor === undefined ? ctx.global.outputCursor : scalar(flags.cursor) }); }
    return fitEnvelope(host, envelope(data), budget);
  } catch (error) {
    const value = refusalEnvelope(refusal(error));
    try { return fitEnvelope({ fitOutputEnvelope: ctx.sdk?.fitOutputEnvelope }, value, 1600); } catch { return refusalEnvelope(new ReductionRefusal('outcome_unknown', 'Host refusal fitting failed', 'Reconcile the original operation key on a conforming host')); }
  }
}
/** Contribute schema and command contracts without durable activation side effects. */
export function register(api: ExtensionApi): void {
  api.registerItemTypes([{ name: 'Reduction', folder: 'reductions', description: 'Durable ordered-subset failure reduction' }]);
  api.registerItemFields([{ name: 'reduce_state', type: 'object', optional: true }]);
  const definitions = [
    ['create', [], ['id', 'input', 'op'], 'Freeze atoms, oracle and trial budget', 'pm reduce create --id repro --op birth --input -'],
    ['next', ['id'], [], 'Propose the exact next subset without execution', 'pm reduce next repro'],
    ['request', ['id'], ['proposal', 'revision', 'op'], 'Reserve one exact trial before external execution', 'pm reduce request repro --proposal <digest> --revision <hash> --op trial'],
    ['record', ['id'], ['request', 'input', 'revision', 'op'], 'Retain an exact externally observed oracle outcome', 'pm reduce record repro --request trial-1 --revision <hash> --op observed --input -'],
    ['certificate', ['id'], [], 'Check qualified single-deletion minimality', 'pm reduce certificate repro'],
    ['packet', ['id'], ['limit', 'cursor'], 'Read bounded resumable trial context', 'pm reduce packet repro --limit 10'],
  ] as const;
  for (const format of ['json', 'toon'] as const) api.registerRenderer(format, ctx => renderOutput(ctx.result, format).trimEnd(), { commands: definitions.map(([name]) => `reduce ${name}`) });
  for (const [name, args, names, description, example] of definitions) {
    const flags: FlagDefinition[] = [...names, 'budget'].map(flag => ({ long: `--${flag}`, value_type: 'string', value_name: flag, description: `${flag}; ${example}` }));
    api.registerCommand(defineCommand({ ...(['next', 'certificate', 'packet'].includes(name) ? { read_output: { row_keys: [] } } : {}), name: `reduce ${name}`, description, intent: 'Retain exact reduction trials and qualified evidence across context resets', arguments: args.map(arg => ({ name: arg, required: true, description: 'Authorized reduction owner' })), flags, examples: [example], run: ctx => runCommand(name, ctx) }));
  }
}
