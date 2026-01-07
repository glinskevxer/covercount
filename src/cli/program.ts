/**
 * The command line.
 *
 * `runCli` takes an argument list and returns an exit code instead of calling
 * process.exit, so the command tests drive the real program with the real
 * parser and read the real output. Commander is told not to exit or print on
 * its own for the same reason.
 */

import { Command } from 'commander';
import { describeError, isDomainError } from '../core/errors.js';
import { buildContext, type CliContext, type CliEnvironment } from './context.js';
import {
  registerBackupCommands,
  registerDemoCommands,
  registerTransferCommands,
  registerStoreCommands,
} from './commands/store.js';
import {
  registerCalendarCommands,
  registerCombinationCommands,
  registerPropertyCommands,
  registerSpaceCommands,
} from './commands/property.js';
import {
  registerAccountCommands,
  registerBookingChangeCommands,
  registerBookingCommands,
  registerDamagesCommands,
} from './commands/booking.js';
import {
  registerDiaryCommands,
  registerFunctionChangeCommands,
  registerFunctionCommands,
} from './commands/functions.js';
import {
  registerCoverCommands,
  registerCoverReadCommands,
  registerSpecialMealCommands,
} from './commands/covers.js';
import {
  registerChargeCommands,
  registerInvoiceCommands,
  registerMinimumCommands,
  registerPaymentCommands,
  registerTaxCommands,
} from './commands/billing.js';
import { registerChangeCommands, registerOrderCommands } from './commands/orders.js';
import { registerTemplateCommands, registerTimelineCommands } from './commands/timeline.js';
import { registerReportCommands, registerResumeCommands } from './commands/reports.js';
import { registerServeCommands } from './commands/serve.js';
import { registerEquipmentCommands, registerPullCommands } from './commands/equipment.js';
import { registerAuditCommands } from './commands/audit.js';
import {
  registerBarBillingCommands,
  registerBarCommands,
  registerBarTierCommands,
} from './commands/bar.js';
import {
  registerKitchenCommands,
  registerRequisitionCommands,
  registerFactorCommands,
  registerSplitCommands,
  registerCostCommands,
  registerLarderCommands,
  registerPurchaseCommands,
  registerStockCommands,
} from './commands/production.js';
import {
  registerCrewCommands,
  registerDistributionCommands,
  registerStaffingCommands,
} from './commands/crew.js';

export const VERSION = '0.1.0';

export interface RunOptions {
  readonly env?: CliEnvironment;
  readonly now?: () => string;
  readonly write?: (line: string) => void;
  readonly writeError?: (line: string) => void;
}

export function buildProgram(makeContext: () => CliContext): Command {
  const program = new Command();
  program
    .name('covercount')
    .description('banquet event orders and catering production for one property')
    .version(VERSION)
    .option('-s, --store <path>', 'path to the property store')
    .option('-p, --property <code>', 'property code to work in')
    .option('-f, --format <format>', 'table, plain or json')
    .option('-a, --actor <name>', 'who to record the change against')
    .exitOverride()
    .configureOutput({
      writeOut: () => undefined,
      writeErr: () => undefined,
    });

  registerStoreCommands(program, makeContext);
  registerBackupCommands(program, makeContext);
  registerDemoCommands(program, makeContext);
  registerTransferCommands(program, makeContext);
  registerPropertyCommands(program, makeContext);
  registerSpaceCommands(program, makeContext);
  registerCombinationCommands(program, makeContext);
  registerCalendarCommands(program, makeContext);
  registerAccountCommands(program, makeContext);
  registerBookingCommands(program, makeContext);
  registerDamagesCommands(program, makeContext);
  registerBookingChangeCommands(program, makeContext);
  registerFunctionCommands(program, makeContext);
  registerFunctionChangeCommands(program, makeContext);
  registerDiaryCommands(program, makeContext);
  registerCoverCommands(program, makeContext);
  registerCoverReadCommands(program, makeContext);
  registerSpecialMealCommands(program, makeContext);
  registerTaxCommands(program, makeContext);
  registerChargeCommands(program, makeContext);
  registerInvoiceCommands(program, makeContext);
  registerMinimumCommands(program, makeContext);
  registerPaymentCommands(program, makeContext);
  registerOrderCommands(program, makeContext);
  registerChangeCommands(program, makeContext);
  registerTemplateCommands(program, makeContext);
  registerTimelineCommands(program, makeContext);
  registerReportCommands(program, makeContext);
  registerResumeCommands(program, makeContext);
  registerServeCommands(program, makeContext);
  registerEquipmentCommands(program, makeContext);
  registerPullCommands(program, makeContext);
  registerAuditCommands(program, makeContext);
  registerBarTierCommands(program, makeContext);
  registerBarCommands(program, makeContext);
  registerBarBillingCommands(program, makeContext);
  registerSplitCommands(program, makeContext);
  registerFactorCommands(program, makeContext);
  registerStockCommands(program, makeContext);
  registerPurchaseCommands(program, makeContext);
  registerCostCommands(program, makeContext);
  registerLarderCommands(program, makeContext);
  registerKitchenCommands(program, makeContext);
  registerRequisitionCommands(program, makeContext);
  registerStaffingCommands(program, makeContext);
  registerCrewCommands(program, makeContext);
  registerDistributionCommands(program, makeContext);
  return program;
}

export function runCli(argv: readonly string[], options: RunOptions = {}): number {
  let context: CliContext | undefined;
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const writeError = options.writeError ?? ((line: string) => process.stderr.write(`${line}\n`));

  const program = buildProgram(() => {
    if (context === undefined) {
      context = buildContext({
        options: program.opts(),
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.now === undefined ? {} : { now: options.now }),
        write,
        writeError,
      });
    }
    return context;
  });

  try {
    program.parse(argv, { from: 'user' });
    return 0;
  } catch (error) {
    return reportFailure(error, program, write, writeError);
  }
}

interface CommanderError extends Error {
  readonly code?: string;
}

function reportFailure(
  error: unknown,
  program: Command,
  write: (line: string) => void,
  writeError: (line: string) => void,
): number {
  const commanderCode = (error as CommanderError | undefined)?.code;
  if (commanderCode === 'commander.helpDisplayed' || commanderCode === 'commander.help') {
    write(program.helpInformation().trimEnd());
    return 0;
  }
  if (commanderCode === 'commander.version') {
    write(VERSION);
    return 0;
  }
  if (commanderCode !== undefined && commanderCode.startsWith('commander.')) {
    writeError(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (isDomainError(error)) {
    writeError(describeError(error));
    if (error.hint !== undefined) {
      writeError(`hint: ${error.hint}`);
    }
    return 1;
  }
  writeError(describeError(error));
  return 3;
}
