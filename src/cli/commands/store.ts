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
import { backupIsCurrent, backupTo, readBackup } from '../../store/backup.js';

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

export function registerBackupCommands(program: Command, makeContext: () => CliContext): void {
  const backup = program.command('backup').description('copies of the store');

  backup
    .command('take')
    .description('copy the store consistently, without stopping the office')
    .requiredOption('--to <path>', 'where to write it')
    .action(async (options: Record<string, string>) => {
      const context = makeContext();
      const db = context.openStore();
      try {
        const result = await backupTo(db, options.to ?? '');
        context.write(
          renderRecord(
            {
              path: result.path,
              bytes: result.bytes,
              version: result.version,
              tables: result.tables,
            },
            { format: context.format },
          ),
        );
      } finally {
        db.close();
      }
    });

  backup
    .command('read')
    .description('look inside a backup without migrating it')
    .requiredOption('--path <path>', 'the backup')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      const summary = readBackup(options.path ?? '');
      context.write(
        renderRecord(
          {
            path: summary.path,
            bytes: summary.bytes,
            version: summary.version,
            behindBy: summary.behindBy,
            tables: summary.tables.length,
            current: backupIsCurrent(summary.path),
          },
          { format: context.format },
        ),
      );
    });

  backup
    .command('migrations')
    .description('the migrations a backup carries')
    .requiredOption('--path <path>', 'the backup')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      context.write(
        render(
          readBackup(options.path ?? '').migrations.map((row) => ({
            id: row.id,
            name: row.name,
            applied: row.appliedAt,
          })),
          {
            format: context.format,
            empty: 'that backup carries no migrations',
            columns: [{ key: 'id', align: 'right' }, { key: 'name' }, { key: 'applied' }],
          },
        ),
      );
    });
}
