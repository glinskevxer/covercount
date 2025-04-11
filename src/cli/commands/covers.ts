/**
 * Commands for the cover count: opening it, moving the guarantee, recording
 * what was served, and the special meals that come out of it.
 */

import type { Command } from 'commander';
import { parseEntityId } from '../../core/ids.js';
import { formatZoned } from '../../core/clock.js';
import { invalidInput } from '../../core/errors.js';
import {
  billedCovers,
  listMovements,
  openCovers,
  overageCovers,
  recordServed,
  requireCovers,
  setGuarantee,
  shortfallCovers,
} from '../../covers/guarantee.js';
import {
  addSpecialMeal,
  allergensInTheRoom,
  assignSubstitute,
  coverBreakdown,
  listSpecialMeals,
  removeSpecialMeal,
} from '../../covers/special.js';
import { render, renderRecord } from '../output.js';
import { withOpenStore, type CliContext } from '../context.js';

function slotId(value: string) {
  return parseEntityId('functionSlot', value);
}

function wholeNumber(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidInput('cli.number', `${label} takes a whole number, got ${value}`);
  }
  return parsed;
}

export function registerCoverCommands(program: Command, makeContext: () => CliContext): void {
  const covers = program.command('covers').description('the guarantee and what was served');

  covers
    .command('open')
    .description('open a cover count and work out when the guarantee closes')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--contract <date>', 'the date the contract was signed')
    .option('--package <code>', 'the menu package sold')
    .option('--book <code>', 'the price book it was quoted from')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const opened = openCovers(db, slotId(options.function ?? ''), {
          contractDate: options.contract ?? '',
          ...(options.package === undefined ? {} : { packageCode: options.package }),
          ...(options.book === undefined ? {} : { priceBookCode: options.book }),
        });
        context.write(
          renderRecord(
            {
              function: opened.functionId,
              package: opened.packageCode ?? '',
              book: opened.priceBookCode ?? '',
              contract: opened.contractDate,
              guaranteeDue: formatZoned(opened.guaranteeDue),
            },
            { format: context.format },
          ),
        );
      });
    });

  covers
    .command('guarantee')
    .description('name the guaranteed cover count')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--covers <covers>', 'the number guaranteed')
    .option('--note <note>', 'why, for the record', '')
    .option('--override-cutoff', 'lower the count after the deadline, on the record')
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const updated = setGuarantee(
          db,
          slotId(String(options.function ?? '')),
          wholeNumber('covers', String(options.covers ?? '')),
          context.now(),
          context.actor,
          {
            note: String(options.note ?? ''),
            overrideCutoff: options.overrideCutoff === true,
          },
        );
        context.write(
          renderRecord(
            {
              function: updated.functionId,
              guaranteed: updated.guaranteedCovers ?? '',
              setFor: updated.setCovers ?? '',
              guaranteeDue: formatZoned(updated.guaranteeDue),
            },
            { format: context.format },
          ),
        );
      });
    });

  covers
    .command('served')
    .description('record the count taken at the pass')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--covers <covers>', 'how many went out')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const updated = recordServed(
          db,
          slotId(options.function ?? ''),
          wholeNumber('covers', options.covers ?? ''),
          context.now(),
        );
        context.write(
          renderRecord(
            {
              function: updated.functionId,
              guaranteed: updated.guaranteedCovers ?? '',
              served: updated.servedCovers ?? '',
              billed: billedCovers(updated),
              overage: overageCovers(updated),
              shortfall: shortfallCovers(updated),
            },
            { format: context.format },
          ),
        );
      });
    });
}

export function registerCoverReadCommands(program: Command, makeContext: () => CliContext): void {
  const count = program.command('count').description('reading a cover count');

  count
    .command('show')
    .description('the guarantee, the plate count and what the room is set for')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const id = slotId(options.function ?? '');
          const covers = requireCovers(db, id);
          const breakdown = coverBreakdown(db, id);
          context.write(
            renderRecord(
              {
                function: id,
                guaranteeDue: formatZoned(covers.guaranteeDue),
                guaranteed: breakdown.guaranteed,
                special: breakdown.special,
                standard: breakdown.standard,
                setFor: breakdown.setFor,
                served: covers.servedCovers ?? '',
                allergens: allergensInTheRoom(db, id).join(', '),
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });

  count
    .command('movements')
    .description('every time the guarantee moved')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listMovements(db, slotId(options.function ?? '')).map((row) => ({
                seq: row.seq,
                at: row.occurredAt,
                actor: row.actor,
                from: row.fromCovers ?? '',
                to: row.toCovers,
                afterCutoff: row.afterCutoff,
                note: row.note,
              })),
              {
                format: context.format,
                empty: 'the guarantee has never been set',
                columns: [
                  { key: 'seq', align: 'right' },
                  { key: 'at' },
                  { key: 'actor' },
                  { key: 'from', align: 'right' },
                  { key: 'to', align: 'right' },
                  { key: 'afterCutoff' },
                  { key: 'note' },
                ],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerSpecialMealCommands(program: Command, makeContext: () => CliContext): void {
  const special = program.command('special').description('special meals inside the guarantee');

  special
    .command('add')
    .description('record a guest who needs something different')
    .requiredOption('--function <id>', 'the function')
    .option('--guest <name>', 'the guest', '')
    .option('--covers <covers>', 'how many covers it is for', '1')
    .option('--diet <diet>', 'the diet they follow')
    .option('--avoid <allergens>', 'comma separated allergens to keep away from')
    .option('--substitute <code>', 'the dish they will be served')
    .option('--note <note>', 'anything else', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const meal = addSpecialMeal(
          db,
          slotId(options.function ?? ''),
          {
            guestName: options.guest ?? '',
            covers: wholeNumber('covers', options.covers ?? '1'),
            ...(options.diet === undefined ? {} : { diet: options.diet }),
            ...(options.avoid === undefined
              ? {}
              : { allergens: options.avoid.split(',').map((part) => part.trim()) }),
            ...(options.substitute === undefined ? {} : { substituteItemCode: options.substitute }),
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: meal.id,
              guest: meal.guestName,
              covers: meal.covers,
              diet: meal.diet ?? '',
              avoids: meal.allergens.join(', '),
              substitute: meal.substituteItemCode ?? '',
            },
            { format: context.format },
          ),
        );
      });
    });

  special
    .command('list')
    .description('the special meals on a function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listSpecialMeals(db, slotId(options.function ?? '')).map((row) => ({
                id: row.id,
                guest: row.guestName,
                covers: row.covers,
                diet: row.diet ?? '',
                avoids: row.allergens.join(', '),
                substitute: row.substituteItemCode ?? '',
                note: row.note,
              })),
              { format: context.format, empty: 'no special meals on that function' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  special
    .command('substitute')
    .description('decide what a special meal will actually be')
    .requiredOption('--id <id>', 'the special meal')
    .requiredOption('--item <code>', 'the dish')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const meal = assignSubstitute(db, wholeNumber('id', options.id ?? ''), options.item ?? '');
        context.write(
          renderRecord(
            { id: meal.id, substitute: meal.substituteItemCode ?? '' },
            { format: context.format },
          ),
        );
      });
    });

  special
    .command('remove')
    .description('take a special meal off')
    .requiredOption('--id <id>', 'the special meal')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const removed = removeSpecialMeal(db, wholeNumber('id', options.id ?? ''));
        context.write(renderRecord({ id: options.id ?? '', removed }, { format: context.format }));
      });
    });
}
