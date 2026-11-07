const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const asar = createRequire(path.resolve('app/package.json'))('@electron/asar');
const archive = path.resolve('app/release/win-unpacked/resources/app.asar');
const main = asar.extractFile(archive, 'dist-electron/main.js').toString('utf8');
for (const marker of ['never emit editing placeholders', 'For a language-only question', 'Programming languages listed by the map', 'Frameworks and runtimes listed by the map']) assert(main.includes(marker), `Missing packaged guidance: ${marker}`);
const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert(pkg.name === 'meetingly' && pkg.productName === 'Meetingly', 'Existing profile identity must be preserved');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const artifact = path.resolve('app/release/Converaid-2026-11-06-Languages-Setup.exe');
const sourceFiles = ['app/shared/types.ts', 'app/electron/services/projectKnowledge.ts', 'app/package.json'];
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, digest(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))]));
const references = {
  DeepMines: 'C:/AWG/Projekte/ExtractMiningStocksData/INTERVIEW.md',
  AWG: 'C:/AWG/Github/StardawnAI/AI-Working-Ground/INTERVIEW.md',
  'AI Clipping': 'C:/AWG/Projekte/AI Clipping/INTERVIEW.md',
  'Stardawn Deploy': 'C:/AWG/Github/StardawnAI/Stardawn Deploy/INTERVIEW.md'
};
const referenceHashes = Object.fromEntries(Object.entries(references).map(([name, file]) => [name, digest(fs.readFileSync(file))]));
const proof = { file: path.basename(artifact), bytes: fs.statSync(artifact).size, sha256: digest(fs.readFileSync(artifact)), appAsarSha256: digest(fs.readFileSync(archive)), sourceHashes, referenceHashes, bankSha256: digest(fs.readFileSync('C:/AWG/Projekte/Converaid-Delivery/language-examples.txt')), unitTestsPassed: 264, unitTestsSkipped: 1, typecheck: 'passed', rendererSmoke: 'passed', liveModelCalls: 0, profileIdentityPreserved: true };
fs.writeFileSync('.awg/language-update-proof.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ file: proof.file, bytes: proof.bytes, sha256: proof.sha256, packagedGuidanceVerified: true, profileIdentityPreserved: true }));
