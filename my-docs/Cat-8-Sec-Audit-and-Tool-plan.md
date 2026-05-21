# Category 8 Security Audit and Probe Tool Plan

## Operating Principles

### Evidence Over Security Theater

### Required Spec Coverage First

### Exceed the Spec Where Risk Is Real

### Fresh Instance, Single Command

### Attack Like an Outsider, Verify Like a Maintainer

### Every Finding Must Be Reproducible

### Every Fix Must Become a Regression Check

### No False Confidence From Passing Tests

### Separate Compliance Grade From Real Risk

## Success Targets

### Category 8 Minimum Bar

### Shipshape Stretch Bar

### Grader Readiness

### Production Readiness

### Regression Gate Readiness

## Standards and Control Map

### OWASP Top 10

### OWASP API Security Top 10

### OWASP WebSocket and Real-Time Risks

### OWASP LLM and AI Security

### NIST CSF

### CIS-Style Operational Controls

### Government Application Expectations

## Security Probe Tool Vision

### One Command Runner

### Fresh Instance Compatibility

### Configurable Targets and Credentials

### Structured JSON Report

### Human Markdown Report

### Severity and Confidence Model

### Reproduction Capture

### Before and After Proof Mode

### CI and Local Modes

## Probe Tool Architecture

### Runner

### Target Configuration

### Authenticated Client

### Public Client

### WebSocket Client

### Payload Library

### Assertion Engine

### Evidence Recorder

### Report Writer

## Probe Surface Matrix

### Auth and Session Surface

### Role and Workspace Authorization Surface

### Public Unauthenticated Surface

### WebSocket Collaboration Surface

### Input Sanitization Surface

### Rich Text and Document Content Surface

### File Upload Surface

### AI and Data Egress Surface

### Dependency Supply Chain Surface

### Infrastructure and Header Surface

### Rate Limiting and Abuse Surface

### Error Leakage Surface

## Required Category 8 Benchmarks

### Auth and Session Benchmark

### WebSocket Validation Benchmark

### Input Sanitization Benchmark

### Dependency Audit Benchmark

### CORS and CSP Benchmark

### Secrets Exposure Benchmark

### Rate Limiting Benchmark

### Verbose Error Benchmark

## Shipshape-Specific Attack Ideas

### Public Feedback Abuse

### Setup Bootstrap Takeover

### Invite Acceptance Session Hardening

### Cross-Workspace Document Access

### Yjs Frame Fuzzing

### Stored XSS Through TipTap Content

### Uploaded File Trust Boundary

### API Token Expiry and Scope Abuse

### AI Prompt and Document Data Exfiltration

### Swagger and Metadata Exposure

### CloudFront to API Transport Risk

### Database Transport Risk

## Manual Review Track

### Secrets Archaeology

### CI/CD and Deploy Pipeline Review

### Terraform and AWS Edge Review

### IAM and Least Privilege Review

### Logging and Auditability Review

### Incident Response Evidence Review

### Data Retention and Government Compliance Review

## Findings Model

### Severity

### Exploitability

### Blast Radius

### Confidence

### Reproduction Steps

### Evidence

### Fix Recommendation

### Regression Probe

### Residual Risk

## Fix Selection Strategy

### Required Two Verified Fixes

### Fastest High-Confidence Wins

### Highest-Risk Production Exposure

### Fixes That Improve Multiple Controls

### Fixes That Become Permanent Probe Cases

## Reporting Structure

### Executive Summary

### Category 8 Scorecard

### Probe Results

### Manual Review Results

### Verified Vulnerabilities

### Required Fix Proof

### Risk Register

### Backlog and Hardening Roadmap

### Appendix and Raw Evidence

## Development Phases

### Phase 1 Audit Frame and Probe Skeleton

### Phase 2 Auth Public Surface and Input Probes

### Phase 3 WebSocket and Rich Text Fuzzing

### Phase 4 Dependency and Infrastructure Checks

### Phase 5 Fix Proof and Regression Gate

### Phase 6 Final Report and Grader Runbook

## Explicit Non-Goals

### No One-Off Compliance Script

### No Manual-Only Findings

### No Passing Grade Without Evidence

### No Hidden Critical Unknowns

## Definition of Done

### Spec Requirements Covered

### Probe Runs With One Command

### Reports Are Deterministic

### Two Fixes Verified With Before and After Evidence

### No Known Critical Gaps Hidden

### Tool Becomes Ongoing Security Regression Suite
