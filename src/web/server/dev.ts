import { startWebServer } from './server.js';

const configPath = process.argv[2] ?? 'examples/expenses-minimal-config.json';
const port = Number(process.env['LOCAL_OPENFINANCE_WEB_PORT'] ?? 3847);

process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] ??=
  process.env['LOCAL_OPENFINANCE_WEB_TOKEN'] ?? 'dev-token-change-me';

startWebServer(configPath, port);
