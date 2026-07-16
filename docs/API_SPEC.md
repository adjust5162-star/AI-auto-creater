# API Spec

## Projects

- `GET /api/projects`: list projects.
- `POST /api/projects`: create project from multipart form data.
- `GET /api/projects/:projectId`: read project.
- `PATCH /api/projects/:projectId`: update title, target duration, brand color, and scenes.
- `POST /api/projects/:projectId/regenerate-scene`: regenerate one scene.

## Render Jobs

- `POST /api/projects/:projectId/render`: start render job.
- `GET /api/jobs/:jobId`: read job state.

## Outputs

- `GET /api/projects/:projectId/outputs/:jobId/video`: MP4 preview/download.
- `GET /api/projects/:projectId/outputs/:jobId/srt`: SRT download.
- `GET /api/projects/:projectId/outputs/:jobId/vtt`: WebVTT preview track.
- `GET /api/projects/:projectId/outputs/:jobId/json`: project JSON download.
