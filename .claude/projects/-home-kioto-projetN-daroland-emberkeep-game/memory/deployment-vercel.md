---
name: deployment-vercel
description: How Emberkeep deploys (Vercel, auto on main push) and the missed-webhook gotcha
metadata:
  type: project
---

Emberkeep deploys to **Vercel** (project `novativeais-projects/emberkeep-game`),
auto-deploying on every push to `main`. Config is `vercel.json` (framework vite,
buildCommand `pnpm build`, outputDirectory `dist`). Build = `tsc --noEmit && vite build`.

**Gotcha (seen 2026-06-20):** a push can land on GitHub but Vercel never triggers a
deploy — a **missed GitHub→Vercel webhook**, not a code/build/config problem. Symptom:
the commit has 0 Vercel deployment + a `pending` combined status. Fix: push an empty
commit (`git commit --allow-empty`) to re-send the webhook; it then builds and deploys
normally. A dashboard "Redeploy" works too.

Diagnose without Vercel access via the GitHub API (repo `deployments`, commit
`status`/`check-runs`) using the stored PAT. No `.github/workflows`, no GitHub Pages.

Push auth: HTTPS remote needs a PAT (stored via `credential.helper store` →
plaintext `~/.git-credentials`). Never paste the token in chat. See [[push-auth-and-remote]].
