# Decisions

## 2026-07-16: Local-First MVP

Use local filesystem JSON storage and an in-process worker. This keeps the app runnable without Redis, a database, or cloud credentials.

## 2026-07-16: OpenRouter for Planning, FFmpeg for Rendering

OpenRouter generates storyboard text only. MP4 rendering remains local and deterministic through FFmpeg.

## 2026-07-16: Subtitle Outputs

Generate SRT for download and WebVTT for browser preview tracks.
