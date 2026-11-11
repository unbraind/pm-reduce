/** Rebuild public proof receipts without reading any external repository or tracker. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createDirectoryHost } from '../dist/index.js';
import { scenarios, reproduce } from './corpus.ts';
const root = await mkdtemp(join(tmpdir(), 'reduce-public-'));
try {
  const receipts = [];
  const pmRoot = join(root, 'tracker'); const native = new PmClient({ pmRoot, cwd: root, author: 'public-proof', noExtensions: true }); await native.init('public', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  for (const name of scenarios) receipts.push(await reproduce(createDirectoryHost(pmRoot, 'public-proof'), `public-${name}`, name));
  await writeFile('real-data-receipt.local.json', JSON.stringify({ schema_version: 1, evidence: 'reported_oracle', receipts }, null, 2) + '\n');
  console.log(JSON.stringify(receipts.map(({ journal, oracle_evidence, reduction_snapshot, certificate, ...summary }) => { void journal; void oracle_evidence; void reduction_snapshot; void certificate; return summary; }), null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
