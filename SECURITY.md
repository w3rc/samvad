# Security Policy

## Supported Versions

SAMVAD is pre-1.0. The current supported version is the latest commit on `main`.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/w3rc/samvad/security/advisories/new).

Include:
- A clear description of the vulnerability
- Steps to reproduce
- Affected component (protocol spec, TypeScript SDK, or both)
- Potential impact

You will receive an acknowledgement within 72 hours. If the report is confirmed, a fix will be prepared and a coordinated disclosure date agreed upon.

## Scope

**In scope:**
- Protocol design flaws (authentication, signing, replay protection, delegation)
- TypeScript SDK security issues (`@samvad-protocol/sdk`)
- Issues that allow signature forgery, replay attacks, or trust-tier bypass

**Out of scope:**
- Vulnerabilities in third-party dependencies (report upstream)
- Issues requiring physical access to the host
- Rate-limiting bypasses that require a valid authenticated sender

## Known Limitations

The built-in prompt-injection scanner (`injection-scanner.ts`) is a regex first-pass only. It is documented as best-effort and is expected to be bypassed by adaptive attacks. This is not a vulnerability — it is a stated design limitation. A proper LLM-based classifier integration is on the roadmap.
