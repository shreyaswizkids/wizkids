# Wizkids Project Change Log (Till Now)

This document captures the changes made in the `wizkids` project from day 1 up to now, based on commit history and current working tree state.

## Project Context

- Repository path: `wizkids/`
- Active branch: `tarun-ui-workflow`
- Primary author in commits: `tarunn-create`

## Timeline of Committed Changes

### 1) 2026-05-28 - Commit `a141eb9`
**Message:** Add configurable AI assistants and sync avatar images

#### What was introduced
- Initial full project baseline was committed (frontend, backend, config, scripts, docs, assets).
- Multi-assistant and avatar foundations were established.
- Branding configuration and admin UI were added.
- Server config/branding loaders and API routing scaffolding were included.

#### Major additions by area
- **Configuration**
  - `.env.example`
  - `config/ai-assistants.json`
  - `config/branding.json`
  - `config/learning-paths.json`
  - `config/AI_ASSISTANTS.md`
  - `config/BRANDING.md`
- **Student/mentor app UI + logic**
  - `student.html`, `mentor.html`, `sme.html`, `start.html`, `index.html`
  - `js/app.js`, `js/gk-assistant.js`, `js/gk-branding.js`, `js/recommender.js`, and other core JS modules
  - `css/styles.css`, `css/edvantage-theme.css`, `css/mentor.css`, `css/sme.css`
- **Backend**
  - `server/index.js`, `server/routes.js`, `server/db.js`, `server/events.js`
  - `server/branding-loader.js`, `server/config-loader.js`
- **Scripts/automation**
  - `scripts/sync-assistant-images.mjs`
  - `scripts/import-new-avatars.mjs`
  - `scripts/process-avatar-backgrounds.py`
  - `scripts/setup-and-blend-avatars.mjs`
- **Assets**
  - Large image and avatar set under `img/`
  - Backup image tree under `img.backup-20260528125749/`

---

### 2) 2026-05-29 - Commit `8ffa0f6`
**Message:** Add Gurukul content API integration for Grade 6 math and science.

#### What changed
- Added Grade 6 content integration for math and science.
- Added content loader logic and integrated it into app flow.
- Added published JSON content packs for selected topics.
- Updated topic metadata, lesson flow hooks, and backend routes.

#### Key files changed
- **Modified**
  - `.env.example`
  - `config/learning-paths.json`
  - `data/topics.js`
  - `js/app.js`
  - `mentor.html`
  - `server/routes.js`
  - `student.html`
  - `db/gurukul.sqlite` (+ `-shm`, `-wal`)
- **Added**
  - `js/gk-content-loader.js`
  - `published/Grade_6/Mathematics/Symmetry/01_curiosity_hooks_v2.json`
  - `published/Grade_6/Mathematics/Symmetry/02_trigger_questions_v2.json`
  - `published/Grade_6/Mathematics/Symmetry/03_concept_cards_v2.json`
  - `published/Grade_6/Mathematics/Symmetry/04_assessments_v2.json`
  - `published/Grade_6/Mathematics/Symmetry/05_deep_dive_zone_v2.json`
  - `published/Grade_6/Mathematics/Symmetry/06_project_zone_v2.json`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/01_curiosity_hooks_v2.json`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/02_trigger_questions_v2.json`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/03_concept_cards_v2.json`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/04_assessments_v2.json`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/05_deep_dive_zone_v2.json`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/06_project_zone_v2.json`

---

### 3) 2026-05-30 - Commit `f0bfbbd`
**Message:** Improve student UI workflow, lesson flow, and content delivery.

#### What changed
- Improved student journey and lesson flow behavior.
- Refined assistant logic and content loader behavior.
- Updated branding admin UX and theme styling.
- Adjusted server startup/route behavior and data layer updates.
- Added architecture documentation.

#### Key files changed
- **Modified**
  - `admin/school-branding.css`
  - `admin/school-branding.html`
  - `admin/school-branding.js`
  - `config/ai-assistants.json`
  - `config/learning-paths.json`
  - `css/edvantage-theme.css`
  - `data/db.js`
  - `data/session-store.js`
  - `data/topics.js`
  - `db/gurukul.sqlite` (+ `-shm`, `-wal`)
  - `docker-compose.yml`
  - `js/app.js`
  - `js/gk-assistant.js`
  - `js/gk-content-loader.js`
  - `js/recommender.js`
  - `published/Grade_6/Science/The_Wonderful_World_of_Science/03_concept_cards_v2.json`
  - `server/db.js`
  - `server/index.js`
  - `server/routes.js`
  - `student.html`
- **Added**
  - `docs/architecture/admin-branding-flow.docx`
  - `docs/architecture/architecture-overview.docx`
  - `docs/architecture/sequence-diagrams.docx`
  - `docs/architecture/student-learning-flow.docx`
- **Deleted**
  - `db/gurukul 2.sqlite-shm`
  - `db/gurukul 2.sqlite-wal`

## Current In-Progress (Uncommitted) Changes Snapshot

As of now, local working tree contains:

- Modified:
  - `config/ai-assistants.json`
  - `config/branding.json`
  - `db/gurukul.sqlite-shm`
  - `db/gurukul.sqlite-wal`
- Untracked:
  - `img/branding-logo.png`

## Practical Summary

In sequence, work progressed from:
1. Full project foundation + assistants + branding setup,
2. Content API and Grade 6 published content integration,
3. UX/flow refinement and architecture documentation,
4. Ongoing minor config and asset updates currently pending commit.
