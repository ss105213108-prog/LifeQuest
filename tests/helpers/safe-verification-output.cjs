// Output-only protection for authorized live tests. Never serialize error text,
// credentials or whole runtime objects; IDs remain available for exact cleanup.
function safeFailure(error) {
  const category = error?.name === 'AssertionError' ? 'ASSERTION_FAILED'
    : error?.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'VERIFICATION_FAILURE';
  return { category, ...(Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
    ? { status: error.status } : {}) };
}
function safeVerificationRecord(value, depth = 0) {
  if (depth > 8) return '[OMITTED]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/sb_secret_[A-Za-z0-9_-]+|sbp_[A-Za-z0-9]+|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\$2[aby]\$\d{2}\$|postgres(?:ql)?:\/\/[^\s/]+:[^\s@]+@|-----BEGIN .*PRIVATE KEY-----/i.test(value)) return '[REDACTED]';
    return value.length <= 500 ? value : '[OMITTED]';
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeVerificationRecord(item, depth + 1));
  if (!value || typeof value !== 'object') return '[OMITTED]';
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|hash|token|secret|credential|seed|verifier|authorization|apikey|api_key|private.?key|connection.?string/i.test(key)) continue;
    if (/^(error|failure)$/i.test(key)) { result[key] = safeFailure(item); continue; }
    if (/^(message|stack|detail|detailsRaw|errorCode|reason)$/i.test(key)) continue;
    result[key] = safeVerificationRecord(item, depth + 1);
  }
  return result;
}
module.exports = { safeFailure, safeVerificationRecord };
