import process from 'node:process';
import type { CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

export const inspectConfigCommand: CommandModule<object, ConfigArgv> = {
  command: 'inspect-config',
  describe: 'print the resolved configuration as JSON',
  builder: withConfigOption,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
  },
};
