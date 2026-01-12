/**
 * Commands for the store cupboard and the pull sheet.
 */

import type { Command } from 'commander';
import { formatMoney } from '../../core/money.js';
import { requireFunction } from '../../booking/functions.js';
import { requireCovers } from '../../covers/guarantee.js';
import { coverBreakdown } from '../../covers/special.js';
import {
  createEquipment,
  listEquipment,
  listRequirements,
  pullFor,
  savePull,
  setRequirement,
  tablesFor,
} from '../../equipment/store.js';
import { isSetupStyle } from '../../property/types.js';
import { invalidInput } from '../../core/errors.js';
import { columns, render, renderRecord } from '../output.js';
import { entityArg, moneyArg, wholeNumber } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

function setupStyle(value: string) {
  const style = value.trim().toUpperCase();
  if (!isSetupStyle(style)) {
    throw invalidInput('cli.setup', `${value} is not a setup style`);
  }
  return style;
}

function coversFor(
  db: Parameters<typeof requireCovers>[0],
  functionId: Parameters<typeof requireCovers>[1],
  fallback: number,
): number {
  const covers = requireCovers(db, functionId);
  if (covers.guaranteedCovers === undefined) {
    return fallback;
  }
  return coverBreakdown(db, functionId).setFor;
}

export function registerEquipmentCommands(program: Command, makeContext: () => CliContext): void {
  const kit = program.command('kit').description('the store cupboard and what a setup pulls');

  kit
    .command('add')
    .description('put a piece of equipment on file')
    .requiredOption('--code <code>', 'short code')
    .requiredOption('--name <name>', 'what it is called')
    .requiredOption('--kind <kind>', 'table, seating, linen, china, glass, buffet, av or staging')
    .option('--owned <count>', 'how many the property owns', '0')
    .option('--rental <amount>', 'what one costs to hire in', '0.00')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const item = createEquipment(
          db,
          context.requireProperty(),
          {
            code: options.code ?? '',
            name: options.name ?? '',
            kind: options.kind ?? '',
            owned: wholeNumber('owned', options.owned ?? '0'),
            rentalMinor: moneyArg('rental', options.rental ?? '0.00').amount,
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              code: item.code,
              name: item.name,
              kind: item.kind,
              owned: item.owned,
              rental: formatMoney(item.rental),
            },
            { format: context.format },
          ),
        );
      });
    });

  kit
    .command('list')
    .description('everything in the cupboard')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listEquipment(db, context.requireProperty()).map((row) => ({
                code: row.code,
                name: row.name,
                kind: row.kind,
                owned: row.owned,
                rental: formatMoney(row.rental),
              })),
              { format: context.format, empty: 'the cupboard is empty' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  kit
    .command('rule')
    .description('say what a setup style pulls')
    .requiredOption('--style <style>', 'the setup style')
    .requiredOption('--item <code>', 'the equipment')
    .option('--per-cover <count>', 'how many a cover needs', '0')
    .option('--per-table <count>', 'how many a table needs', '0')
    .option('--fixed <count>', 'how many whatever the size', '0')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const rule = setRequirement(db, context.requireProperty(), {
          setupStyle: options.style ?? '',
          equipmentCode: options.item ?? '',
          perCover: wholeNumber('per cover', options.perCover ?? '0'),
          perTable: wholeNumber('per table', options.perTable ?? '0'),
          fixed: wholeNumber('fixed', options.fixed ?? '0'),
        });
        context.write(
          renderRecord(
            {
              style: rule.setupStyle,
              item: rule.equipmentCode,
              perCover: rule.perCover,
              perTable: rule.perTable,
              fixed: rule.fixed,
            },
            { format: context.format },
          ),
        );
      });
    });

  kit
    .command('rules')
    .description('what one setup style pulls')
    .requiredOption('--style <style>', 'the setup style')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listRequirements(db, context.requireProperty(), setupStyle(options.style ?? '')).map(
                (row) => ({
                  item: row.equipmentCode,
                  perCover: row.perCover,
                  perTable: row.perTable,
                  fixed: row.fixed,
                }),
              ),
              { format: context.format, empty: 'that style pulls nothing' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerPullCommands(program: Command, makeContext: () => CliContext): void {
  const pull = program.command('pull').description('the pull sheet for a function');

  pull
    .command('sheet')
    .description('what the setup pulls, off its guaranteed count')
    .requiredOption('--function <id>', 'the function')
    .option('--covers <count>', 'work it out against this count instead')
    .option('--save', 'write it against the function')
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const functionId = entityArg('functionSlot', String(options.function ?? ''));
        const slot = requireFunction(db, functionId);
        const covers =
          options.covers === undefined
            ? coversFor(db, functionId, slot.expectedCovers)
            : wholeNumber('covers', String(options.covers));
        const sheet = pullFor(db, slot.propertyCode, slot.setupStyle, covers);
        if (options.save === true) {
          savePull(db, functionId, sheet);
        }
        context.write(
          render(
            sheet.map((row) => ({
              item: row.equipmentCode,
              name: row.name,
              need: row.quantity,
              owned: row.owned,
              hire: row.shortfall,
              hireCost: formatMoney({
                amount: row.rental.amount * row.shortfall,
                currency: row.rental.currency,
              }),
            })),
            {
              format: context.format,
              empty: 'that setup pulls nothing',
              columns: columns('item', 'name', 'need>', 'owned>', 'hire>', 'hireCost>'),
            },
          ),
        );
      });
    });

  pull
    .command('tables')
    .description('how many tables a setup needs for a cover count')
    .requiredOption('--style <style>', 'the setup style')
    .requiredOption('--covers <count>', 'the covers')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      const style = setupStyle(options.style ?? '');
      const covers = wholeNumber('covers', options.covers ?? '');
      context.write(
        renderRecord(
          { style, covers, tables: tablesFor(style, covers) },
          { format: context.format },
        ),
      );
    });
}
