/**
 * Commands for the split the client comes back with, and for what the kitchen
 * has to do about it.
 */

import type { Command } from 'commander';
import { formatQuantity } from '../../core/quantity.js';
import { invalidInput } from '../../core/errors.js';
import {
  clearSelections,
  listSelections,
  setCourseSplit,
  splitProblems,
} from '../../covers/selections.js';
import {
  batchDemand,
  ingredientDemand,
  packWastePercent,
  plateDemand,
} from '../../production/explode.js';
import {
  advanceRequisition,
  listRequisitions,
  raiseRequisition,
  refreshRequisition,
  requisitionLines,
  totalPacks,
} from '../../production/requisitions.js';
import { render, renderRecord } from '../output.js';
import { dateArg, entityArg, listArg, wholeNumber } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

/** A split is given as ITEM:covers pairs, which is how a client writes one. */
function parseSplit(values: readonly string[]): { itemCode: string; covers: number }[] {
  return values.map((entry) => {
    const parts = entry.split(':');
    if (parts.length !== 2) {
      throw invalidInput('cli.split', `${entry} is not an item and a count, write it as ITEM:120`);
    }
    return {
      itemCode: parts[0] ?? '',
      covers: wholeNumber(`the count for ${parts[0] ?? ''}`, parts[1] ?? ''),
    };
  });
}

export function registerSplitCommands(program: Command, makeContext: () => CliContext): void {
  const split = program.command('split').description('the covers per dish in a course');

  split
    .command('set')
    .description('replace the split for one course')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--course <course>', 'the course')
    .requiredOption('--covers <pairs>', 'comma separated ITEM:count pairs')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const rows = setCourseSplit(
          db,
          entityArg('functionSlot', options.function ?? ''),
          options.course ?? '',
          parseSplit(listArg(options.covers ?? '')),
        );
        context.write(
          render(
            rows.map((row) => ({ course: row.course, item: row.itemCode, covers: row.covers })),
            { format: context.format, empty: 'that course carries nothing' },
          ),
        );
      });
    });

  split
    .command('show')
    .description('every split on a function, with anything that does not add up')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const functionId = entityArg('functionSlot', options.function ?? '');
          context.write(
            render(
              listSelections(db, functionId).map((row) => ({
                course: row.course,
                item: row.itemCode,
                covers: row.covers,
              })),
              { format: context.format, empty: 'nothing has been split yet' },
            ),
          );
          const problems = splitProblems(db, functionId);
          for (const problem of problems) {
            context.writeError(
              `the ${problem.course} split adds to ${problem.chosen} against ${problem.expected} standard covers`,
            );
          }
        },
        { readOnly: true },
      );
    });

  split
    .command('clear')
    .description('take every split off a function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const removed = clearSelections(db, entityArg('functionSlot', options.function ?? ''));
        context.write(renderRecord({ removed }, { format: context.format }));
      });
    });
}

export function registerKitchenCommands(program: Command, makeContext: () => CliContext): void {
  const kitchen = program.command('kitchen').description('what the split turns into');

  kitchen
    .command('plates')
    .description('plates per dish, the split and the substitutions together')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              plateDemand(db, entityArg('functionSlot', options.function ?? '')).map((row) => ({
                item: row.itemCode,
                plates: row.plates,
              })),
              {
                format: context.format,
                empty: 'nothing has been split yet',
                columns: [{ key: 'item' }, { key: 'plates', align: 'right' }],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });

  kitchen
    .command('batches')
    .description('whole batches per recipe, by station')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              batchDemand(db, entityArg('functionSlot', options.function ?? '')).map((row) => ({
                station: row.station,
                recipe: row.recipeCode,
                plates: row.plates,
                batches: row.batches,
              })),
              {
                format: context.format,
                empty: 'nothing to make',
                columns: [
                  { key: 'station' },
                  { key: 'recipe' },
                  { key: 'plates', align: 'right' },
                  { key: 'batches', align: 'right' },
                ],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });

  kitchen
    .command('stores')
    .description('what has to come out of the stores, with the waste on the last pack')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              ingredientDemand(db, entityArg('functionSlot', options.function ?? '')).map(
                (row) => ({
                  store: row.store,
                  item: row.ingredientCode,
                  name: row.name,
                  need: formatQuantity(row.needed),
                  packs: row.packs,
                  waste: `${packWastePercent(row)}%`,
                }),
              ),
              { format: context.format, empty: 'nothing to pick' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerRequisitionCommands(program: Command, makeContext: () => CliContext): void {
  const requisition = program.command('req').description('requisitions on the stores');

  requisition
    .command('raise')
    .description('draw a requisition for one store off a set of functions')
    .requiredOption('--date <date>', 'the service date')
    .requiredOption('--area <store>', 'the store area')
    .requiredOption('--functions <ids>', 'comma separated function ids')
    .option('--note <note>', 'anything the store should know', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const raised = raiseRequisition(
          db,
          context.requireProperty(),
          {
            serviceDate: options.date ?? '',
            store: options.area ?? '',
            functionIds: listArg(options.functions ?? ''),
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: raised.id,
              store: raised.store,
              date: raised.serviceDate,
              status: raised.status,
              packs: totalPacks(db, raised.id),
            },
            { format: context.format },
          ),
        );
      });
    });

  requisition
    .command('show')
    .description('the lines on a requisition')
    .requiredOption('--id <id>', 'the requisition')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              requisitionLines(db, entityArg('requisition', options.id ?? '')).map((row) => ({
                item: row.ingredientCode,
                need: formatQuantity(row.needed),
                packs: row.packs,
              })),
              { format: context.format, empty: 'that requisition carries no lines' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  requisition
    .command('list')
    .description('requisitions, filtered')
    .option('--date <date>', 'only this service date')
    .option('--area <store>', 'only this store area')
    .option('--status <status>', 'only this status')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const rows = listRequisitions(db, context.requireProperty(), {
            ...(options.date === undefined ? {} : { serviceDate: dateArg(options.date) }),
            ...(options.area === undefined ? {} : { store: options.area }),
            ...(options.status === undefined ? {} : { status: options.status }),
          });
          context.write(
            render(
              rows.map((row) => ({
                id: row.id,
                date: row.serviceDate,
                store: row.store,
                status: row.status,
                packs: totalPacks(db, row.id),
              })),
              { format: context.format, empty: 'no requisitions match' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  requisition
    .command('advance')
    .description('issue, pick or cancel a requisition')
    .requiredOption('--id <id>', 'the requisition')
    .requiredOption('--to <status>', 'issued, picked or cancelled')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const moved = advanceRequisition(
          db,
          entityArg('requisition', options.id ?? ''),
          options.to ?? '',
        );
        context.write(
          renderRecord({ id: moved.id, status: moved.status }, { format: context.format }),
        );
      });
    });

  requisition
    .command('redraw')
    .description('redraw a draft against the demand as it stands now')
    .requiredOption('--id <id>', 'the requisition')
    .requiredOption('--functions <ids>', 'comma separated function ids')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const lines = refreshRequisition(
          db,
          entityArg('requisition', options.id ?? ''),
          listArg(options.functions ?? ''),
        );
        context.write(
          render(
            lines.map((row) => ({
              item: row.ingredientCode,
              need: formatQuantity(row.needed),
              packs: row.packs,
            })),
            { format: context.format, empty: 'that requisition now carries no lines' },
          ),
        );
      });
    });
}
