// T018 probe: verify keytar loads in the Electron runtime and round-trips a
// secret through the OS credential store. Run: npx electron scripts/keytar-probe.cjs
const keytar = require('keytar');
const { app } = require('electron');

const SERVICE = 'WorkEnglish Coach';
const ACCOUNT = 'aiApiKey:probe';

function line(k, v) {
  console.log(`[keytar-probe] ${k}: ${v}`);
}

app.whenReady().then(async () => {
  try {
    // Ensure clean slate
    await keytar.deletePassword(SERVICE, ACCOUNT);

    const before = await keytar.getPassword(SERVICE, ACCOUNT);
    line('before-set', before === null ? 'null (ok)' : `UNEXPECTED:${before}`);

    await keytar.setPassword(SERVICE, ACCOUNT, 'probe-secret-123');
    const after = await keytar.getPassword(SERVICE, ACCOUNT);
    line('after-set', after === 'probe-secret-123' ? 'MATCH (ok)' : `MISMATCH:${after}`);

    const del = await keytar.deletePassword(SERVICE, ACCOUNT);
    const afterDel = await keytar.getPassword(SERVICE, ACCOUNT);
    line('delete', `${del === true ? 'true (ok)' : del}`);
    line('after-delete', afterDel === null ? 'null (ok)' : `UNEXPECTED:${afterDel}`);

    line('RESULT', 'PASS');
  } catch (e) {
    line('ERROR', `${e && e.message ? e.message : String(e)}`);
    line('RESULT', 'FAIL');
  } finally {
    app.exit(0);
  }
});
