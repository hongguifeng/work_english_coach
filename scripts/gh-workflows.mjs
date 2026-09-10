// List recent Actions runs for ci.yml and release.yml (public API, no token).
const OWNER = 'hongguifeng', REPO = 'work_english_coach';
const base = `https://api.github.com/repos/${OWNER}/${REPO}/actions/runs?per_page=8`;
const j = JSON.parse(await (await fetch(base)).text());
for (const r of j.workflow_runs ?? []) {
  const head = r.head_sha ? r.head_sha.slice(0,7) : '(none)';
  console.log(`${r.name} | ${r.event} ${r.tag_name ?? ''} | ${r.status} | ${r.conclusion ?? ''} | id=${r.id} run=${r.run_id} head=${head}`);
  if (r.conclusion) {
    const logs = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${r.run_id}/logs`);
    if (logs.ok) await logs.body?.cancel?.();
  }
}
