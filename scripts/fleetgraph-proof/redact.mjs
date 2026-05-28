// Redacts local and secret-bearing proof values before reviewer artifacts are written.
const SECRET_PATTERNS = [
  /(DATABASE_URL=)([^\s]+)/gi,
  /(postgres(?:ql)?:\/\/)([^@\s]+)@/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(Cookie:\s*)[^\n]+/gi,
  /(Set-Cookie:\s*)[^\n]+/gi,
  /([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*=)([^\s]+)/gi,
];

export function redactText(value) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '$1[redacted]'), String(value ?? ''));
}

export function redactProofValue(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactProofValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactProofValue(child)]));
  }
  return value;
}
