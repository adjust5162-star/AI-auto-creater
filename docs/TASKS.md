# Tasks

## Done

- Read `MASTER CODEX PROMPT.hwpx` and selected MVP scope.
- Scaffold Next.js, TypeScript, Tailwind, Vitest, and Playwright.
- Implement local project storage and job metadata.
- Implement OpenRouter/local storyboard generation.
- Implement FFmpeg render pipeline with MP4, SRT, VTT, and JSON outputs.
- Build responsive project creation, scene editing, render status, and result preview UI.
- Add dependency-free Node runtime app under `/video-automation-app`.
- Bundle FFmpeg binary under `/video-automation-app/bin/ffmpeg.exe`.
- Verify project creation and MP4 render through API smoke test.
- Add GitHub/Vercel deployment files.
- Add optional Supabase metadata storage adapter and schema.

## Verified

- `node --test tests/*.test.mjs`: passed.
- API smoke: created project `proj_830af0547b274427` and completed render job `job_06f5329beb844434`.
- Browser smoke: loaded `http://127.0.0.1:3210`, verified title and project form.
- Vercel API entrypoint imports successfully.
- GitHub pushed to `adjust5162-star/AI-auto-creater`.
- Vercel production deployed to `https://ai-auto-creater.vercel.app`.
- Vercel production render smoke returned completed inline MP4 output.

## Next

- Resolve Supabase free project limit or provide an active Supabase project service key.
- Add Supabase Storage for durable rendered video assets.
- Add optional TTS provider after local render is stable.
