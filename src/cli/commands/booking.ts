/**
 * Commands for the deals themselves: accounts, bookings and the transitions
 * between the stages a booking passes through.
 */

import type { Command } from 'commander';
import { catalogCode } from '../../core/ids.js';
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
import {
  assessDamages,
  cancellationBands,
  removeCancellationBand,
  setCancellationBand,
} from '../../booking/damages.js';
import {
  bookAppointment,
  cancelAppointment,
  listAppointments,
  recordOutcome,
  tastingWindow,
} from '../../booking/appointments.js';
import { formatRate } from '../../core/rate.js';
import { formatMoney } from '../../core/money.js';
import { columns, render, renderRecord } from '../output.js';
import { blockMinute, codeArg, dateArg, entityArg, percentToPpm, wholeNumber } from '../args.js';
import { onReadStore, onStore, type CliContext } from '../context.js';

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
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );

  account
    .command('list')
    .description('every account on file')
    .action(
      onReadStore(makeContext, (db, context) => {
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
      }),
    );

  account
    .command('credit')
    .description('move an account credit status')
    .requiredOption('--code <code>', 'the account')
    .requiredOption('--status <status>', 'approved, prepay or hold')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );

  account
    .command('show')
    .description('one account and the bookings on it')
    .requiredOption('--code <code>', 'the account')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );
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
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );

  booking
    .command('list')
    .description('bookings, filtered')
    .option('--status <status>', 'inquiry, tentative, definite, cancelled or closed')
    .option('--account <code>', 'only this account')
    .option('--from <date>', 'business overlapping on or after this date')
    .option('--to <date>', 'business overlapping on or before this date')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
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
      }),
    );

  booking
    .command('show')
    .description('one booking with its functions')
    .requiredOption('--id <id>', 'the booking')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const id = entityArg('booking', options.id ?? '');
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
      }),
    );
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
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const account =
          options.account === undefined
            ? {}
            : { accountCode: options.account.toLowerCase() === 'none' ? null : options.account };
        const updated = updateBooking(
          db,
          entityArg('booking', options.id ?? ''),
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
      }),
    );

  deal
    .command('advance')
    .description('move a booking to its next stage')
    .requiredOption('--id <id>', 'the booking')
    .requiredOption('--to <status>', 'tentative, definite, cancelled or closed')
    .option('--reason <reason>', 'why, required to cancel')
    .option('--today <date>', 'the date the office believes it is, required to close')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const id = entityArg('booking', options.id ?? '');
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
      }),
    );

  deal
    .command('history')
    .description('everything that happened to a booking')
    .requiredOption('--id <id>', 'the booking')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            listEvents(db, entityArg('booking', options.id ?? '')).map((row) => ({
              seq: row.seq,
              at: row.occurredAt,
              actor: row.actor,
              kind: row.kind,
              detail: row.detail,
            })),
            {
              format: context.format,
              empty: 'nothing has happened to that booking',
              columns: columns('seq>', 'at', 'actor', 'kind', 'detail'),
            },
          ),
        );
      }),
    );
}

export function registerDamagesCommands(program: Command, makeContext: () => CliContext): void {
  const damages = program
    .command('damages')
    .description('what a cancellation costs, and the scale it comes off');

  damages
    .command('band')
    .description('publish one band of the cancellation scale')
    .requiredOption('--days <days>', 'days before the function the band starts at')
    .requiredOption('--percent <percent>', 'how much of the contract is owed')
    .option('--note <text>', 'the clause it comes from')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const band = setCancellationBand(
          db,
          context.requireProperty(),
          wholeNumber('days', options.days ?? ''),
          percentToPpm('percent', options.percent ?? ''),
          options.note ?? '',
        );
        context.write(
          renderRecord(
            { days: band.daysBefore, charge: formatRate(band.charge), note: band.note },
            { format: context.format },
          ),
        );
      }),
    );

  damages
    .command('scale')
    .description('the whole published scale')
    .action(
      onStore(makeContext, (db, context) => {
        context.write(
          render(
            cancellationBands(db, context.requireProperty()).map((band) => ({
              days: band.daysBefore,
              charge: formatRate(band.charge),
              note: band.note,
            })),
            {
              format: context.format,
              empty: 'this property publishes no cancellation scale',
              columns: columns('days>', 'charge>', 'note'),
            },
          ),
        );
      }),
    );

  damages
    .command('drop')
    .description('take one band off the scale')
    .requiredOption('--days <days>', 'the band to remove')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const removed = removeCancellationBand(
          db,
          context.requireProperty(),
          wholeNumber('days', options.days ?? ''),
        );
        context.write(renderRecord({ removed }, { format: context.format }));
      }),
    );

  damages
    .command('quote')
    .description('what this booking owes if it walks on a date')
    .requiredOption('--booking <id>', 'the booking')
    .requiredOption('--on <date>', 'the date notice is given')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const assessment = assessDamages(
          db,
          entityArg('booking', options.booking ?? ''),
          dateArg(options.on ?? ''),
        );
        context.write(
          render(
            assessment.lines.map((line) => ({
              function: line.name,
              date: line.serviceDate,
              out: line.daysOut,
              band: formatRate(line.band.charge),
              contracted: formatMoney(line.contracted),
              owed: formatMoney(line.damages),
            })),
            {
              format: context.format,
              empty: 'nothing left to cancel',
              columns: columns('function', 'date', 'out>', 'band>', 'contracted>', 'owed>'),
            },
          ),
        );
      }),
    );
}

export function registerAppointmentCommands(program: Command, makeContext: () => CliContext): void {
  const meet = program.command('meet').description('tastings, site visits and the pre con');

  meet
    .command('book')
    .description('put an appointment in the diary')
    .requiredOption('--booking <id>', 'the booking')
    .requiredOption('--kind <kind>', 'tasting, site-visit, pre-con or planning')
    .requiredOption('--date <date>', 'the date')
    .requiredOption('--start <time>', 'start time as HH:MM')
    .requiredOption('--end <time>', 'end time as HH:MM')
    .option('--room <code>', 'the room, if it needs one')
    .option('--who <names>', 'who is coming')
    .option('--note <text>', 'anything worth remembering')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const appointment = bookAppointment(
          db,
          entityArg('booking', options.booking ?? ''),
          {
            kind: options.kind ?? '',
            onDate: dateArg(options.date ?? ''),
            startMinute: blockMinute('start', options.start ?? ''),
            endMinute: blockMinute('end', options.end ?? ''),
            ...(options.room === undefined ? {} : { spaceCode: codeArg(options.room) }),
            attendees: options.who ?? '',
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: appointment.id,
              kind: appointment.kind,
              date: appointment.onDate,
              room: appointment.spaceCode ?? '',
              who: appointment.attendees,
            },
            { format: context.format },
          ),
        );
      }),
    );

  meet
    .command('list')
    .description('every appointment on a booking')
    .requiredOption('--booking <id>', 'the booking')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            listAppointments(db, entityArg('booking', options.booking ?? '')).map((row) => ({
              id: row.id,
              kind: row.kind,
              date: row.onDate,
              room: row.spaceCode ?? '',
              who: row.attendees,
              outcome: row.outcome ?? '',
            })),
            {
              format: context.format,
              empty: 'nothing is in the diary for that booking',
              columns: columns('id>', 'kind', 'date', 'room', 'who', 'outcome'),
            },
          ),
        );
      }),
    );

  meet
    .command('outcome')
    .description('write down what came out of it')
    .requiredOption('--id <id>', 'the appointment')
    .requiredOption('--said <text>', 'what was decided')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const appointment = recordOutcome(
          db,
          wholeNumber('appointment', options.id ?? ''),
          options.said ?? '',
        );
        context.write(
          renderRecord(
            { id: appointment.id, outcome: appointment.outcome ?? '' },
            { format: context.format },
          ),
        );
      }),
    );

  meet
    .command('drop')
    .description('take an appointment out of the diary')
    .requiredOption('--id <id>', 'the appointment')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const removed = cancelAppointment(db, wholeNumber('appointment', options.id ?? ''));
        context.write(renderRecord({ cancelled: removed }, { format: context.format }));
      }),
    );

  meet
    .command('window')
    .description('whether a tasting still changes anything')
    .requiredOption('--booking <id>', 'the booking')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const window = tastingWindow(db, entityArg('booking', options.booking ?? ''));
        context.write(
          renderRecord(
            {
              firstService: window.firstService,
              closesOn: window.closesOn,
              booked: window.booked.length,
              tooLate: window.tooLate.length,
            },
            { format: context.format },
          ),
        );
      }),
    );
}
