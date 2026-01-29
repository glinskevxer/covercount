/**
 * Commands for the money: tax profiles, charge lines, invoices and payments.
 */

import type { Command } from 'commander';
import { catalogCode, parseEntityId } from '../../core/ids.js';
import { formatMoney, parseMoney } from '../../core/money.js';
import { formatRate } from '../../core/rate.js';
import { createTaxProfile, listTaxProfiles, setTaxRate, taxRates } from '../../billing/tax.js';
import {
  addCharge,
  addUpcharge,
  drawPackageCharges,
  lineTotal,
  listCharges,
  removeCharge,
  removeChargesFrom,
} from '../../billing/charges.js';
import {
  advanceInvoice,
  invoiceTotals,
  listInvoices,
  listPayments,
  raiseInvoice,
  recordPayment,
  requireInvoice,
} from '../../billing/invoice.js';
import {
  clearRevenueMinimum,
  findRevenueMinimum,
  minimumStanding,
  setRevenueMinimum,
  sweepMinimum,
} from '../../billing/minimum.js';
import { accountStatement, setCreditTerms } from '../../billing/statement.js';
import { columns, render, renderRecord } from '../output.js';
import { dateArg, entityArg, moneyArg, percentToPpm, wholeNumber } from '../args.js';
import { onReadStore, onStore, type CliContext } from '../context.js';

export function registerTaxCommands(program: Command, makeContext: () => CliContext): void {
  const tax = program.command('tax').description('tax profiles and the rates in them');

  tax
    .command('profile')
    .description('put a tax profile on file')
    .requiredOption('--code <code>', 'short code for the profile')
    .requiredOption('--name <name>', 'the jurisdiction it covers')
    .option('--service <percent>', 'service charge percentage', '0')
    .option('--gratuity <percent>', 'gratuity percentage', '0')
    .option('--service-untaxed', 'the service charge is not itself taxable')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const created = createTaxProfile(
          db,
          context.requireProperty(),
          {
            code: String(options.code ?? ''),
            name: String(options.name ?? ''),
            serviceChargePpm: percentToPpm('service charge', String(options.service ?? '0')),
            gratuityPpm: percentToPpm('gratuity', String(options.gratuity ?? '0')),
            serviceChargeTaxable: options.serviceUntaxed !== true,
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              code: created.code,
              name: created.name,
              service: formatRate(created.serviceCharge),
              gratuity: formatRate(created.gratuity),
              serviceTaxable: created.serviceChargeTaxable,
            },
            { format: context.format },
          ),
        );
      }),
    );

  tax
    .command('rate')
    .description('set the sales tax rate for one charge category')
    .requiredOption('--profile <code>', 'the profile')
    .requiredOption('--category <category>', 'food, beverage, rental, av, labor, service or fee')
    .requiredOption('--percent <percent>', 'the rate')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const propertyCode = context.requireProperty();
        const profile = catalogCode(options.profile ?? '');
        setTaxRate(
          db,
          propertyCode,
          profile,
          options.category ?? '',
          percentToPpm('rate', options.percent ?? '0'),
        );
        context.write(
          render(
            taxRates(db, propertyCode, profile).map((row) => ({
              category: row.category,
              rate: formatRate(row.rate),
            })),
            { format: context.format },
          ),
        );
      }),
    );

  tax
    .command('list')
    .description('every tax profile on file')
    .action(
      onReadStore(makeContext, (db, context) => {
        context.write(
          render(
            listTaxProfiles(db, context.requireProperty()).map((row) => ({
              code: row.code,
              name: row.name,
              service: formatRate(row.serviceCharge),
              gratuity: formatRate(row.gratuity),
              serviceTaxable: row.serviceChargeTaxable,
            })),
            { format: context.format, empty: 'no tax profiles are on file' },
          ),
        );
      }),
    );
}

export function registerChargeCommands(program: Command, makeContext: () => CliContext): void {
  const charge = program.command('charge').description('what goes on the bill');

  charge
    .command('add')
    .description('put a line on a function')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--category <category>', 'the charge category')
    .requiredOption('--description <text>', 'what it is')
    .requiredOption('--quantity <count>', 'how many')
    .requiredOption('--unit <amount>', 'the unit price')
    .option('--item <code>', 'the catalog item behind it')
    .option('--no-tax', 'the line is not taxable')
    .option('--service', 'the service charge falls on this line')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const line = addCharge(db, entityArg('functionSlot', String(options.function ?? '')), {
          category: String(options.category ?? ''),
          description: String(options.description ?? ''),
          quantity: wholeNumber('quantity', String(options.quantity ?? '')),
          unitMinor: parseMoney(String(options.unit ?? ''), 'USD').amount,
          ...(options.item === undefined ? {} : { itemCode: String(options.item) }),
          ...(options.tax === false ? { taxable: false } : {}),
          ...(options.service === true ? { serviceable: true } : {}),
        });
        context.write(
          renderRecord(
            {
              id: line.id,
              category: line.category,
              description: line.description,
              quantity: line.quantity,
              unit: formatMoney(line.unit),
              total: formatMoney(lineTotal(line)),
              taxable: line.taxable,
              serviceable: line.serviceable,
            },
            { format: context.format },
          ),
        );
      }),
    );

  charge
    .command('package')
    .description('draw the package line off the guarantee and the price book')
    .requiredOption('--function <id>', 'the function')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const drawn = drawPackageCharges(db, entityArg('functionSlot', options.function ?? ''));
        context.write(
          render(
            drawn.map((row) => ({
              id: row.id,
              description: row.description,
              quantity: row.quantity,
              unit: formatMoney(row.unit),
              total: formatMoney(lineTotal(row)),
            })),
            { format: context.format },
          ),
        );
      }),
    );

  charge
    .command('upcharge')
    .description('bill an upcharge item to the covers that took it')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--item <code>', 'the upcharge item')
    .requiredOption('--covers <count>', 'how many took it')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const line = addUpcharge(
          db,
          entityArg('functionSlot', options.function ?? ''),
          options.item ?? '',
          wholeNumber('covers', options.covers ?? ''),
        );
        context.write(
          renderRecord(
            {
              id: line.id,
              description: line.description,
              quantity: line.quantity,
              unit: formatMoney(line.unit),
              total: formatMoney(lineTotal(line)),
            },
            { format: context.format },
          ),
        );
      }),
    );

  charge
    .command('list')
    .description('every line on a function')
    .requiredOption('--function <id>', 'the function')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            listCharges(db, entityArg('functionSlot', options.function ?? '')).map((row) => ({
              id: row.id,
              category: row.category,
              description: row.description,
              quantity: row.quantity,
              unit: formatMoney(row.unit),
              total: formatMoney(lineTotal(row)),
              source: row.source,
            })),
            { format: context.format, empty: 'nothing is on that function yet' },
          ),
        );
      }),
    );

  charge
    .command('remove')
    .description('take a line off')
    .requiredOption('--id <id>', 'the line')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const removed = removeCharge(db, wholeNumber('id', options.id ?? ''));
        context.write(renderRecord({ id: options.id ?? '', removed }, { format: context.format }));
      }),
    );
}

export function registerInvoiceCommands(program: Command, makeContext: () => CliContext): void {
  const invoice = program.command('invoice').description('invoices and what has been paid');

  invoice
    .command('raise')
    .description('raise an invoice against a booking')
    .requiredOption('--booking <id>', 'the booking')
    .requiredOption('--profile <code>', 'the tax profile to bill under')
    .option('--note <note>', 'anything the client should see', '')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const raised = raiseInvoice(
          db,
          context.requireProperty(),
          {
            bookingId: options.booking ?? '',
            taxProfileCode: options.profile ?? '',
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              id: raised.id,
              booking: raised.bookingId,
              profile: raised.taxProfileCode,
              status: raised.status,
            },
            { format: context.format },
          ),
        );
      }),
    );

  invoice
    .command('show')
    .description('the totals on an invoice')
    .requiredOption('--id <id>', 'the invoice')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const id = parseEntityId('invoice', options.id ?? '');
        const found = requireInvoice(db, id);
        const totals = invoiceTotals(db, id);
        context.write(
          renderRecord(
            {
              id: found.id,
              booking: found.bookingId,
              profile: found.taxProfileCode,
              status: found.status,
              net: formatMoney(totals.net),
              serviceCharge: formatMoney(totals.serviceCharge),
              gratuity: formatMoney(totals.gratuity),
              tax: formatMoney(totals.tax),
              gross: formatMoney(totals.gross),
              paid: formatMoney(totals.paid),
              balance: formatMoney(totals.balance),
            },
            { format: context.format },
          ),
        );
      }),
    );

  invoice
    .command('breakdown')
    .description('the totals per charge category')
    .requiredOption('--id <id>', 'the invoice')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const totals = invoiceTotals(db, parseEntityId('invoice', options.id ?? ''));
        context.write(
          render(
            totals.lines.map((row) => ({
              category: row.category,
              net: formatMoney(row.net),
              serviceCharge: formatMoney(row.serviceCharge),
              tax: formatMoney(row.tax),
            })),
            { format: context.format, empty: 'nothing is on that invoice' },
          ),
        );
      }),
    );
}

export function registerPaymentCommands(program: Command, makeContext: () => CliContext): void {
  const settle = program.command('settle').description('paying an invoice off');

  settle
    .command('pay')
    .description('record a deposit, a payment or a refund')
    .requiredOption('--id <id>', 'the invoice')
    .requiredOption('--kind <kind>', 'deposit, payment, refund or write-off')
    .requiredOption('--amount <amount>', 'how much')
    .option('--reference <text>', 'the wire or cheque reference', '')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const payment = recordPayment(
          db,
          parseEntityId('invoice', options.id ?? ''),
          {
            kind: options.kind ?? '',
            amountMinor: parseMoney(options.amount ?? '', 'USD').amount,
            reference: options.reference ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              seq: payment.seq,
              kind: payment.kind,
              amount: formatMoney(payment.amount),
              reference: payment.reference,
            },
            { format: context.format },
          ),
        );
      }),
    );

  settle
    .command('payments')
    .description('everything that has landed against an invoice')
    .requiredOption('--id <id>', 'the invoice')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        context.write(
          render(
            listPayments(db, parseEntityId('invoice', options.id ?? '')).map((row) => ({
              seq: row.seq,
              at: row.receivedAt,
              kind: row.kind,
              amount: formatMoney(row.amount),
              reference: row.reference,
            })),
            { format: context.format, empty: 'nothing has been paid yet' },
          ),
        );
      }),
    );

  settle
    .command('advance')
    .description('issue, settle or void an invoice')
    .requiredOption('--id <id>', 'the invoice')
    .requiredOption('--to <status>', 'issued, paid or void')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const moved = advanceInvoice(
          db,
          parseEntityId('invoice', options.id ?? ''),
          options.to ?? '',
          context.now(),
        );
        context.write(
          renderRecord({ id: moved.id, status: moved.status }, { format: context.format }),
        );
      }),
    );

  settle
    .command('list')
    .description('invoices, filtered')
    .option('--booking <id>', 'only this booking')
    .option('--status <status>', 'only this status')
    .action(
      onReadStore(makeContext, (db, context, options: Record<string, string>) => {
        const rows = listInvoices(db, context.requireProperty(), {
          ...(options.booking === undefined ? {} : { bookingId: options.booking }),
          ...(options.status === undefined ? {} : { status: options.status }),
        });
        context.write(
          render(
            rows.map((row) => ({
              id: row.id,
              booking: row.bookingId,
              profile: row.taxProfileCode,
              status: row.status,
              gross: formatMoney(invoiceTotals(db, row.id).gross),
            })),
            { format: context.format, empty: 'no invoices match' },
          ),
        );
      }),
    );
}

export function registerMinimumCommands(program: Command, makeContext: () => CliContext): void {
  const minimum = program
    .command('minimum')
    .description('the food and beverage floor a function is sold against');

  minimum
    .command('set')
    .description('put a minimum on a function')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--amount <amount>', 'the floor, as money')
    .option('--food-only', 'count food alone, leaving the bar out of it')
    .option('--note <text>', 'the contract clause it comes from')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string | boolean>) => {
        const record = setRevenueMinimum(
          db,
          entityArg('functionSlot', String(options.function ?? '')),
          {
            minimumMinor: moneyArg('minimum', String(options.amount ?? '')).amount,
            countsBeverage: options.foodOnly !== true,
            note: typeof options.note === 'string' ? options.note : '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              minimum: formatMoney(record.minimum),
              counts: record.countsBeverage ? 'food and beverage' : 'food only',
              note: record.note,
            },
            { format: context.format },
          ),
        );
      }),
    );

  minimum
    .command('show')
    .description('where the function stands against its minimum')
    .requiredOption('--function <id>', 'the function')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const id = entityArg('functionSlot', options.function ?? '');
        if (findRevenueMinimum(db, id) === undefined) {
          context.write('that function is not sold against a minimum');
          return;
        }
        const standing = minimumStanding(db, id);
        context.write(
          renderRecord(
            {
              minimum: formatMoney(standing.minimum),
              achieved: formatMoney(standing.achieved),
              shortfall: formatMoney(standing.shortfall),
              counts: standing.categories.join(' and '),
              met: standing.met,
            },
            { format: context.format },
          ),
        );
      }),
    );

  minimum
    .command('sweep')
    .description('put the shortfall on the bill, or take it back off')
    .requiredOption('--function <id>', 'the function')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const result = sweepMinimum(db, entityArg('functionSlot', options.function ?? ''));
        context.write(
          renderRecord(
            {
              shortfall: formatMoney(result.standing.shortfall),
              billed:
                result.charge === undefined ? 'nothing' : formatMoney(lineTotal(result.charge)),
              replaced: result.removed,
            },
            { format: context.format },
          ),
        );
      }),
    );

  minimum
    .command('clear')
    .description('take the minimum off a function entirely')
    .requiredOption('--function <id>', 'the function')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const id = entityArg('functionSlot', options.function ?? '');
        const removed = clearRevenueMinimum(db, id);
        context.write(
          renderRecord(
            { cleared: removed, lines: removeChargesFrom(db, id, 'MINIMUM') },
            { format: context.format },
          ),
        );
      }),
    );
}

export function registerStatementCommands(program: Command, makeContext: () => CliContext): void {
  const statement = program
    .command('statement')
    .description('what an account owes, and how long it has owed it');

  statement
    .command('terms')
    .description('how long an account has to pay')
    .requiredOption('--account <code>', 'the account')
    .requiredOption('--net <days>', 'days from issue to due')
    .option('--limit <amount>', 'credit limit, nil for none', '0')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const terms = setCreditTerms(
          db,
          context.requireProperty(),
          catalogCode(options.account ?? ''),
          wholeNumber('net days', options.net ?? ''),
          moneyArg('limit', options.limit ?? '0').amount,
        );
        context.write(
          renderRecord(
            {
              account: terms.accountCode,
              net: terms.netDays,
              limit: formatMoney(terms.creditLimit),
            },
            { format: context.format },
          ),
        );
      }),
    );

  statement
    .command('show')
    .description('the statement for one account')
    .requiredOption('--account <code>', 'the account')
    .requiredOption('--on <date>', 'the date to age it at')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const found = accountStatement(
          db,
          context.requireProperty(),
          catalogCode(options.account ?? ''),
          dateArg(options.on ?? ''),
        );
        context.write(
          render(
            found.lines.map((line) => ({
              invoice: line.invoiceId,
              posted: line.postAs,
              issued: line.issuedOn,
              due: line.dueOn,
              age: line.bucket,
              gross: formatMoney(line.gross),
              balance: formatMoney(line.balance),
            })),
            {
              format: context.format,
              empty: 'that account has nothing outstanding',
              columns: columns('invoice', 'posted', 'issued', 'due', 'age', 'gross>', 'balance>'),
            },
          ),
        );
      }),
    );

  statement
    .command('ageing')
    .description('the balance by age bucket')
    .requiredOption('--account <code>', 'the account')
    .requiredOption('--on <date>', 'the date to age it at')
    .action(
      onStore(makeContext, (db, context, options: Record<string, string>) => {
        const found = accountStatement(
          db,
          context.requireProperty(),
          catalogCode(options.account ?? ''),
          dateArg(options.on ?? ''),
        );
        context.write(
          render(
            found.buckets.map((entry) => ({
              age: entry.bucket,
              balance: formatMoney(entry.balance),
            })),
            {
              format: context.format,
              empty: 'nothing to age',
              columns: columns('age', 'balance>'),
            },
          ),
        );
      }),
    );
}
