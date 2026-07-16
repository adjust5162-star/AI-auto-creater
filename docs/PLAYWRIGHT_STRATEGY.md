# Playwright Strategy

## Scope

Run a small smoke test for the core browser shell and project creation path. Keep screenshot and trace output only for failures.

## Commands

```bash
node --test tests/*.test.mjs
```

## Current Test Coverage

- In-app browser check verifies the landing shell loads.
- Project form accepts source text.
- Local fallback can create a project without an API key.

## Note

The original Next.js/Playwright package installation path was blocked by a local npm process that created incomplete `node_modules` folders and did not exit. The verified MVP therefore uses a dependency-free Node server plus in-app browser validation.
