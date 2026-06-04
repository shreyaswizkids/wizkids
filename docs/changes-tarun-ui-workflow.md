# Tarun UI Workflow - Change Document

## Scope
- Branch: `tarun-ui-workflow`
- Compared against: `origin/main`
- Current head: `73d7d03`

## Commit Timeline

### `a141eb9` - Add configurable AI assistants and sync avatar images
- Added configurable assistant system and avatar sync pipeline.
- Introduced assistant config/docs and related scripts.
- Added large avatar/image asset sets and backups.
- **Stats:** 204 files changed, 40026 insertions.

### `8ffa0f6` - Add Gurukul content API integration for Grade 6 math and science
- Integrated published content loading through `/api/content/:subject/:topic`.
- Added content mapping/loader for hooks, concepts, assessments, deep dive, and project zone.
- Updated topic/content flow for Grade 6 Math and Science.
- **Stats:** 23 files changed, 836 insertions, 1453 deletions.

### `f0bfbbd` - Improve student UI workflow, lesson flow, and content delivery
- Refined learning UI and timetable behavior (compact layout, drag/drop behavior, scroll/overlap fixes).
- Updated learning/chat pane behavior for lesson and assessment phases.
- Improved server/runtime stability and local run behavior (Docker/SQLite handling).
- Added branding/admin updates and architecture docs.
- **Stats:** 28 files changed, 2388 insertions, 320 deletions.

### `73d7d03` - Save local work before merging Shreyas changes
- Captured pre-merge local state on `tarun-ui-workflow` before integrating additional branch updates.
- Included incremental updates around learning-path/config, feedback data flow, runtime/server updates, and docs tracking.
- **Stats:** 7 files changed, 216 insertions, 3 deletions.

## Major Areas Updated

### 1) Student UX and Lesson Flow
- `js/app.js`
- `css/edvantage-theme.css`
- `student.html`
- `data/topics.js`

### 2) API and Content Delivery
- `server/routes.js`
- `js/gk-content-loader.js`
- `published/Grade_6/Mathematics/Symmetry/*`
- `published/Grade_6/Science/The_Wonderful_World_of_Science/*`

### 3) Runtime and Data Layer
- `server/db.js`
- `server/index.js`
- `docker-compose.yml`
- `db/gurukul.sqlite*`

### 4) Assistant and Branding System
- `js/gk-assistant.js`
- `config/ai-assistants.json`
- `config/learning-paths.json`
- `admin/school-branding.html`
- `admin/school-branding.css`
- `admin/school-branding.js`

### 5) Documentation and Architecture Artifacts
- `docs/architecture/admin-branding-flow.docx`
- `docs/architecture/architecture-overview.docx`
- `docs/architecture/sequence-diagrams.docx`
- `docs/architecture/student-learning-flow.docx`

## Net Branch Delta vs `origin/main`
- **172 files changed**
- **10364 insertions**
- **2641 deletions**

## Current Local Work (Not Yet Committed)
- Working tree currently has staged updates beyond `73d7d03`.
- **Staged diff stats:** 48 files changed, 6332 insertions, 114 deletions.

### Main in-progress additions
- New feedback analytics frontend app:
  - `feedback-dashboard/*` (Vite + React code, components, hooks, analytics utilities)
  - Built static output under `dashboard/*`
- New API helper/service entry:
  - `swagger.js`

### Main in-progress modifications
- Runtime/config and data:
  - `server/index.js`, `server/routes.js`, `server/db.js`, `server/config-loader.js`
  - `docker-compose.yml`, `package.json`, `package-lock.json`
  - `data/db.js`, `data/session-store.js`, `data/feedback-data.js`
  - `config/learning-paths.json`
- App behavior:
  - `js/app.js`, `js/mentor-app.js`, `js/feedback.js`
- Local SQLite state:
  - `db/gurukul.sqlite*`

## Notes
- The branch contains both code and asset-heavy updates (assistant/avatar image sets), which significantly increase insertion counts.
- This document is a consolidated high-level summary for reporting and review, and now includes both committed branch history and current staged local progress.
