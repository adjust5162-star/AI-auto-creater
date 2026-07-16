# API Provider Guide

## OpenRouter

Set the key in `.env.local`:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4o-mini
APP_PUBLIC_URL=http://localhost:3000
```

The app uses OpenRouter only for storyboard and scene text generation. Rendering remains local through FFmpeg.

## No-Key Mode

When `OPENROUTER_API_KEY` is missing or the request fails, the app creates a local storyboard from the source text. Manual editing and FFmpeg rendering still work.

## Supabase Metadata Storage

Apply `supabase/schema.sql`, then configure server-only environment variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Use a service role key only on trusted servers such as Vercel Functions. Do not expose it in browser code or `NEXT_PUBLIC_` variables.
