/** Test-only OS writer and crash injector; no package command starts this process. */
import { createDirectoryHost, requestReductionTrial, createReduction, recordReductionOutcome } from '../dist/index.js';
import type { RequestTrialInput, CreateReductionInput, RecordOutcomeInput } from '../dist/index.js';
const [pmRoot, mode, serialized, crash] = process.argv.slice(2); const host = createDirectoryHost(pmRoot, 'os-writer');
host.boundary = async step => { if (step === crash) process.exit(79); };
try {
  const input = JSON.parse(serialized) as unknown;
  const receipt = mode === 'create' ? await createReduction(host, input as CreateReductionInput) : mode === 'record' ? await recordReductionOutcome(host, input as RecordOutcomeInput) : await requestReductionTrial(host, input as RequestTrialInput);
  console.log(JSON.stringify({ ok: true, receipt }));
} catch (error) { const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined; console.log(JSON.stringify({ ok: false, code, ...(code === undefined ? { name: error instanceof Error ? error.name : 'ThrownValue', message: error instanceof Error ? error.message : String(error) } : {}) })); }
