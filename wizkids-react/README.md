# WizKids React Migration Shell

This folder is a **non-destructive React + Vite migration workspace** for the existing WizKids project.

## Goal
- Keep the current production app intact.
- Build React architecture in parallel.
- Migrate screen-by-screen while preserving the same look and feel.

## Current status
- React app scaffolded with route shell:
  - `/student`
  - `/mentor`
  - `/sme`
  - `/start`
  - `/branding`
- Each route currently renders the equivalent legacy page in an iframe.
- Vite dev server proxies backend assets/API to `http://localhost:3000`.

## Run
1. Start the existing backend/legacy app on port 3000 (Docker or npm flow).
2. In this folder:

```bash
npm install
npm run dev
```

3. Open:
   - `http://localhost:5174/student`
   - `http://localhost:5174/mentor`

## Important
- No existing legacy files are deleted or replaced by this migration shell.
- Migration to native React components should happen incrementally, feature by feature.
