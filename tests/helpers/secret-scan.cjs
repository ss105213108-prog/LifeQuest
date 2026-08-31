const fs = require('node:fs');
const path = require('node:path');

// Findings contain locations/categories only, never the matched credential.
function scanText(text, file = '') {
  const findings = [];
  const add = rule => findings.push({ file, rule });
  const patterns = {
    secret_key: /\bsb_secret_[A-Za-z0-9_-]{12,}/,
    management_token: /\bsbp_[A-Za-z0-9]{20,}/,
    database_password_url: /postgres(?:ql)?:\/\/[^\s/:]+:[^\s@/]+@/i,
    private_key: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
    password_hash_output: /(?:report|console\.log|stdout\.write)\s*\([^\n]*['"]TEMP_PASSWORD_HASH['"]/,
    env_publish_reference: /(?:src|href)\s*=\s*['"][^'"]*\/\.env(?:[.'"?\/])|\b(?:cp|copy|Copy-Item)\s+[^\r\n]*\.env\b[^\r\n]*(?:public|dist|build)/i
  };
  for (const [rule, pattern] of Object.entries(patterns)) if (pattern.test(text)) add(rule);
  // Target the old live-runner password factories/properties. Bounded source
  // windows are a regression guard, not a general JavaScript data-flow analyzer.
  const credentialSites = /\bfunction\s+\w*(?:password|credential)\w*\s*\([^)]{0,200}\)\s*\{[\s\S]{0,1500}?\n\}|\b(?:password|passwd)\s*[:=][^\r\n]{0,1000}/gi;
  for (const [site] of text.matchAll(credentialSites)) {
    if (/\bcreateHash\s*\(/.test(site) && /\b(?:runId|label)\b/.test(site)) {
      add('metadata_derived_password');
      break;
    }
  }
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString());
      // Legacy anon JWTs are intentionally public, just like publishable keys.
      if (payload.role !== 'anon') add(payload.role === 'service_role' ? 'service_role_jwt' : 'sensitive_jwt_constant');
    } catch (_error) { add('unrecognized_jwt_constant'); }
  }
  if (/^\.env(?:\..+)?$/i.test(path.basename(file)) && !/\.(?:example|sample|template)$/i.test(file)) add('env_file_in_project');
  return findings;
}
function scanProject(root) {
  const findings = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.npm-cache', '.git', 'assets', 'vendor'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:js|mjs|cjs|ts|json|sql|html|md|toml|ya?ml|pem|key)$/i.test(entry.name) || entry.name.startsWith('.env')) {
        findings.push(...scanText(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
      }
    }
  }
  walk(root);
  return findings;
}
module.exports = { scanText, scanProject };
