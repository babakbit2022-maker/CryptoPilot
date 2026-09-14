# CryptoPilot recovery plan

## Source of truth
The `main` branch is the primary source of truth. Every approved engineering change must be committed to GitHub.

## Automatic backups
`.github/workflows/cryptopilot-backup.yml` creates a disaster-recovery snapshot every Sunday and can also be started manually. It keeps a 90-day Actions artifact and creates a dated GitHub Release containing the source archive plus a SHA-256 checksum.

## What is backed up
- Application source code and Git history state at the backup commit.
- Public frontend, backend, scripts, workflows, tests and configuration files committed to the repository.

## What is deliberately NOT stored in the repository backup
- Deployment secrets and API keys.
- Production database contents.
- Private credentials.

These must be restored from the hosting provider's environment/secret store if a full disaster recovery is ever required.

## Protected project rules
- Do not change the configured USDT TRC20 receiving wallet during maintenance unless Babak explicitly requests it.
- Do not rewrite the existing public visual design/branding while fixing infrastructure unless Babak explicitly asks for a redesign.
- Before release, run the repository smoke/syntax/release gates and keep the resulting commit SHA as the recovery point.

## If Babak loses his phone or device
Sign in to ChatGPT with the same account and say: **«ادامه پروژه CryptoPilot از آخرین ذخیره»**. The project context should be reconstructed from the saved project history and the GitHub repository. The latest successful Git commit/release is the recovery point; do not restart the project from scratch.

## Important limitation
A source backup cannot by itself restore third-party hosting secrets or a live database. Those are intentionally separate so credentials are not exposed in GitHub. A future production backup can add encrypted database/export storage if the hosting provider exposes a safe backup API.
