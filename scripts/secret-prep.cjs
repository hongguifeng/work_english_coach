// T018 E2E 准备脚本：把真实的 aiApiKey 凭据清掉，让 UI 从“未配置”开始。
// 仅用 keytar（独立原生模块，可直接 require），不依赖应用 bundle。
const { app } = require('electron');

const SERVICE = 'WorkEnglish Coach';
const ACCOUNT = 'aiApiKey';

async function main() {
  const keytar = require('keytar');
  const before = await keytar.getPassword(SERVICE, ACCOUNT);
  await keytar.deletePassword(SERVICE, ACCOUNT);
  const after = await keytar.getPassword(SERVICE, ACCOUNT);
  console.log(
    `[secret-prep] before=${
      before === null ? 'null' : `SET(len ${before.length})`
    } after=${after === null ? 'null (not configured)' : `STILL SET(len ${after.length})`}`,
  );
  app.exit(0);
}

app.whenReady().then(main, (e) => {
  console.error('[secret-prep] ready failed:', e);
  app.exit(1);
});
