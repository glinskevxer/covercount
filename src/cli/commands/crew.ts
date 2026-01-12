/**
 * Commands for the crew: the staffing rules a property works to, the rates it
 * pays, and the roster on one function.
 */

import type { Command } from 'commander';
import { formatMoney } from '../../core/money.js';
import {
  headCounts,
  labourRateHistory,
  listStaffingRules,
  setLabourRate,
  setStaffingRule,
} from '../../labour/staffing.js';
import {
  addShift,
  buildRoster,
  listShifts,
  removeShift,
  rosterSummary,
  shiftCost,
} from '../../labour/shifts.js';
import { isRole } from '../../labour/types.js';
import {
  checkDistribution,
  distributeServiceCharge,
  findDistribution,
  listDistributionPoints,
  setDistributionPoints,
} from '../../labour/distribution.js';
import { invalidInput } from '../../core/errors.js';
import { columns, render, renderRecord } from '../output.js';
import { entityArg, moneyArg, serviceStyleArg, wholeNumber } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

function role(value: string) {
  const normalised = value.trim().toUpperCase();
  if (!isRole(normalised)) {
    throw invalidInput('cli.role', `${value} is not a role this property rosters`);
  }
  return normalised;
}

export function registerStaffingCommands(program: Command, makeContext: () => CliContext): void {
  const staffing = program
    .command('staffing')
    .description('the ratios and rates a property works to');

  staffing
    .command('rule')
    .description('one head per so many covers, for a service style and a role')
    .requiredOption('--style <style>', 'the service style')
    .requiredOption('--role <role>', 'the role')
    .requiredOption('--per <covers>', 'covers per head, or servers per head for a captain')
    .option('--minimum <heads>', 'the fewest ever called in', '0')
    .option('--call <hours>', 'the shortest shift the property pays', '4')
    .option('--lead-in <minutes>', 'minutes before the function', '60')
    .option('--lead-out <minutes>', 'minutes after it', '30')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const rule = setStaffingRule(db, context.requireProperty(), {
          serviceStyle: options.style ?? '',
          role: options.role ?? '',
          coversPerHead: wholeNumber('covers per head', options.per ?? ''),
          minimumHeads: wholeNumber('minimum', options.minimum ?? '0'),
          minimumHours: wholeNumber('call', options.call ?? '4'),
          leadInMinutes: wholeNumber('lead in', options.leadIn ?? '60'),
          leadOutMinutes: wholeNumber('lead out', options.leadOut ?? '30'),
        });
        context.write(
          renderRecord(
            {
              style: rule.serviceStyle,
              role: rule.role,
              per: rule.coversPerHead,
              minimum: rule.minimumHeads,
              call: rule.minimumHours,
            },
            { format: context.format },
          ),
        );
      });
    });

  staffing
    .command('rules')
    .description('the ratios for one service style')
    .requiredOption('--style <style>', 'the service style')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listStaffingRules(
                db,
                context.requireProperty(),
                serviceStyleArg(options.style ?? ''),
              ).map((row) => ({
                role: row.role,
                per: row.coversPerHead,
                minimum: row.minimumHeads,
                call: row.minimumHours,
              })),
              { format: context.format, empty: 'that style carries no rules' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  staffing
    .command('rate')
    .description('what a role is paid from a date')
    .requiredOption('--role <role>', 'the role')
    .requiredOption('--from <date>', 'the date it takes effect')
    .requiredOption('--hourly <amount>', 'the hourly rate')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const rate = setLabourRate(
          db,
          context.requireProperty(),
          options.role ?? '',
          options.from ?? '',
          moneyArg('hourly', options.hourly ?? '').amount,
        );
        context.write(
          renderRecord(
            { role: rate.role, from: rate.effectiveFrom, hourly: formatMoney(rate.hourly) },
            { format: context.format },
          ),
        );
      });
    });

  staffing
    .command('rates')
    .description('every rate a role has ever been paid')
    .requiredOption('--role <role>', 'the role')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              labourRateHistory(db, context.requireProperty(), role(options.role ?? '')).map(
                (row) => ({ from: row.effectiveFrom, hourly: formatMoney(row.hourly) }),
              ),
              { format: context.format, empty: 'that role has never been priced' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  staffing
    .command('heads')
    .description('what a cover count works out to, before anything is rostered')
    .requiredOption('--style <style>', 'the service style')
    .requiredOption('--covers <covers>', 'the covers')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              headCounts(
                db,
                context.requireProperty(),
                serviceStyleArg(options.style ?? ''),
                wholeNumber('covers', options.covers ?? ''),
              ).map((row) => ({ role: row.role, heads: row.heads, per: row.rule.coversPerHead })),
              { format: context.format, empty: 'that style carries no rules' },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerCrewCommands(program: Command, makeContext: () => CliContext): void {
  const crew = program.command('crew').description('the roster on one function');

  crew
    .command('build')
    .description('roster the function off the covers the room is set for')
    .requiredOption('--function <id>', 'the function')
    .option('--covers <count>', 'work it out against this count instead')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const shifts = buildRoster(
          db,
          entityArg('functionSlot', options.function ?? ''),
          context.now(),
          {
            ...(options.covers === undefined
              ? {}
              : { covers: wholeNumber('covers', options.covers) }),
          },
        );
        context.write(
          render(
            shifts.map((row) => ({
              id: row.id,
              role: row.role,
              heads: row.heads,
              from: row.startMinute,
              to: row.endMinute,
              hourly: formatMoney(row.hourly),
              cost: formatMoney(shiftCost(row)),
            })),
            { format: context.format, empty: 'nobody to call in' },
          ),
        );
      });
    });

  crew
    .command('add')
    .description('add a shift the rules did not produce')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--role <role>', 'the role')
    .requiredOption('--heads <count>', 'how many')
    .requiredOption('--from <minute>', 'the minute of the day they start')
    .requiredOption('--to <minute>', 'the minute they finish')
    .option('--hourly <amount>', 'an hourly rate, if it is not the one on file')
    .option('--note <note>', 'why', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const shift = addShift(
          db,
          entityArg('functionSlot', options.function ?? ''),
          {
            role: options.role ?? '',
            heads: wholeNumber('heads', options.heads ?? ''),
            startMinute: wholeNumber('from', options.from ?? ''),
            endMinute: wholeNumber('to', options.to ?? ''),
            ...(options.hourly === undefined
              ? {}
              : { hourlyMinor: moneyArg('hourly', options.hourly).amount }),
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: shift.id,
              role: shift.role,
              heads: shift.heads,
              cost: formatMoney(shiftCost(shift)),
            },
            { format: context.format },
          ),
        );
      });
    });

  crew
    .command('show')
    .description('who is called in, and what it comes to')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const functionId = entityArg('functionSlot', options.function ?? '');
          const summary = rosterSummary(db, functionId);
          context.write(
            render(
              listShifts(db, functionId).map((row) => ({
                id: row.id,
                role: row.role,
                heads: row.heads,
                from: row.startMinute,
                to: row.endMinute,
                cost: formatMoney(shiftCost(row)),
              })),
              { format: context.format, empty: 'nobody is called in' },
            ),
          );
          if (summary.heads > 0 && context.format !== 'json') {
            context.write('');
            context.write(
              `${summary.heads} heads, ${summary.headHours.toFixed(1)} head hours, ${formatMoney(summary.cost)}`,
            );
          }
          for (const unpriced of summary.unpriced) {
            context.writeError(`${unpriced} carries no rate on the service date`);
          }
        },
        { readOnly: true },
      );
    });

  crew
    .command('remove')
    .description('take a shift off')
    .requiredOption('--id <id>', 'the shift')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const removed = removeShift(db, entityArg('shift', options.id ?? ''));
        context.write(renderRecord({ id: options.id ?? '', removed }, { format: context.format }));
      });
    });
}

export function registerDistributionCommands(
  program: Command,
  makeContext: () => CliContext,
): void {
  const pool = program
    .command('pool')
    .description('handing the service charge back out to the crew');

  pool
    .command('points')
    .description('publish the points a role earns in the split')
    .requiredOption('--role <role>', 'the role')
    .requiredOption('--points <points>', 'points, relative to the other roles')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const row = setDistributionPoints(
          db,
          context.requireProperty(),
          options.role ?? '',
          wholeNumber('points', options.points ?? ''),
        );
        context.write(
          renderRecord({ role: row.role, points: row.points }, { format: context.format }),
        );
      });
    });

  pool
    .command('table')
    .description('the points every role earns')
    .action(() => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            listDistributionPoints(db, context.requireProperty()).map((row) => ({
              role: row.role,
              points: row.points,
            })),
            {
              format: context.format,
              empty: 'no points are published, so every role earns one',
              columns: columns('role', 'points>'),
            },
          ),
        );
      });
    });

  pool
    .command('split')
    .description('split the service charge on an invoice across the crew')
    .requiredOption('--invoice <id>', 'the invoice')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const result = distributeServiceCharge(
          db,
          entityArg('invoice', options.invoice ?? ''),
          context.now(),
        );
        context.write(
          render(
            result.lines.map((line) => ({
              role: line.role,
              hours: (line.headHoursThousandths / 1000).toFixed(2),
              points: line.points,
              share: formatMoney(line.share),
            })),
            {
              format: context.format,
              empty: 'nobody worked it',
              columns: columns('role', 'hours>', 'points>', 'share>'),
            },
          ),
        );
      });
    });

  pool
    .command('check')
    .description('whether a recorded split still matches the invoice')
    .requiredOption('--invoice <id>', 'the invoice')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const id = entityArg('invoice', options.invoice ?? '');
        if (findDistribution(db, id) === undefined) {
          context.write('that service charge has not been handed out yet');
          return;
        }
        const check = checkDistribution(db, id);
        context.write(
          renderRecord(
            {
              pool: formatMoney(check.recordedPool),
              now: formatMoney(check.currentPool),
              shares: formatMoney(check.sharesTotal),
              addsUp: check.addsUp,
              stale: check.stale,
            },
            { format: context.format },
          ),
        );
      });
    });
}
