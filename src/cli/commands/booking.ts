/**
 * Commands for the deals themselves: accounts, bookings and the transitions
 * between the stages a booking passes through.
 */

import type { Command } from 'commander';
import { catalogCode, parseEntityId } from '../../core/ids.js';
import { calendarDate } from '../../core/calendar.js';
import { invalidInput } from '../../core/errors.js';
import {
  createAccount,
  listAccounts,
  requireAccount,
  setCreditStatus,
} from '../../booking/accounts.js';
import {
  createBooking,
  listBookings,
  listEvents,
  requireBooking,
  updateBooking,
} from '../../booking/store.js';
import {
  cancelBooking,
  closeBooking,
  makeDefinite,
  makeTentative,
} from '../../booking/lifecycle.js';
import { listFunctions } from '../../booking/functions.js';
import { render, renderRecord } from '../output.js';
import { withOpenStore, type CliContext } from '../context.js';

function bookingId(value: string) {
  return parseEntityId('booking', value);
}

export function registerAccountCommands(program: Command, makeContext: () => CliContext): void {
  const account = program.command('account').description('the accounts we book from');

  account
    .command('add')
    .description('put an account on file')
    .requiredOption('--code <code>', 'short code for the account')
    .requiredOption('--name <name>', 'the name it trades under')
    .requiredOption('--kind <kind>', 'corporate, association, government, social or internal')
    .option('--email <email>', 'where the invoice goes', '')
    .option('--credit <status>', 'approved, prepay or hold', 'APPROVED')
    .option('--exempt <id>', 'tax exemption certificate number', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const created = createAccount(
          db,
          context.requireProperty(),
          {
            code: options.code ?? '',
            name: options.name ?? '',
            kind: options.kind ?? '',
            billingEmail: options.email ?? '',
            creditStatus: options.credit ?? 'APPROVED',
            taxExemptId: options.exempt ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              code: created.code,
              name: created.name,
              kind: created.kind,
              email: created.billingEmail,
              credit: created.creditStatus,
              exempt: created.taxExemptId,
            },
            { format: context.format },
          ),
        );
      });
    });

  account
    .command('list')
    .description('every account on file')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listAccounts(db, context.requireProperty()).map((row) => ({
                code: row.code,
                name: row.name,
                kind: row.kind,
                credit: row.creditStatus,
                exempt: row.taxExemptId.length > 0,
              })),
              { format: context.format, empty: 'no accounts are on file' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  account
    .command('credit')
    .description('move an account credit status')
    .requiredOption('--code <code>', 'the account')
    .requiredOption('--status <status>', 'approved, prepay or hold')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const updated = setCreditStatus(
          db,
          context.requireProperty(),
          catalogCode(options.code ?? ''),
          options.status ?? '',
        );
        context.write(
          renderRecord(
            { code: updated.code, credit: updated.creditStatus },
            { format: context.format },
          ),
        );
      });
    });

  account
    .command('show')
    .description('one account and the bookings on it')
    .requiredOption('--code <code>', 'the account')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const propertyCode = context.requireProperty();
          const code = catalogCode(options.code ?? '');
          const found = requireAccount(db, propertyCode, code);
          context.write(
            renderRecord(
              {
                code: found.code,
                name: found.name,
                kind: found.kind,
                email: found.billingEmail,
                credit: found.creditStatus,
                exempt: found.taxExemptId,
                bookings: listBookings(db, propertyCode, { accountCode: code }).length,
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerBookingCommands(program: Command, makeContext: () => CliContext): void {
  const booking = program.command('booking').description('the deals in the diary');

  booking
    .command('create')
    .description('open a booking as an inquiry')
    .requiredOption('--post-as <name>', 'how it reads on the reader board')
    .requiredOption('--arrival <date>', 'first day of the business')
    .requiredOption('--departure <date>', 'last day of the business')
    .option('--account <code>', 'the account it belongs to')
    .option('--manager <name>', 'the sales manager on it', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const created = createBooking(
          db,
          context.requireProperty(),
          {
            postAs: options.postAs ?? '',
            arrivalDate: options.arrival ?? '',
            departureDate: options.departure ?? '',
            ...(options.account === undefined ? {} : { accountCode: options.account }),
            salesManager: options.manager ?? context.actor,
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: created.id,
              postAs: created.postAs,
              status: created.status,
              account: created.accountCode ?? '',
              arrival: created.arrivalDate,
              departure: created.departureDate,
              manager: created.salesManager,
            },
            { format: context.format },
          ),
        );
      });
    });

  booking
    .command('list')
    .description('bookings, filtered')
    .option('--status <status>', 'inquiry, tentative, definite, cancelled or closed')
    .option('--account <code>', 'only this account')
    .option('--from <date>', 'business overlapping on or after this date')
    .option('--to <date>', 'business overlapping on or before this date')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const rows = listBookings(db, context.requireProperty(), {
            ...(options.status === undefined ? {} : { status: options.status }),
            ...(options.account === undefined ? {} : { accountCode: options.account }),
            ...(options.from === undefined ? {} : { from: options.from }),
            ...(options.to === undefined ? {} : { to: options.to }),
          });
          context.write(
            render(
              rows.map((row) => ({
                id: row.id,
                postAs: row.postAs,
                status: row.status,
                account: row.accountCode ?? '',
                arrival: row.arrivalDate,
                departure: row.departureDate,
              })),
              { format: context.format, empty: 'no bookings match' },
            ),
          );
        },
        { readOnly: true },
      );
    });

  booking
    .command('show')
    .description('one booking with its functions')
    .requiredOption('--id <id>', 'the booking')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          const id = bookingId(options.id ?? '');
          const found = requireBooking(db, id);
          const functions = listFunctions(db, id);
          context.write(
            renderRecord(
              {
                id: found.id,
                postAs: found.postAs,
                status: found.status,
                account: found.accountCode ?? '',
                arrival: found.arrivalDate,
                departure: found.departureDate,
                manager: found.salesManager,
                functions: functions.length,
                cancelReason: found.cancelReason ?? '',
              },
              { format: context.format },
            ),
          );
        },
        { readOnly: true },
      );
    });
}

export function registerBookingChangeCommands(
  program: Command,
  makeContext: () => CliContext,
): void {
  const deal = program.command('deal').description('changing and advancing a booking');

  deal
    .command('edit')
    .description('change a booking that is still live')
    .requiredOption('--id <id>', 'the booking')
    .option('--post-as <name>', 'a new reader board name')
    .option('--account <code>', 'attach an account, or none to detach')
    .option('--arrival <date>', 'a new arrival date')
    .option('--departure <date>', 'a new departure date')
    .option('--manager <name>', 'a new sales manager')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const account =
          options.account === undefined
            ? {}
            : { accountCode: options.account.toLowerCase() === 'none' ? null : options.account };
        const updated = updateBooking(
          db,
          bookingId(options.id ?? ''),
          {
            ...(options.postAs === undefined ? {} : { postAs: options.postAs }),
            ...(options.arrival === undefined ? {} : { arrivalDate: options.arrival }),
            ...(options.departure === undefined ? {} : { departureDate: options.departure }),
            ...(options.manager === undefined ? {} : { salesManager: options.manager }),
            ...account,
          },
          context.now(),
          context.actor,
        );
        context.write(
          renderRecord(
            {
              id: updated.id,
              postAs: updated.postAs,
              account: updated.accountCode ?? '',
              arrival: updated.arrivalDate,
              departure: updated.departureDate,
            },
            { format: context.format },
          ),
        );
      });
    });

  deal
    .command('advance')
    .description('move a booking to its next stage')
    .requiredOption('--id <id>', 'the booking')
    .requiredOption('--to <status>', 'tentative, definite, cancelled or closed')
    .option('--reason <reason>', 'why, required to cancel')
    .option('--today <date>', 'the date the office believes it is, required to close')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const id = bookingId(options.id ?? '');
        const to = (options.to ?? '').trim().toUpperCase();
        const now = context.now();
        let updated;
        switch (to) {
          case 'TENTATIVE':
            updated = makeTentative(db, id, now, context.actor);
            break;
          case 'DEFINITE':
            updated = makeDefinite(db, id, now, context.actor);
            break;
          case 'CANCELLED':
            updated = cancelBooking(db, id, options.reason ?? '', now, context.actor);
            break;
          case 'CLOSED':
            if (options.today === undefined) {
              throw invalidInput('cli.today', 'closing a booking needs --today');
            }
            updated = closeBooking(db, id, calendarDate(options.today), now, context.actor);
            break;
          default:
            throw invalidInput(
              'cli.status',
              `${options.to ?? ''} is not a stage a booking reaches`,
            );
        }
        context.write(
          renderRecord({ id: updated.id, status: updated.status }, { format: context.format }),
        );
      });
    });

  deal
    .command('history')
    .description('everything that happened to a booking')
    .requiredOption('--id <id>', 'the booking')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
          context.write(
            render(
              listEvents(db, bookingId(options.id ?? '')).map((row) => ({
                seq: row.seq,
                at: row.occurredAt,
                actor: row.actor,
                kind: row.kind,
                detail: row.detail,
              })),
              {
                format: context.format,
                empty: 'nothing has happened to that booking',
                columns: [
                  { key: 'seq', align: 'right' },
                  { key: 'at' },
                  { key: 'actor' },
                  { key: 'kind' },
                  { key: 'detail' },
                ],
              },
            ),
          );
        },
        { readOnly: true },
      );
    });
}
