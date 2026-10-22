import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

assert.equal(process.platform, 'darwin', 'macOS signature validation requires macOS');
const root = process.cwd();
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
const output = path.resolve(manifest.build.directories.output);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'meonjakju-signatures-'));
const report = {version: manifest.version, at: new Date().toISOString(), passed: false,
  signing: 'ad-hoc', notarized: false, firstLaunchApprovalRequired: true, archives: []};
const run = (command, args, options = {}) => execFileSync(command, args, {encoding: 'utf8', ...options}).trim();
try {
  for (const arch of ['arm64', 'x64']) {
    const filename = `Meonjakju-${manifest.version}-mac-${arch}.zip`;
    const archive = path.join(output, filename);
    const bytes = await fs.readFile(archive);
    const extracted = path.join(temporary, arch);
    await fs.mkdir(extracted);
    run('/usr/bin/ditto', ['-x', '-k', archive, extracted]);
    const app = path.join(extracted, 'Meonjakju.app');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const display = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], {encoding: 'utf8'});
    assert.equal(display.status, 0, display.stderr);
    const signature = display.stdout + display.stderr;
    assert.match(signature, /^Identifier=im\.chii\.stocks$/m);
    assert.match(signature, /^Signature=adhoc$/m);
    assert.match(signature, /flags=.*runtime/);
    assert.match(signature, /Sealed Resources version=2/);
    assert.doesNotMatch(signature, /Sealed Resources=none|Info.plist=not bound/);
    const version = run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]);
    assert.equal(version, manifest.version);
    const binaryArch = run('/usr/bin/lipo', ['-archs', path.join(app, 'Contents/MacOS/Meonjakju')]);
    assert.equal(binaryArch, arch === 'x64' ? 'x86_64' : 'arm64');
    const entitlementsXML = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', app]);
    const entitlements = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {input: entitlementsXML}));
    assert.deepEqual(entitlements, {'com.apple.security.cs.allow-jit': true, 'com.apple.security.cs.disable-library-validation': true});
    const assessment = spawnSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app], {encoding: 'utf8', timeout: 30000});
    const assessmentOutput = (assessment.stdout + assessment.stderr).trim();
    assert.equal(assessment.error, undefined, assessment.error?.message);
    assert.doesNotMatch(assessmentOutput, /internal error|damaged|invalid signature/i);
    assert.ok(assessment.status === 0 || (assessment.status === 3 && /rejected/.test(assessmentOutput)), assessmentOutput);
    report.archives.push({filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      version, binaryArch, signatureVerified: true, sealedResources: true, entitlements,
      gatekeeper: {exitCode: assessment.status, accepted: assessment.status === 0,
        expectedUnnotarizedRejection: assessment.status === 3,
        output: assessmentOutput.replaceAll(temporary, '<temporary>')}});
  }
  report.passed = true;
  await fs.copyFile(path.join(root, 'docs/mac-install.txt'), path.join(output, `Meonjakju-${manifest.version}-Mac-Guide.txt`));
  console.log(`Both ${manifest.version} Mac ZIPs have complete ad-hoc signatures. Apple notarization is not present; user approval remains required.`);
} finally {
  await fs.mkdir('qa', {recursive: true});
  await fs.writeFile(`qa/mac-signatures-${manifest.version}.json`, JSON.stringify(report, null, 2) + '\n');
  await fs.rm(temporary, {recursive: true, force: true});
}
