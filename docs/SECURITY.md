# Security

## Secrets

- API keys must stay in `.env.local` or environment variables.
- Server routes read `OPENROUTER_API_KEY`; browser code never receives it.
- Server routes may read `SUPABASE_SERVICE_ROLE_KEY`; browser code never receives it.
- `.env*` files are ignored except `.env.example`.

## File Handling

- Uploads are written under project-specific directories in `/data`.
- Output download routes map known output kinds to fixed filenames.
- Project-relative asset paths are resolved through path helpers.
- Supabase tables in `supabase/schema.sql` have RLS enabled and grant access to `service_role` only.

## Current Limitations

- No authentication or multi-user isolation in the MVP.
- Uploaded media is trusted local input for the current user.
- Vercel serverless output files are not durable without adding Supabase Storage or another object store.
