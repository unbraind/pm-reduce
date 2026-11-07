import assert from 'node:assert/strict';

/** Check captures against the active setup and gate in their own workflow job. */
export function assertAcceptanceRuntimes(workflow: string, gateCommand: string): void {
  const required = new Map([['22', '22.19.0'], ['26', '26.13.0']]); let inJobs = false; let active: string | null = null; let setupStep = false; let gates = 0; const captured = new Set<string>();
  for (const line of workflow.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    if (/^\S/u.test(line)) inJobs = line === 'jobs:';
    if (!inJobs) continue;
    if (/^ {2}\S[^:]*:/u.test(line)) { captured.clear(); active = null; setupStep = false; }
    if (/^ {6}- /u.test(line)) setupStep = false;
    if (/^\s+(?:- )?uses: actions\/setup-node@/u.test(line)) { setupStep = true; active = null; }
    const version = line.match(/^\s+node-version:\s*(.+)$/u); if (setupStep && version) active = version[1].trim();
    const capture = line.match(/^\s+(?:- )?run: echo "PM_REDUCE_NODE_(22|26)=\$\(command -v node\)" >> "\$GITHUB_ENV"$/u);
    if (capture) { assert.ok(active === required.get(capture[1]) && !captured.has(capture[1]), 'proof:release_runtimes'); captured.add(capture[1]); }
    if (line.trim().replace(/^- /u, '') === `run: ${gateCommand}`) { assert.equal(captured.size, required.size, 'proof:release_runtimes'); gates++; }
  }
  assert.ok(gates > 0, 'proof:release_runtimes');
}
