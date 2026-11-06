import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, existsSync, unlinkSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { npmEnvironment } from '../scripts/environment.ts';
import { definition, outcome } from './helpers.ts';
import { packedRequirement } from './install-tools.ts';
/** Run a credential-free consumer command and preserve only bounded diagnostics. */
function execute(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string, expected = 0): string {
  const result = spawnSync(executable, args, { cwd, env, input, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, expected, `${executable} ${args.slice(0, 4).join(' ')}: ${result.stderr.slice(-1500)} ${result.stdout.slice(-1500)}`); return result.stdout || result.stderr;
}
test('one captured artifact supports npm Bun npx bunx and SDK with Git absent', () => {
  assert.equal(packedRequirement(process.platform), null, packedRequirement(process.platform) ?? '');
  const tools = new Map(['bun', 'npm', 'npx'].flatMap(name => {
    const found = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8', env: npmEnvironment(process.env) });
    return found.status === 0 && found.stdout.trim() !== '' ? [[name, found.stdout.trim()] as const] : [];
  }));
  assert.equal(packedRequirement(process.platform, [...tools.keys()]), null, packedRequirement(process.platform, [...tools.keys()]) ?? '');
  const root = mkdtempSync(join(tmpdir(), 'reduce-packed-')); const env = npmEnvironment(process.env); delete env.NODE_V8_COVERAGE;
  try {
    const packed = JSON.parse(execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd(), env)) as { filename: string; files: { path: string }[] }[];
    const archive = join(root, packed[0].filename); const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const bin = join(root, 'bin'); mkdirSync(bin); const bun = tools.get('bun')!;
    for (const [name, target] of [['sh', '/bin/sh'], ['node', process.execPath], ['bun', bun], ['bunx', bun]]) symlinkSync(target, join(bin, name));
    for (const name of ['npm', 'npx']) symlinkSync(tools.get(name)!, join(bin, name));
    const journeys: { manager: string; commands: number; runtime: string }[] = [];
    for (const manager of ['npm', 'bun']) {
      const cwd = join(root, manager); mkdirSync(cwd); writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'reduce-consumer', version: '1.0.0', private: true, type: 'module' }));
      execute(manager, manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive, '@unbrained/pm-cli@2026.11.5'] : ['add', '--ignore-scripts', archive, '@unbrained/pm-cli@2026.11.5'], cwd, env);
      const safe = { ...env, PM_PATH: join(cwd, '.agents/pm'), PM_AUTHOR: 'consumer', PATH: bin, GIT_CEILING_DIRECTORIES: root, HOME: join(root, 'isolated-home') }; mkdirSync(safe.HOME, { recursive: true });
      const runner = manager === 'npm' ? 'npx' : 'bunx'; const prefix = manager === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm']; let commands = 0;
      /** Native consumer launcher with a PATH that cannot resolve Git. */
      const run = (args: string[], input?: string, expected = 0) => { commands++; return execute(runner, [...prefix, ...args], cwd, safe, input, expected); };
      run(['init', 'packed', '--defaults', '--agent-guidance', 'skip', '--no-merge-fence']); run(['package', 'install', './node_modules/pm-reduce']); run(['reduce', '--help']);
      assert.ok(JSON.parse(run(['contracts', '--json', '--output-budget', 'unbounded'])));
      const def = definition(1); const birthInput = JSON.stringify({ title: 'Public reproduction', definition: def });
      const birth = JSON.parse(run(['reduce', 'create', '--id', 'packed-repro', '--op', 'birth', '--input', '-', '--json'], birthInput)); assert.equal(birth.ok, true);
      assert.equal(JSON.parse(run(['reduce','create','--id','packed-repro','--op','birth','--input','-','--json'],birthInput)).replayed,true);
      let next = JSON.parse(run(['reduce','next','packed-repro','--json'])); assert.equal(next.data.candidate.purpose,'baseline');
      const staleRevision = next.revision;
      for (let index=0;index<2;index++) {
        const requested = JSON.parse(run(['reduce','request','packed-repro','--op',`request-${index}`,'--proposal',next.data.proposal_digest,'--revision',next.revision,'--json'])); assert.equal(requested.ok,true);
        const verdict=outcome(def,next.data.candidate.subset_digest,index===0?'target_fail':'pass');
        const recorded=JSON.parse(run(['reduce','record','packed-repro','--request',requested.data.result.identity,'--op',`record-${index}`,'--revision',requested.revision,'--input','-','--json'],JSON.stringify(verdict)));assert.equal(recorded.ok,true);
        const replayed=JSON.parse(run(['reduce','record','packed-repro','--request',requested.data.result.identity,'--op',`record-${index}`,'--revision',requested.revision,'--input','-','--json'],JSON.stringify(verdict)));assert.equal(replayed.replayed,true);
        next=JSON.parse(run(['reduce','next','packed-repro','--json']));
      }
      assert.equal(JSON.parse(run(['reduce','certificate','packed-repro','--json'])).data.certificate.qualification,'one_minimal_under_recorded_oracle');
      assert.match(run(['reduce','certificate','packed-repro']),/one_minimal_under_recorded_oracle/);
      const page=JSON.parse(run(['reduce','packet','packed-repro','--limit','1','--json']));assert.equal(page.omitted,1);assert.ok(page.next_cursor);
      assert.equal(JSON.parse(run(['reduce','packet','packed-repro','--limit','1','--output-cursor',page.next_cursor,'--json'],undefined,2)).code,'read_output_cursor_invalid');
      assert.equal(JSON.parse(run(['reduce','packet','packed-repro','--limit','1','--cursor',page.next_cursor,'--json'])).data.offset,1);
      assert.equal(JSON.parse(run(['reduce','request','packed-repro','--op','stale','--proposal','f'.repeat(64),'--revision',staleRevision,'--json'],undefined,4)).refusal.code,'revision_conflict');
      const tiny=JSON.parse(run(['reduce','packet','packed-repro','--limit','1','--budget','1','--json'],undefined,2));assert.equal(tiny.refusal.code,'output_budget');const minimum=tiny.refusal.details.minimum_usable_budget;assert.ok(minimum>1);
      assert.equal(JSON.parse(run(['reduce','packet','packed-repro','--limit','1','--budget',String(minimum),'--json'])).ok,true);
      assert.equal(JSON.parse(run(['reduce','create','--id','packed-unsafe','--op','unsafe','--input','-','--json'],JSON.stringify({title:'\u001b[31m',definition:def}),2)).refusal.code,'invalid_input');
      assert.equal(JSON.parse(run(['reduce','packet','packed-missing','--json'],undefined,3)).refusal.code,'not_found');
      for(const name of ['next','certificate','packet']) {const text=run(['reduce',name,'packed-repro']);assert.ok(Buffer.byteLength(text)<=6400);assert.match(text,/schema_version: 1/);}
      writeFileSync(join(cwd, 'sdk-write.mjs'), "import assert from 'node:assert/strict';import {createDirectoryHost,readReduction,recordReductionOutcome} from 'pm-reduce';const host=createDirectoryHost(process.cwd()+'/.agents/pm','consumer');const owner=await readReduction(host,'packed-repro');const {observation_id,request_id,evidence,verification_digest,...outcome}=owner.state.observations[0];void observation_id;void evidence;void verification_digest;const input={id:owner.id,op:'packed-sdk-write',revision:owner.revision,request:request_id,outcome};await recordReductionOutcome(host,input);assert.equal((await recordReductionOutcome(host,input)).replayed,true);assert.equal((await readReduction(host,owner.id)).state.observations.length,3);console.log('SDK WRITE OK');\n");
      assert.match(execute(manager === 'npm' ? 'node' : 'bun', ['sdk-write.mjs'], cwd, safe), /SDK WRITE OK/);
      writeFileSync(join(cwd, 'sdk.mjs'), "import assert from 'node:assert/strict';import {createDirectoryHost,readReduction,reductionCertificate,recordReductionOutcome} from 'pm-reduce';const host=createDirectoryHost(process.cwd()+'/.agents/pm','consumer');const owner=await readReduction(host,'packed-repro');assert.equal(owner.state.requests.length,2);assert.equal((await reductionCertificate(host,{id:owner.id})).certificate.qualification,'one_minimal_under_recorded_oracle');const {observation_id,request_id,evidence,verification_digest,...outcome}=owner.state.observations[0];assert.equal(outcome.result,'target_fail');void recordReductionOutcome;void observation_id;void request_id;void evidence;void verification_digest;console.log('SDK OK '+(globalThis.Bun?'bun':'node'));\n");
      const runtime = manager === 'npm' ? 'node' : 'bun'; assert.match(execute(runtime, ['sdk.mjs'], cwd, safe), new RegExp(`SDK OK ${runtime}`));
      const installed = join(dirname(dirname(dirname(process.execPath))));
      for (const version of ['v22.19.0', 'v26.13.0']) {
        const node = join(installed, version, 'bin/node');
        if (!existsSync(node)) { assert.ok(process.env.GITHUB_ACTIONS, 'Minimum and current Node runtimes must be present for local acceptance'); continue; }
        unlinkSync(join(bin, 'node')); symlinkSync(node, join(bin, 'node'));
        assert.match(execute(node, ['sdk.mjs'], cwd, safe), /SDK OK node/);
        const certificate = JSON.parse(execute('npx', ['--no-install', 'pm', 'reduce', 'certificate', 'packed-repro', '--json'], cwd, safe)); assert.equal(certificate.data.certificate.qualification,'one_minimal_under_recorded_oracle');
      }
      unlinkSync(join(bin, 'node')); symlinkSync(process.execPath, join(bin, 'node')); journeys.push({ manager, commands, runtime });
    }
    const handoff = join(root, 'handoff'); mkdirSync(join(handoff, 'release-artifact'), { recursive: true }); mkdirSync(join(handoff, 'dist'));
    copyFileSync(archive, join(handoff, 'release-artifact/package.tgz'));
    writeFileSync(join(handoff, 'dist/index.js'), 'throw new Error("Unverified ignored distribution");\n');
    const publisherBin = join(root, 'publisher-bin'); mkdirSync(publisherBin); writeFileSync(join(publisherBin, 'package.json'), '{"type":"commonjs"}'); symlinkSync(process.execPath, join(publisherBin, 'node'));
    const publisher = join(publisherBin, 'npm');
    writeFileSync(publisher, '#!/usr/bin/env node\nconst fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");const target=process.argv[3]||".";const bytes=fs.readFileSync(fs.statSync(target).isFile()?target:path.join(target,"dist/index.js"));process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));\n'); chmodSync(publisher, 0o755);
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8'); const publish = workflow.split('\n').find(line => /^\s*npm publish /.test(line))!.trim();
    const delivered = execute('/bin/bash', ['-c', publish], handoff, { ...env, PATH: publisherBin }); assert.equal(delivered, sha256, 'Publishing must select the validated archive after ignored build mutation');
    const verify = workflow.split('\n').find(line => line.includes('sha256sum --check --strict'))!.trim();
    assert.match(execute('/bin/bash', ['-c', verify], handoff, { ...env, ARTIFACT_SHA256: sha256 }), /OK/);
    writeFileSync(join(handoff, 'release-artifact/package.tgz'), 'Unverified replacement archive');
    const swapped = spawnSync('/bin/bash', ['-c', verify], { cwd: handoff, env: { ...env, ARTIFACT_SHA256: sha256 }, encoding: 'utf8' }); assert.notEqual(swapped.status, 0); assert.match(swapped.stdout + swapped.stderr, /FAILED/);
    assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), sha256);
    writeFileSync('packed-receipt.local.json', JSON.stringify({ sha256, files: packed[0].files.map(file => file.path), journeys, git_in_path: false, handoff: { ignored_distribution_mutated: true, captured_archive_selected: true, swapped_archive_refused: true } }, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
