# Video Pipeline

## Render Stages

1. Save SRT, VTT, and project JSON.
2. Render one MP4 clip per scene.
3. Concatenate scene clips.
4. Mux uploaded audio when available.
5. Write final MP4 output metadata.

## Default Specs

- Vertical: 1080x1920, 30 FPS, H.264, AAC, yuv420p, MP4.
- Landscape: 1920x1080, 30 FPS, H.264, AAC, yuv420p, MP4.

## Notes

Scene headlines are attempted with FFmpeg `drawtext`. If local font support fails, rendering continues without burned-in text and records a warning.
