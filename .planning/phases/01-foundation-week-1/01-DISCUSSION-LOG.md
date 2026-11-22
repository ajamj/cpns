# Phase 1: Foundation (Week 1) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2025-01-22
**Phase:** 1-Foundation (Week 1)
**Areas discussed:** Seed Data in Phase 1, CI/CD Deployment Target

---

## Seed Data in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| I'll provide questions | You'll supply a JSON/CSV file with questions. I'll build the import mechanism in Phase 1 to load your file. | |
| Create minimal seed from public sources | I'll research BMKG regulations, SOPs, and public materials to create ~50 curated questions covering all 21 topics. You can edit/extend later. | ✓ |
| Skip seed in Phase 1 | Defer question seed to Phase 2. Phase 1 focuses on empty-state onboarding (kisi-kisi review → add first question manually). | |

**User's choice:** Create minimal seed from public sources
**Notes:** User wants ~50 curated starter questions covering all 21 topics, sourced from public BMKG documents (regulations, SOPs, technical guidelines). This enables immediate practice on first run and verifies the DB/import pipeline works.

---

## CI/CD Deployment Target

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Pages | Free, native HTTPS, custom domain support, PWA works perfectly. Deploy via GitHub Actions. Best for open-source personal project. | ✓ |
| Netlify | Free tier generous, branch previews, form handling, edge functions. Connect repo, auto-deploy. PWA works. Slightly more config than GH Pages. | |
| Vercel | Excellent DX, edge network, preview deployments. Free for personal. PWA works. Similar to Netlify. | |
| Local only (file:// + npx serve) | No cloud deployment. Build produces dist/ folder you run locally with `npx serve dist` or python HTTP server. Full control, zero external deps. | |

**User's choice:** GitHub Pages
**Notes:** GitHub Pages chosen for free HTTPS, native PWA support, and simple GitHub Actions deployment. Manifest `start_url` and `scope` will be configured for the GitHub Pages URL pattern.

---

## the agent's Discretion

- **A-01:** Exact Vite/TypeScript/ESLint/Prettier config details — follow modern best practices
- **A-02:** Specific utility class set (spacing scale, typography scale, layout helpers) — keep minimal
- **A-03:** Dexie migration strategy details (versioned upgrades with `upgrade` hooks) — implement standard pattern
- **A-04:** GitHub Actions workflow matrix (Node versions, cache strategy) — use sensible defaults
- **A-05:** PWA manifest details (icons, shortcuts, theme colors) — follow PRD/SRS specs
- **A-06:** Onboarding wizard UX (3-step: kisi-kisi review → import seed → configure mock exam) — implement per PRD flow

## Deferred Ideas

- **Question CRUD UI** → Phase 2 (Question Bank)
- **Practice/Mock Exam/Flashcard modes** → Phase 3 (Study Modes)
- **Analytics dashboard/charts** → Phase 4 (Analytics)
- **CSV import/export, Anki .apkg export** → Phase 2 (Should Have) / Phase 6
- **Accessibility audit, Lighthouse optimization** → Phase 5 (Polish & Ship)
- **Auto-backup (File System Access API)** → Phase 5 / Phase 6