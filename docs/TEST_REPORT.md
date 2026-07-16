# Test Report

## 2026-07-16

- `node --test tests/*.test.mjs`: passed 4 tests.
- API smoke: created a local-fallback project and rendered a 15-second MP4 successfully.
- Output artifacts verified through job metadata: MP4, SRT, VTT, and project JSON URLs.
- Browser smoke: in-app browser loaded the app and confirmed title/form/studio shell.
- Vercel import smoke: `/api/index.mjs` imports and exposes a function handler.

## Known Environment Note

`npm install` and `pnpm install` did not exit reliably in this workspace and produced incomplete `node_modules` folders. The final runnable MVP avoids runtime npm dependencies.

## Supabase Blocker

Supabase project creation and restoration failed because the account reached the active free project limit. Database schema application is pending a usable Supabase project.
