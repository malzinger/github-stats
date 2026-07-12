// GitHub activity stats generator for malzinger/github-stats.
// Produces stats.json + card.svg. Runs daily via GitHub Actions.
//
// Fix vs. the old pipeline: commit/streak counts come from the GraphQL
// contributionsCollection (includes PRIVATE contributions when the token has
// `repo` scope), instead of a source that silently returned 0.
//
// Design rule: FAIL LOUDLY on missing token / API errors / empty user — never
// silently write zeros. Zeros were the exact bug we are fixing.

import { writeFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'malzinger';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

// Linguist-ish colors; values chosen to match the previous card. Unknown -> grey.
const LANG_COLORS = {
  GDScript: '#355570',
  Python: '#3572A5',
  'C#': '#239120',
  'C++': '#f34b7d',
  C: '#555555',
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Dart: '#00B4AB',
  Lua: '#000080',
  HLSL: '#aace60',
};
const FALLBACK_COLOR = '#8b949e';
const colorFor = (lang) => LANG_COLORS[lang] || FALLBACK_COLOR;

const DAY = 86_400_000;

// ---------- pure helpers (exported for tests) ----------

// days: [{date:'YYYY-MM-DD', count:Number}] ascending. "Any contribution" streak.
// An in-progress day with 0 does not break the streak (start from yesterday).
export function computeStreak(days) {
  if (!days.length) return 0;
  let i = days.length - 1;
  if (days[i].count === 0) i--; // today not done yet -> don't break
  let streak = 0;
  for (; i >= 0; i--) {
    if (days[i].count > 0) streak++;
    else break;
  }
  return streak;
}

export function activeDaysLast30(days) {
  return days.slice(-30).filter((d) => d.count > 0).length;
}

export function pickTopLanguages(repos, n = 5) {
  const counts = {};
  for (const r of repos) {
    const lang = r.primaryLanguage?.name;
    if (!lang) continue;
    counts[lang] = (counts[lang] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([language, repos]) => ({ language, repos }));
}

function flattenCalendar(cal) {
  const days = [];
  for (const w of cal.weeks) {
    for (const d of w.contributionDays) {
      days.push({ date: d.date, count: d.contributionCount });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

// Assemble the stats.json object from a GraphQL `user` node.
export function buildStats(user, now = new Date()) {
  const repos = user.repos.nodes;
  const days = flattenCalendar(user.calendar.contributionCalendar);

  const totalStars = repos.reduce((s, r) => s + (r.stargazerCount || 0), 0);
  const totalForks = repos.reduce((s, r) => s + (r.forkCount || 0), 0);

  const commits90 =
    user.last90.totalCommitContributions > 0
      ? user.last90.totalCommitContributions
      : user.last90.restrictedContributionsCount || 0;

  const recentActivity = (user.last90.commitContributionsByRepository || [])
    .map((x) => ({
      repo: x.repository.nameWithOwner,
      commits: x.contributions.totalCount,
      date: x.repository.pushedAt,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5);

  return {
    user: {
      name: user.name || user.login,
      login: user.login,
      avatar: user.avatarUrl,
      bio: user.bio || '',
      location: user.location || '',
      publicRepos: user.publicRepos.totalCount,
      followers: user.followers.totalCount,
      following: user.following.totalCount,
    },
    stats: {
      totalStars,
      totalForks,
      totalRepos: user.totalRepos.totalCount,
      commitsLast90Days: commits90,
      currentStreak: computeStreak(days),
      activeDaysLast30: activeDaysLast30(days),
    },
    topLanguages: pickTopLanguages(repos),
    recentActivity,
    generatedAt: now.toISOString(),
    nextUpdate: new Date(now.getTime() + DAY).toISOString(),
  };
}

// Legend slot positions taken 1:1 from the original card.svg (3 + 2 layout).
const LEGEND = [
  { cx: 24, cy: 220 },
  { cx: 154, cy: 220 },
  { cx: 284, cy: 220 },
  { cx: 24, cy: 240 },
  { cx: 154, cy: 240 },
];
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderCard(stats, now = new Date()) {
  const { user, stats: s, topLanguages } = stats;
  const langs = topLanguages.slice(0, 5);

  const barW = 68;
  const bars = langs
    .map((l, i) => {
      const x = 24 + i * (barW + 4);
      return `<rect x="${x}" y="195" width="${barW}" height="8" rx="4" fill="${colorFor(l.language)}"/>`;
    })
    .join('');

  const legend = langs
    .map((l, i) => {
      const { cx, cy } = LEGEND[i];
      return (
        `<circle cx="${cx}" cy="${cy}" r="5" fill="${colorFor(l.language)}"/>` +
        `<text x="${cx + 12}" y="${cy + 4}" fill="#8b949e" font-size="11">${esc(l.language)}</text>`
      );
    })
    .join('');

  const updated = `${now.getUTCDate()}.${now.getUTCMonth() + 1}.${now.getUTCFullYear()}`;

  return `<svg width="400" height="280" viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#58a6ff;stop-opacity:0.2" />
      <stop offset="100%" style="stop-color:#a371f7;stop-opacity:0.2" />
    </linearGradient>
  </defs>
  <rect width="400" height="280" rx="12" fill="#161b22"/>
  <rect width="400" height="280" rx="12" fill="none" stroke="#30363d" stroke-width="1"/>
  <rect width="400" height="60" rx="12" fill="url(#headerGrad)"/>
  <rect x="0" y="48" width="400" height="12" fill="#161b22"/>
  <text x="24" y="38" fill="#e6edf3" font-family="system-ui, sans-serif" font-size="16" font-weight="600">${esc(user.name)}'s GitHub Activity</text>
  <text x="376" y="38" fill="#8b949e" font-family="monospace" font-size="10" text-anchor="end">@${esc(user.login)}</text>
  <text x="24" y="85" fill="#8b949e" font-size="11">Repositories</text>
  <text x="24" y="105" fill="#e6edf3" font-size="20" font-weight="600">${s.totalRepos}</text>
  <text x="120" y="85" fill="#8b949e" font-size="11">Total Stars</text>
  <text x="120" y="105" fill="#e6edf3" font-size="20" font-weight="600">${s.totalStars}</text>
  <text x="220" y="85" fill="#8b949e" font-size="11">Forks</text>
  <text x="220" y="105" fill="#e6edf3" font-size="20" font-weight="600">${s.totalForks}</text>
  <text x="310" y="85" fill="#8b949e" font-size="11">Current Streak</text>
  <text x="310" y="105" fill="#3fb950" font-size="20" font-weight="600">${s.currentStreak}d</text>
  <text x="24" y="140" fill="#8b949e" font-size="11">Commits (90d)</text>
  <text x="24" y="160" fill="#e6edf3" font-size="20" font-weight="600">${s.commitsLast90Days}</text>
  <text x="120" y="140" fill="#8b949e" font-size="11">Active Days (30d)</text>
  <text x="120" y="160" fill="#e6edf3" font-size="20" font-weight="600">${s.activeDaysLast30}</text>
  <text x="220" y="140" fill="#8b949e" font-size="11">Followers</text>
  <text x="220" y="160" fill="#e6edf3" font-size="20" font-weight="600">${user.followers}</text>
  <text x="24" y="185" fill="#8b949e" font-size="11">Top Languages</text>
  ${bars}
  ${legend}
  <text x="24" y="268" fill="#8b949e" font-size="9">Updated: ${updated}</text>
  <text x="376" y="268" fill="#8b949e" font-size="9" text-anchor="end">friedev.com</text>
</svg>`;
}

// ---------- GitHub API ----------

const QUERY = `
query($login:String!, $from90:DateTime!, $fromYear:DateTime!, $to:DateTime!){
  user(login:$login){
    name login avatarUrl bio location
    followers { totalCount }
    following { totalCount }
    publicRepos: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    totalRepos: repositories(ownerAffiliations: OWNER) { totalCount }
    repos: repositories(ownerAffiliations: OWNER, first: 100, orderBy:{field:PUSHED_AT, direction:DESC}) {
      nodes { nameWithOwner stargazerCount forkCount isPrivate isFork pushedAt primaryLanguage { name } }
    }
    last90: contributionsCollection(from:$from90, to:$to){
      totalCommitContributions
      restrictedContributionsCount
      commitContributionsByRepository(maxRepositories:5){
        repository { nameWithOwner pushedAt }
        contributions { totalCount }
      }
    }
    calendar: contributionsCollection(from:$fromYear, to:$to){
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchUser(now) {
  const to = now.toISOString();
  const from90 = new Date(now.getTime() - 90 * DAY).toISOString();
  const fromYear = new Date(now.getTime() - 364 * DAY).toISOString();

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${USER}-github-stats`,
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { login: USER, from90, fromYear, to },
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data?.user) {
    throw new Error(`No user data returned for "${USER}"`);
  }
  return json.data.user;
}

async function main() {
  if (!TOKEN) {
    throw new Error(
      'Missing GH_TOKEN (or GITHUB_TOKEN). A PAT with `repo` + `read:user` is required for private-inclusive stats.',
    );
  }
  const now = new Date();
  const user = await fetchUser(now);
  const stats = buildStats(user, now);

  // Loud warning (not fatal): looks like the token can't see private contributions.
  if (stats.stats.commitsLast90Days === 0 && stats.stats.totalRepos > 0) {
    console.warn(
      '[warn] commitsLast90Days is 0 while repos exist — token may lack `repo` scope ' +
        'or private contributions are hidden. Check the STATS_TOKEN secret.',
    );
  }

  writeFileSync('stats.json', JSON.stringify(stats, null, 2) + '\n');
  writeFileSync('card.svg', renderCard(stats, now));
  console.log(
    `OK: repos=${stats.stats.totalRepos} stars=${stats.stats.totalStars} ` +
      `commits90=${stats.stats.commitsLast90Days} streak=${stats.stats.currentStreak}d ` +
      `active30=${stats.stats.activeDaysLast30}`,
  );
}

// Run only when executed directly (kept importable for tests).
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.env.RUN_MAIN === '1') {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
