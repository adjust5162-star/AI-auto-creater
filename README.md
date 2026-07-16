# AI Video Automation App

Local-first video automation MVP.

## Run

```bash
node server.mjs
```

Open `http://localhost:3000`.

## OpenRouter

Create `.env.local`:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

If no key is configured, the app still creates local storyboards and renders MP4/SRT/VTT files.
`OPENROUTER_MODEL` can be a comma-separated fallback list. The production deployment uses free OpenRouter models first when paid credits are unavailable.

## Supabase

The app stores project/job metadata in Supabase when these server-side variables are configured:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Apply `supabase/schema.sql` to the project first. The browser never receives the service role key.

## Vercel

This repo includes `vercel.json` and `/api/index.mjs` for Vercel Functions. Set these Vercel environment variables when available:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

If Supabase is not configured, Vercel can still serve the app, but render metadata and output files are not durable across serverless instances.

## Rendering

The repo includes `assets/fonts/NotoSansCJKkr-Regular.otf` so Vercel FFmpeg renders Korean scene titles with `drawtext` instead of dropping text overlays.
The font is from Noto Sans CJK and its license is stored at `assets/fonts/NotoSansCJK-LICENSE.txt`.
