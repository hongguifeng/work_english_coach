// Public API: list jobs + per-step status for a run.
const id = process.argv[2];
if (!id) throw new Error('usage: node scripts/gh-jobsteps.mjs <runId>');
const j = JSON.parse(await (await fetch(`https://api.github.com/repos/hongguifeng/work_english_coach/actions/runs/${id}/jobs`)).text());
for (const job of j.jobs ?? []) {
  console.log(`JOB: ${job.name} -> ${job.conclusion}`);
  for (const s of job.steps ?? []) console.log(`  ${s.conclusion === 'success' ? '✅' : s.conclusion === 'failure' ? '❌' : '· '} ${s.name} (${s.conclusion})`);
}
