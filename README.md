# github-stats

Automated GitHub activity widget for [friedev.com](https://friedev.com).

A GitHub Action runs **daily** (04:00 UTC), pulls activity via the GitHub GraphQL
API, and commits two files that the website reads:

- **`stats.json`** — the data (repos, stars, commits, streak, active days, top languages).
- **`card.svg`** — a self-contained 400×280 card, same data as an image.

## How it works

`generate.mjs` (Node 20, zero dependencies) queries GraphQL
`contributionsCollection`, which — unlike the events/REST source used before —
counts **private** contributions too, so commits and the streak are no longer 0.

- `commitsLast90Days` → `contributionsCollection.totalCommitContributions`
- `currentStreak` / `activeDaysLast30` → `contributionCalendar` (any contribution counts)
- `totalStars` / `totalForks` / `topLanguages` → owned repositories (incl. private)

If the data can't be fetched, the script **fails loudly** instead of writing
zeros — that silent-zero behaviour was the original bug.

## Setup (one-time)

1. Create a Personal Access Token so private contributions are visible:
   - **Classic PAT** with scopes `repo` + `read:user`, or
   - **Fine-grained PAT** (all repos) with read access to *Contents*, *Metadata*
     and account *Followers* / *Profile*.
2. Repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `STATS_TOKEN`
   - Value: the PAT
3. Repo → **Settings → Actions → General → Workflow permissions** → enable
   **Read and write permissions** (lets the Action commit the updated files).

`STATS_TOKEN` is **required**. Without it the run fails cleanly (no commit), so
the site keeps its current data instead of dropping to public-only numbers
(the repo count would fall from 7 to 1 and private commits would stay hidden).

## Run it now

Repo → **Actions → Update GitHub Stats → Run workflow** (manual trigger), or
locally:

```bash
GH_TOKEN=<your_pat> GH_USER=malzinger node generate.mjs
```

## Cadence

Daily via cron in `.github/workflows/update-stats.yml`. Change the `cron:` line
to adjust (e.g. `0 */6 * * *` for every 6 hours).
