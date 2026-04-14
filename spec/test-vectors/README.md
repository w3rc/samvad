# Cross-SDK Test Vectors

RFC 9421 signatures produced by the TypeScript SAMVAD SDK.
Any SDK claiming protocol v1.2 conformance must verify all cases in `vectors.json`.

Regenerate: `npm run gen-vectors -w @samvad-protocol/sdk`

The `keys/` subdirectory holds the Ed25519 keypair used for generation and is gitignored.
