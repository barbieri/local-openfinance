import process from 'node:process';
import type { CommandModule } from 'yargs';
import { ConfigValidationError, loadConfig } from '../config/load-config.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

export const validateConfigCommand: CommandModule<object, ConfigArgv> = {
  command: 'validate-config',
  describe: 'load and validate the configuration',
  builder: withConfigOption,
  handler: async (argv) => {
    try {
      await loadConfig(argv.config);
    } catch (error) {
      process.exitCode = 1;
      process.stderr.write(`${JSON.stringify(formatValidateConfigError(error), null, 2)}\n`);
    }
  },
};

function formatValidateConfigError(error: unknown): unknown {
  if (error instanceof ConfigValidationError) {
    return {
      configPath: error.configPath,
      errors: error.validationErrors,
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
    };
  }

  return {
    error: String(error),
  };
}
