# Test Report

## 2026-07-16

- `node --test tests/*.test.mjs`: passed 4 tests.
- API smoke: created a local-fallback project and rendered a 15-second MP4 successfully.
- Output artifacts verified through job metadata: MP4, SRT, VTT, and project JSON URLs.
- Browser smoke: in-app browser loaded the app and confirmed title/form/studio shell.
- Vercel import smoke: `/api/index.mjs` imports and exposes a function handler.
- Vercel production page: `https://ai-auto-creater.vercel.app/` returns 200 and includes the app title.
- Vercel production API: `GET /api/projects` returns 200.
- Vercel production render smoke: project `proj_402a395d1d704803` rendered job successfully, returned inline MP4 data URL, output size 55,724 bytes.
- Supabase schema applied to existing project `qrlcatvmeiprxeobdotp`; `aiac_projects` and `aiac_jobs` persistence verified from Vercel production.
- Supabase Advisors after hardening: security 0 errors / 0 warnings, performance 0 errors / 0 warnings.
- OpenRouter production smoke: project `proj_6d00495f2ab64f3d` used `aiProvider: openrouter`.
- Vercel production render smoke after font bundling: job `job_076b6ce95c8745b5` completed with inline MP4 output and 0 render warnings.

## Known Environment Note

`npm install` and `pnpm install` did not exit reliably in this workspace and produced incomplete `node_modules` folders. The final runnable MVP avoids runtime npm dependencies.

## Supabase Status

New Supabase project creation was blocked by the active free project limit, so the app is using the existing Seoul project `qrlcatvmeiprxeobdotp`. The app tables are isolated with the `aiac_` prefix and RLS is enabled.
