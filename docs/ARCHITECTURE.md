# Architecture

## Stack

- Dependency-free Node.js HTTP server.
- Vanilla HTML/CSS/JavaScript browser UI.
- Local JSON/filesystem storage under `/data`.
- Optional Supabase metadata storage via server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- OpenRouter-compatible chat completions for storyboard generation.
- Local bundled Windows FFmpeg binary or `@ffmpeg-installer/ffmpeg` for deployed MP4 rendering.

## Runtime Flow

1. `POST /api/projects` validates multipart form data and saves uploads.
2. Storyboard generation uses OpenRouter if configured, otherwise local segmentation.
3. Project metadata is saved to `/data/projects/<projectId>/project.json`.
4. When Supabase server env vars are present, project/job JSON is mirrored to `public.aiac_projects` and `public.aiac_jobs`.
5. `POST /api/projects/<id>/render` creates a job JSON and starts an in-process worker locally. On Vercel, the render runs inside the request.
6. Renderer writes scene clips, final MP4, SRT, VTT, and project JSON to `/data/projects/<id>/outputs/<jobId>`.
7. The UI polls `/api/jobs/<jobId>` and uses output routes for preview/download.

## Storage Boundary

All storage access goes through `src/lib/storage.ts` and path helpers in `src/lib/paths.ts`.
