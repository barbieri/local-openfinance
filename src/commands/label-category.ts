import process from 'node:process';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Argv, CommandModule } from 'yargs';
import { loadConfig } from '../config/load-config.js';
import { buildCategoryIndex } from '../db/category-display.js';
import { deleteCategoryLabel, upsertCategoryLabel } from '../db/category-labels.js';
import { openDatabase } from '../db/connection.js';
import { type ConfigArgv, withConfigOption } from './shared.js';

type LabelCategoryArgv = ConfigArgv & {
  readonly 'category-id'?: string | undefined;
  readonly name?: string | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly clear?: boolean | undefined;
};

export const labelCategoryCommand: CommandModule<object, LabelCategoryArgv> = {
  command: 'label-category',
  describe: 'set display name, icon, and color for an upstream category',
  builder: (argv) =>
    withConfigOption(argv)
      .option('category-id', { type: 'string', describe: 'Category id' })
      .option('name', { type: 'string', describe: 'Custom display name' })
      .option('icon', { type: 'string', describe: 'Material icon id (e.g. ShoppingCart)' })
      .option('color', { type: 'string', describe: 'CSS color hex or token' })
      .option('clear', {
        type: 'boolean',
        default: false,
        describe: 'Remove label',
      }) as Argv<LabelCategoryArgv>,
  handler: async (argv) => {
    const resolved = await loadConfig(argv.config);
    const { db } = openDatabase(resolved);

    const categoryId = argv['category-id'] ?? (await promptCategoryId(db));

    if (argv.clear) {
      const removed = deleteCategoryLabel(db, categoryId);
      process.stdout.write(
        `${removed ? chalk.green('label removed') : chalk.yellow('no label found')}\n`,
      );
      return;
    }

    const label = upsertCategoryLabel(db, categoryId, {
      name: argv.name,
      icon: argv.icon,
      color: argv.color,
    });

    process.stdout.write(`${chalk.green('label saved')}\n${JSON.stringify(label, null, 2)}\n`);
  },
};

async function promptCategoryId(db: ReturnType<typeof openDatabase>['db']): Promise<string> {
  const index = buildCategoryIndex(db);
  const entries = [...index.values()];
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const choices = entries.map((entry) => ({
    name: entry.path,
    value: entry.id,
  }));

  return select({ message: 'Category', choices });
}
