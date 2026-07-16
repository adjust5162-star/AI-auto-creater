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
OPENROUTER_MODEL=openai/gpt-4o-mini
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

If Supabase is not configured, Vercel can still serve the app, but render metadata and output files are not durable across serverless instances.
