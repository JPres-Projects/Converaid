const fs = require('node:fs');
const cp = require('node:child_process');
const roots = ['C:/AWG/Projekte/ExtractMiningStocksData', 'C:/AWG/Github/StardawnAI/AI-Working-Ground'];
const git = (root, args) => { try { return cp.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8_000_000 }).trim(); } catch { return ''; } };
for (const root of roots) {
  const graph = JSON.parse(fs.readFileSync(root + '/.ua/knowledge-graph.json', 'utf8'));
  const metadata = graph.project;
  const resolved = metadata.gitCommitHash && git(root, ['rev-parse', '--verify', '--end-of-options', `${metadata.gitCommitHash}^{commit}`]);
  const changed = resolved ? git(root, ['diff', '--name-only', resolved, 'HEAD', '--', '.']).split('\n').filter(Boolean) : [];
  const dirty = git(root, ['status', '--porcelain', '-uno']).split('\n').filter(Boolean);
  const safe = node => !/(?:\.env|credentials?|secrets?|tokens?)(?:\b|[/.])/i.test(node.filePath || node.id || '');
  console.log(JSON.stringify({ root, metadata:{ name: metadata.name, frameworks: metadata.frameworks, analyzedAt: metadata.analyzedAt, gitCommitHash: metadata.gitCommitHash }, head: git(root, ['rev-parse', '--short', 'HEAD']), graphCommitResolved: Boolean(resolved), changedCount: changed.length, changedSample: changed.filter(p => !p.startsWith('.features/')).slice(0, 5), trackedDirtyCount: dirty.length,
    layers: graph.layers?.slice(0, 14).map(({name})=>name),
    files: graph.nodes.filter(n=>n.type==='file' && safe(n) && /package\.json$|pyproject|main\.(ts|js|py)|step7_extract|step5_extract|pipeline|api\/|server\.(ts|js)|budget|client_session|agent.*run/i.test(n.filePath || '')).slice(0, 12).map(({filePath})=>filePath)
  }));
  console.log(git(root, ['log', '-n', '12', '--date=short', '--format=%h %ad %s']));
}
