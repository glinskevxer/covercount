/**
 * Commands about the store file itself: bringing it up to date and saying
 * what is in it. These are the commands somebody runs before anything else
 * works, so they open the store directly rather than needing a property.
 */

import type { Command } from 'commander';
import { tableNames } from '../../store/database.js';
import { appliedMigrations } from '../../store/migrate.js';
import { MIGRATIONS, TARGET_SCHEMA_VERSION, storeVersion } from '../../store/schema.js';
import { render, renderRecord } from '../output.js';
import { withOpenStore, type CliContext } from '../context.js';

export function registerStoreCommands(program: Command, makeContext: () => CliContext): void {
  const store = program.command('store').description('the property store file');

  store
    .command('init')
    .description('create the store and bring it up to the schema this build carries')
    .action(() => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          renderRecord(
            {
              store: context.storePath,
              version: storeVersion(db),
              tables: tableNames(db).length,
            },
            { format: context.format },
          ),
        );
      });
    });

  store
    .command('status')
    .description('report the schema version and the migrations applied')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const applied = appliedMigrations(db);
          context.write(
            render(
              applied.map((row) => ({
                id: row.id,
                name: row.name,
                checksum: row.checksum,
                applied: row.appliedAt,
              })),
              {
                format: context.format,
                empty: 'no migrations have been applied',
                columns: [
                  { key: 'id', align: 'right' },
                  { key: 'name' },
                  { key: 'checksum' },
                  { key: 'applied' },
                ],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });

  store
    .command('migrations')
    .description('list the migrations this build carries')
    .action(() => {
      const context = makeContext();
      context.write(
        render(
          MIGRATIONS.map((migration) => ({
            id: migration.id,
            name: migration.name,
            statements: migration.statements.length,
            target: migration.id === TARGET_SCHEMA_VERSION,
          })),
          {
            format: context.format,
            columns: [
              { key: 'id', align: 'right' },
              { key: 'name' },
              { key: 'statements', align: 'right' },
              { key: 'target' },
            ],
          },
        ),
      );
    });
}
