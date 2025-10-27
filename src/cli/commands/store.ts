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
import { seedDemoProperty } from '../../demo/property.js';
import { countRows, exportSetup, importSetup, type SetupExport } from '../../store/transfer.js';
import { readFileSync, writeFileSync } from 'node:fs';

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

export function registerDemoCommands(program: Command, makeContext: () => CliContext): void {
  const demo = program.command('demo').description('a property to look at');

  demo
    .command('seed')
    .description('build a whole property, rooms, menu, kitchen, crew and rates')
    .action(() => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const result = seedDemoProperty(db, context.now());
        context.write(
          renderRecord(
            {
              property: result.propertyCode,
              rooms: result.rooms,
              items: result.items,
              packages: result.packages,
              recipes: result.recipes,
              equipment: result.equipment,
            },
            { format: context.format },
          ),
        );
      });
    });
}

export function registerTransferCommands(program: Command, makeContext: () => CliContext): void {
  const setup = program.command('setup').description('moving a property between stores');

  setup
    .command('export')
    .description('write the property setup out as JSON')
    .option('--to <path>', 'write to a file instead of standard output')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const payload = exportSetup(db, context.requireProperty(), context.now());
          const json = JSON.stringify(payload, null, 2);
          if (options.to === undefined) {
            context.write(json);
            return;
          }
          writeFileSync(options.to, `${json}\n`, 'utf8');
          context.write(
            renderRecord(
              { path: options.to, property: payload.propertyCode, rows: countRows(payload) },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });

  setup
    .command('import')
    .description('read a property setup in, optionally under a new code')
    .requiredOption('--from <path>', 'the export to read')
    .option('--as <code>', 'bring it in under a different property code')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const payload = JSON.parse(readFileSync(options.from ?? '', 'utf8')) as SetupExport;
        const result = importSetup(db, payload, {
          ...(options.as === undefined ? {} : { asPropertyCode: options.as }),
        });
        context.write(
          renderRecord(
            { property: result.propertyCode, tables: result.tables, rows: result.rows },
            { format: context.format },
          ),
        );
      });
    });
}
