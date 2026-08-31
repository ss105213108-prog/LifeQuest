// Local compatibility preview only, not a Netlify emulator or deployment.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { PUBLIC_FILES } = require('../../scripts/release-files.cjs');

function parseHeaders(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line.startsWith('/')) {
      if (line.includes('*') && line !== '/*') throw new Error('Preview supports exact paths and /* only');
      rules.push({ path: line, headers: {} });
    } else {
      const match = /^  ([A-Za-z-]+): (.+)$/.exec(line);
      if (!match || !rules.length) throw new Error('Invalid release header syntax');
      const headers = rules.at(-1).headers;
      const name = match[1].toLowerCase();
      if (name in headers) throw new Error('Duplicate header in one rule');
      headers[name] = match[2];
    }
  }
  return rules;
}

function headersFor(rules, pathname) {
  const headers = {};
  for (const rule of rules.filter(rule => rule.path === '/*' || rule.path === pathname)) {
    for (const [name, value] of Object.entries(rule.headers)) {
      headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
    }
  }
  return headers;
}

function createReleasePreview(root) {
  const rules = parseHeaders(fs.readFileSync(path.join(root, '_headers'), 'utf8'));
  const allowed = new Set(PUBLIC_FILES.filter(file => file !== '_headers'));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['GET', 'HEAD'].includes(request.method) || !allowed.has(relative)) {
      response.writeHead(404, headersFor(rules, pathname)).end();
      return;
    }
    const headers = { ...headersFor(rules, pathname), 'Content-Type': types[path.extname(relative)] };
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(path.join(root, relative)));
  });
}

module.exports = { parseHeaders, headersFor, createReleasePreview };
if (require.main === module) {
  createReleasePreview(path.resolve(__dirname, '../../dist')).listen(4191, '127.0.0.1', () => {
    process.stdout.write('Header compatibility preview: http://127.0.0.1:4191/\n');
  });
}
