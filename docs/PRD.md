# PRD

## Target Users

Solo creators, educators, marketers, and operators who need quick browser-compatible MP4 videos from text plus optional media assets.

## MVP Workflow

Create project -> add source text/assets -> generate editable storyboard -> edit scenes -> render MP4/SRT -> preview/download.

## Implemented MVP Features

- Text input with optional source URL.
- Optional image upload for scene backgrounds.
- Optional audio upload for final MP4 audio.
- OpenRouter storyboard generation when `OPENROUTER_API_KEY` is configured.
- Local storyboard generation when no API key is available.
- Editable scene narration, headline, duration, asset, transition, camera movement, and highlighted words.
- FFmpeg-based MP4 composition through bundled `ffmpeg-static`.
- SRT and WebVTT subtitle generation.
- Render job progress, warnings, errors, preview, and downloads.

## Deferred Features

- External text-to-video or image-generation APIs.
- Server-side TTS audio synthesis.
- Distributed queues, cloud storage, team accounts, and billing.
- Advanced timeline editing, waveform editing, and burned-in subtitle templates.

## Success Criteria

- The app starts locally with `npm run dev`.
- A project can be created without an API key.
- A render job produces MP4, SRT, VTT, and project JSON outputs.
- Browser smoke tests verify the main workflow shell.
