const fs = require('fs');
const path = require('path');

const userAgent = process.env.npm_config_user_agent || '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('Use pnpm instead');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
for (const file of ['package-lock.json', 'yarn.lock']) {
  try {
    fs.rmSync(path.join(rootDir, file), { force: true });
  } catch (_e) {
    // Ignore errors if file doesn't exist
  }
}
