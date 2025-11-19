/**
 * Commands for the bar: the tiers a property sells, the bar on a function,
 * and the bottle count on a consumption bar.
 */

import type { Command } from 'commander';
import { formatMoney } from '../../core/money.js';
import {
  barCharge,
  createBarTier,
  listBarTiers,
  listPours,
  pourCharge,
  pouredTenths,
  recordPour,
  requireBar,
  setBar,
} from '../../bar/store.js';
import { render, renderRecord } from '../output.js';
import { drawBarCharges } from '../../billing/charges.js';
import { entityArg, moneyArg, wholeNumber } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

export function registerBarTierCommands(program: Command, makeContext: () => CliContext): void {
  const tiers = program.command('bartier').description('the bar tiers a property sells');

  tiers
    .command('add')
    .description('put a bar tier on file')
    .requiredOption('--code <code>', 'short code')
    .requiredOption('--name <name>', 'what it is called')
    .requiredOption('--first <amount>', 'per cover for the first hour')
    .requiredOption('--extra <amount>', 'per cover for each hour after it')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const tier = createBarTier(
          db,
          context.requireProperty(),
          {
            code: options.code ?? '',
            name: options.name ?? '',
            firstHourMinor: moneyArg('first hour', options.first ?? '').amount,
            extraHourMinor: moneyArg('extra hour', options.extra ?? '').amount,
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              code: tier.code,
              name: tier.name,
              firstHour: formatMoney(tier.firstHour),
              extraHour: formatMoney(tier.extraHour),
            },
            { format: context.format },
          ),
        );
      });
    });

  tiers
    .command('list')
    .description('every tier on file')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listBarTiers(db, context.requireProperty()).map((row) => ({
                code: row.code,
                name: row.name,
                firstHour: formatMoney(row.firstHour),
                extraHour: formatMoney(row.extraHour),
              })),
              { format: context.format, empty: 'no bar tiers are on file' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerBarCommands(program: Command, makeContext: () => CliContext): void {
  const bar = program.command('bar').description('the bar on a function');

  bar
    .command('set')
    .description('put a bar on a function')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--kind <kind>', 'package, consumption or cash')
    .option('--tier <code>', 'the tier, for a package bar')
    .option('--hours <hours>', 'how long it runs', '0')
    .option('--note <note>', 'anything else', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const set = setBar(db, entityArg('functionSlot', options.function ?? ''), {
          kind: options.kind ?? '',
          ...(options.tier === undefined ? {} : { tierCode: options.tier }),
          hours: wholeNumber('hours', options.hours ?? '0'),
          note: options.note ?? '',
        });
        context.write(
          renderRecord(
            {
              function: set.functionId,
              kind: set.kind,
              tier: set.tierCode ?? '',
              hours: set.hours,
            },
            { format: context.format },
          ),
        );
      });
    });

  bar
    .command('pour')
    .description('record what came out of a bottle')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--item <code>', 'the beverage')
    .requiredOption('--opening <tenths>', 'tenths of a bottle at the start')
    .requiredOption('--closing <tenths>', 'tenths of a bottle at the end')
    .requiredOption('--unit <amount>', 'what a whole bottle costs')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const pour = recordPour(db, entityArg('functionSlot', options.function ?? ''), {
          itemCode: options.item ?? '',
          openingTenths: wholeNumber('opening', options.opening ?? ''),
          closingTenths: wholeNumber('closing', options.closing ?? ''),
          unitMinor: moneyArg('unit', options.unit ?? '').amount,
        });
        context.write(
          renderRecord(
            {
              item: pour.itemCode,
              poured: pouredTenths(pour),
              unit: formatMoney(pour.unit),
              charge: formatMoney(pourCharge(pour)),
            },
            { format: context.format },
          ),
        );
      });
    });

  bar
    .command('show')
    .description('the bar on a function and what it comes to')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const functionId = entityArg('functionSlot', options.function ?? '');
          const set = requireBar(db, functionId);
          const charge = barCharge(db, functionId);
          context.write(
            renderRecord(
              {
                function: functionId,
                kind: set.kind,
                tier: set.tierCode ?? '',
                hours: set.hours,
                covers: charge.covers,
                amount: formatMoney(charge.amount),
                detail: charge.detail,
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });

  bar
    .command('pours')
    .description('every bottle counted on a function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listPours(db, entityArg('functionSlot', options.function ?? '')).map((row) => ({
                item: row.itemCode,
                opening: row.openingTenths,
                closing: row.closingTenths,
                poured: pouredTenths(row),
                charge: formatMoney(pourCharge(row)),
              })),
              { format: context.format, empty: 'nothing has been counted' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerBarBillingCommands(program: Command, makeContext: () => CliContext): void {
  const bill = program.command('barbill').description('putting the bar on the invoice');

  bill
    .command('draw')
    .description('draw the bar charge onto the function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const drawn = drawBarCharges(db, entityArg('functionSlot', options.function ?? ''));
        context.write(
          render(
            drawn.map((row) => ({
              id: row.id,
              category: row.category,
              description: row.description,
              total: formatMoney(row.unit),
            })),
            { format: context.format, empty: 'that bar charges the client nothing' },
          ),
        );
      });
    });
}
