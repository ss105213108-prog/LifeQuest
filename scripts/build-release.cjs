const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_FILES, renderNetlifyHeaders } = require('./release-files.cjs');

const sourceRoot = path.resolve(__dirname, '..');
const outputRoot = path.resolve(sourceRoot, 'dist');

if (path.dirname(outputRoot) !== sourceRoot || path.basename(outputRoot) !== 'dist') {
  throw new Error(`Refusing to clean an unexpected release directory: ${outputRoot}`);
}

for (const relative of PUBLIC_FILES) {
  const source = path.resolve(sourceRoot, relative);
  if (!source.startsWith(`${sourceRoot}${path.sep}`) || !fs.statSync(source).isFile()) {
    throw new Error(`Release allowlist entry is missing or unsafe: ${relative}`);
  }
}

if (fs.readFileSync(path.join(sourceRoot, '_headers'), 'utf8') !== renderNetlifyHeaders()) {
  throw new Error('Netlify _headers source differs from the release header/cache policy');
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const relative of PUBLIC_FILES) {
  const source = path.join(sourceRoot, relative);
  const destination = path.join(outputRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

process.stdout.write(`LifeQuest clean release created: ${PUBLIC_FILES.length} files\n`);
