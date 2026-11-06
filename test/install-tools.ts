import assert from 'node:assert/strict';

/** Explain missing acceptance prerequisites without treating absent runtime proof as a pass. */
export function packedRequirement(platform: NodeJS.Platform, tools?: readonly string[]): string | null {
  if (platform === 'win32') return 'Packed release acceptance requires POSIX, bash and Bun; run it on Linux or macOS';
  if (tools !== undefined) for (const tool of ['bun', 'npm', 'npx']) if (!tools.includes(tool)) return `Packed release acceptance requires ${tool} on PATH and a working bash; install the required tools before running release:check`;
  return null;
}

/** Package budgets must reach package admission; native budgets may fail in the host. */
export function assertBudgetRefusal(flag: string, result: { refusal?: { code?: string }; code?: unknown }): void {
  if (flag === '--budget') assert.equal(result.refusal?.code, 'output_budget', 'proof:package_budget');
  else assert.ok(result.refusal?.code === 'output_budget' || typeof result.code === 'string');
}
