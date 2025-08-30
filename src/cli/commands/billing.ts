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
import { render, renderRecord } from '../output.js';
import { entityArg, percentToPpm, wholeNumber } from '../args.js';
import { withOpenStore, type CliContext } from '../context.js';

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
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  tax
    .command('rate')
    .description('set the sales tax rate for one charge category')
    .requiredOption('--profile <code>', 'the profile')
    .requiredOption('--category <category>', 'food, beverage, rental, av, labor, service or fee')
    .requiredOption('--percent <percent>', 'the rate')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  tax
    .command('list')
    .description('every tax profile on file')
    .action(() => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
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
        },
        { readOnly: true },
      );
    });
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
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  charge
    .command('package')
    .description('draw the package line off the guarantee and the price book')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  charge
    .command('upcharge')
    .description('bill an upcharge item to the covers that took it')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--item <code>', 'the upcharge item')
    .requiredOption('--covers <count>', 'how many took it')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  charge
    .command('list')
    .description('every line on a function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
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
        },
        { readOnly: true },
      );
    });

  charge
    .command('remove')
    .description('take a line off')
    .requiredOption('--id <id>', 'the line')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const removed = removeCharge(db, wholeNumber('id', options.id ?? ''));
        context.write(renderRecord({ id: options.id ?? '', removed }, { format: context.format }));
      });
    });
}

export function registerInvoiceCommands(program: Command, makeContext: () => CliContext): void {
  const invoice = program.command('invoice').description('invoices and what has been paid');

  invoice
    .command('raise')
    .description('raise an invoice against a booking')
    .requiredOption('--booking <id>', 'the booking')
    .requiredOption('--profile <code>', 'the tax profile to bill under')
    .option('--note <note>', 'anything the client should see', '')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  invoice
    .command('show')
    .description('the totals on an invoice')
    .requiredOption('--id <id>', 'the invoice')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
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
        },
        { readOnly: true },
      );
    });

  invoice
    .command('breakdown')
    .description('the totals per charge category')
    .requiredOption('--id <id>', 'the invoice')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
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
        },
        { readOnly: true },
      );
    });
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
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
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
      });
    });

  settle
    .command('payments')
    .description('everything that has landed against an invoice')
    .requiredOption('--id <id>', 'the invoice')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
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
        },
        { readOnly: true },
      );
    });

  settle
    .command('advance')
    .description('issue, settle or void an invoice')
    .requiredOption('--id <id>', 'the invoice')
    .requiredOption('--to <status>', 'issued, paid or void')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const moved = advanceInvoice(
          db,
          parseEntityId('invoice', options.id ?? ''),
          options.to ?? '',
          context.now(),
        );
        context.write(
          renderRecord({ id: moved.id, status: moved.status }, { format: context.format }),
        );
      });
    });

  settle
    .command('list')
    .description('invoices, filtered')
    .option('--booking <id>', 'only this booking')
    .option('--status <status>', 'only this status')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(
        context,
        (db) => {
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
        },
        { readOnly: true },
      );
    });
}
