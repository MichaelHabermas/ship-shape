# Security Policy

## Reporting a Vulnerability

The U.S. Department of the Treasury takes security seriously. If you discover a security vulnerability in this project, please report it responsibly.

### How to Report

**Do NOT create a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities through one of these channels:

1. **Email**: Sam Corcos (samuel.corcos@treasury.gov)
2. **GitHub Security Advisories**: Use the "Report a vulnerability" button in the Security tab

### What to Include

When reporting a vulnerability, please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Resolution Timeline**: Depends on severity

### Scope

This security policy applies to:
- The main repository code
- Official releases
- Documentation

### Out of Scope

- Third-party dependencies (report to upstream maintainers)
- Self-hosted instances with custom modifications

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Security Best Practices

When deploying Ship:

1. Keep dependencies updated
2. Use environment variables for sensitive configuration
3. Enable HTTPS in production
4. Follow your organization's security guidelines

## Development Security

### Pre-commit Compliance Checks

This repository uses `comply opensource` as a pre-commit hook that scans for:

- **Secrets**: API keys, passwords, tokens (via gitleaks)
- **Sensitive Information**: AI-powered analysis for PII, internal URLs
- **Vulnerabilities**: Container and dependency scanning (via trivy)

### NEVER Bypass Security Checks

**`git commit --no-verify` is prohibited.** This flag bypasses all pre-commit hooks and defeats the security scanning.

If you encounter a situation where you're tempted to use `--no-verify`:

| Situation | Correct Action |
|-----------|----------------|
| False positive from gitleaks | Add to `.gitleaksignore` and re-run |
| Compliance tool crashes | Report bug to compliance-toolkit repo, wait for fix |
| Need to commit urgently | No exception. Fix the issue first. |
| CI is down | Local hooks still work. CI is backup enforcement. |

### Local Enforcement (Husky Pre-commit)

Security and contract checks run locally via `.husky/pre-commit` on every commit:

- **Empty Playwright tests**: Blocks tests with no assertions (`scripts/check-empty-tests.sh`)
- **API coverage**: Staged UI routes are checked against API coverage heuristics
- **OpenAPI parity**: `pnpm openapi:check:strict` enforces runtime route / OpenAPI alignment
- **Secrets and sensitive changes**: When the Treasury `comply` CLI is installed, `comply opensource --hook --staged` runs gitleaks and AI-assisted sensitive-data analysis on staged files (Trivy is temporarily skipped via `--skip-trivy`)

This repository does **not** ship GitHub Actions workflows for `secrets-scan` or `attestation-check`. Local hooks are the enforcement layer; install `comply` so secret scanning is not skipped with a warning.

### Attestation

`ATTESTATION.md` can record security review history when using the Treasury `comply` toolchain (who reviewed, which tools ran). Per stakeholder guidance for this Gauntlet project structure, the former Treasury-style required attestation gate is **not enforced**—commits are not blocked on attestation freshness, and restoring a deleted GitHub Actions compliance workflow is out of scope unless requirements change.

When you use `comply opensource` locally, it may update `ATTESTATION.md`; that remains optional audit history, not a merge gate.
