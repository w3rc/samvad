# Contributing to SAMVAD

SAMVAD is young and contributions are welcome. This document covers setup, the test workflow, and how to propose changes.

## Setup

```bash
git clone https://github.com/w3rc/samvad.git
cd samvad
npm install
```

Requires Node.js 20+.

## Running Tests

```bash
# All workspaces
npm test --workspaces

# SDK only (faster)
npm test -w @samvad-protocol/sdk

# Single test file
npx vitest run tests/signing.test.ts -w @samvad-protocol/sdk

# Watch mode
npx vitest -w @samvad-protocol/sdk
```

Tests run against `src/` directly via Vitest — no build step required.

## Making Changes

1. Open an issue first for non-trivial changes to discuss the design.
2. Fork the repo and create a branch from `main`.
3. Make your changes. Keep commits focused and atomic.
4. Run `npm test --workspaces` and ensure everything passes.
5. Open a pull request. Describe what changed and why.

No CI is wired up yet — reviewers will run tests manually until a workflow is added.

## Protocol Changes

Changes to the wire format, security model, or endpoint semantics affect all SDK implementations and are held to a higher bar. For any protocol-level change:

1. Open a GitHub issue with the label `protocol-change`.
2. Describe the problem, the proposed change, and the backwards-compatibility impact.
3. Allow at least one week for discussion before opening a PR.

Changes that break the signing contract (canonical JSON form, envelope field set) or the security model ordering (see `CLAUDE.md`) require strong justification.

## Code Style

- TypeScript, ESM-only, Node 20+
- Vitest for tests — `globals: true`, tests live in `packages/sdk-typescript/tests/`
- Internal imports use `.js` extension even when importing `.ts` sources
- No build step required before running tests

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
