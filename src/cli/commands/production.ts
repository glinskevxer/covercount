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
import {
  listProductionFactors,
  productionFactor,
  setProductionFactor,
} from '../../production/factors.js';
import {
  belowPar,
  countStock,
  listStockLevels,
  moveStock,
  orderLine,
  stockMovements,
} from '../../production/stock.js';
import { draftPurchaseOrder, renderPurchaseOrder } from '../../production/purchasing.js';
import { costHistory, costRecipe, marginOn, setIngredientCost } from '../../production/costing.js';
import { formatMoney } from '../../core/money.js';
import {
  createIngredient,
  listIngredients,
  setIngredientActive,
} from '../../production/ingredients.js';
import { productionVariance, recordProduced, suggestFactor } from '../../production/actuals.js';
import { formatRate, ratePercent } from '../../core/rate.js';
import { render, renderRecord } from '../output.js';
import {
  codeArg,
  dateArg,
  entityArg,
  listArg,
  percentToPpm,
  moneyArg,
  quantityArg,
  serviceStyleArg,
  wholeNumber,
} from '../args.js';
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
                produced: row.produced,
                batches: row.batches,
              })),
              {
                format: context.format,
                empty: 'nothing to make',
                columns: [
                  { key: 'station' },
                  { key: 'recipe' },
                  { key: 'plates', align: 'right' },
                  { key: 'produced', align: 'right' },
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
export function registerFactorCommands(program: Command, makeContext: () => CliContext): void {
  const factor = program
    .command('factor')
    .description('how much more than the plate count a style has to be made');

  factor
    .command('set')
    .description('publish the factor for one service style')
    .requiredOption('--style <style>', 'PLATED, BUFFET, STATIONS, RECEPTION or FAMILY')
    .requiredOption('--percent <percent>', 'the factor as a percent, so 115 is fifteen over')
    .option('--note <text>', 'why the chef set it there')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const row = setProductionFactor(
          db,
          context.requireProperty(),
          options.style ?? '',
          percentToPpm('factor', options.percent ?? ''),
          options.note ?? '',
        );
        context.write(
          renderRecord(
            { style: row.serviceStyle, factor: formatRate(row.factor), note: row.note },
            { format: context.format },
          ),
        );
      });
    });

  factor
    .command('list')
    .description('every factor a property has published')
    .action(() => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            listProductionFactors(db, context.requireProperty()).map((row) => ({
              style: row.serviceStyle,
              factor: formatRate(row.factor),
              note: row.note,
            })),
            {
              format: context.format,
              empty: 'that property makes exactly what it plates',
              columns: [{ key: 'style' }, { key: 'factor', align: 'right' }, { key: 'note' }],
            },
          ),
        );
      });
    });

  factor
    .command('show')
    .description('the factor in force for one style, published or not')
    .requiredOption('--style <style>', 'the service style')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const style = serviceStyleArg(options.style ?? '');
        const value = productionFactor(db, context.requireProperty(), style);
        context.write(
          renderRecord(
            {
              style,
              factor: formatRate(value),
              percent: ratePercent(value),
            },
            { format: context.format },
          ),
        );
      });
    });
}

export function registerStockCommands(program: Command, makeContext: () => CliContext): void {
  const stock = program.command('stock').description('what is on the shelf and what should be');

  stock
    .command('count')
    .description('record a physical count')
    .requiredOption('--item <code>', 'the ingredient')
    .requiredOption('--on-hand <quantity>', 'what was counted, like 40kg')
    .option('--par <quantity>', 'what the house wants sitting there')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const level = countStock(
          db,
          context.requireProperty(),
          codeArg(options.item ?? ''),
          {
            onHand: quantityArg('on hand', options.onHand ?? ''),
            par: options.par === undefined ? undefined : quantityArg('par', options.par),
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              item: level.ingredientCode,
              onHand: formatQuantity(level.onHand),
              par: formatQuantity(level.par),
            },
            { format: context.format },
          ),
        );
      });
    });

  stock
    .command('move')
    .description('issue to a function or receive a delivery')
    .requiredOption('--item <code>', 'the ingredient')
    .requiredOption('--by <quantity>', 'the movement, negative to issue')
    .requiredOption('--reason', 'ISSUE, RECEIVE, WASTE or TRANSFER')
    .option('--reference <text>', 'the requisition or delivery note')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const level = moveStock(
          db,
          context.requireProperty(),
          codeArg(options.item ?? ''),
          quantityArg('movement', options.by ?? ''),
          options.reason ?? '',
          context.now(),
          options.reference ?? '',
        );
        context.write(
          renderRecord(
            { item: level.ingredientCode, onHand: formatQuantity(level.onHand) },
            { format: context.format },
          ),
        );
      });
    });

  stock
    .command('list')
    .description('the whole shelf')
    .action(() => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            listStockLevels(db, context.requireProperty()).map((level) => ({
              item: level.ingredientCode,
              onHand: formatQuantity(level.onHand),
              par: formatQuantity(level.par),
              counted: level.countedAt.slice(0, 10),
            })),
            {
              format: context.format,
              empty: 'nothing has been counted',
              columns: [
                { key: 'item' },
                { key: 'onHand', align: 'right' },
                { key: 'par', align: 'right' },
                { key: 'counted' },
              ],
            },
          ),
        );
      });
    });

  stock
    .command('short')
    .description('everything sitting under its par')
    .action(() => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            belowPar(db, context.requireProperty()).map((level) => ({
              item: level.ingredientCode,
              onHand: formatQuantity(level.onHand),
              par: formatQuantity(level.par),
            })),
            {
              format: context.format,
              empty: 'nothing is under par',
              columns: [
                { key: 'item' },
                { key: 'onHand', align: 'right' },
                { key: 'par', align: 'right' },
              ],
            },
          ),
        );
      });
    });

  stock
    .command('order')
    .description('what to order for a requirement, in whole packs')
    .requiredOption('--item <code>', 'the ingredient')
    .requiredOption('--need <quantity>', 'what the functions need')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const line = orderLine(
          db,
          context.requireProperty(),
          codeArg(options.item ?? ''),
          quantityArg('need', options.need ?? ''),
        );
        context.write(
          renderRecord(
            {
              item: line.ingredientCode,
              needed: formatQuantity(line.needed),
              onHand: formatQuantity(line.onHand),
              par: formatQuantity(line.par),
              gap: formatQuantity(line.gap),
              packs: line.packs,
            },
            { format: context.format },
          ),
        );
      });
    });

  stock
    .command('history')
    .description('every movement against one ingredient')
    .requiredOption('--item <code>', 'the ingredient')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            stockMovements(db, context.requireProperty(), codeArg(options.item ?? '')).map(
              (move) => ({
                moved: formatQuantity(move.moved),
                reason: move.reason,
                reference: move.reference,
                at: move.movedAt,
              }),
            ),
            {
              format: context.format,
              empty: 'that ingredient has never moved',
              columns: [
                { key: 'moved', align: 'right' },
                { key: 'reason' },
                { key: 'reference' },
                { key: 'at' },
              ],
            },
          ),
        );
      });
    });
}

export function registerPurchaseCommands(program: Command, makeContext: () => CliContext): void {
  const purchase = program
    .command('purchase')
    .description('what to buy in, netted against the shelf');

  purchase
    .command('draft')
    .description('draft an order across a set of functions')
    .requiredOption('--functions <ids>', 'comma separated function ids')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const order = draftPurchaseOrder(
          db,
          listArg(options.functions ?? '').map((id) => entityArg('functionSlot', id)),
        );
        if (context.format === 'json') {
          context.write(
            render(
              order.sections.flatMap((section) =>
                section.lines.map((line) => ({
                  store: section.store,
                  item: line.ingredientCode,
                  need: formatQuantity(line.needed),
                  have: formatQuantity(line.onHand),
                  packs: line.packs,
                })),
              ),
              { format: context.format, empty: 'nothing to order' },
            ),
          );
          return;
        }
        context.write(renderPurchaseOrder(order));
      });
    });

  purchase
    .command('summary')
    .description('pack counts by store, without the detail')
    .requiredOption('--functions <ids>', 'comma separated function ids')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const order = draftPurchaseOrder(
          db,
          listArg(options.functions ?? '').map((id) => entityArg('functionSlot', id)),
        );
        context.write(
          render(
            order.sections.map((section) => ({
              store: section.store,
              items: section.lines.length,
              packs: section.packs,
            })),
            {
              format: context.format,
              empty: 'the shelf covers it',
              columns: [
                { key: 'store' },
                { key: 'items', align: 'right' },
                { key: 'packs', align: 'right' },
              ],
            },
          ),
        );
      });
    });
}

export function registerCostCommands(program: Command, makeContext: () => CliContext): void {
  const cost = program.command('cost').description('what a plate costs to put out');

  cost
    .command('quote')
    .description('record what a supplier charges for a pack')
    .requiredOption('--item <code>', 'the ingredient')
    .requiredOption('--from <date>', 'the date the price takes effect')
    .requiredOption('--pack <amount>', 'what one pack costs')
    .option('--supplier <name>', 'who quoted it')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const quoted = setIngredientCost(
          db,
          context.requireProperty(),
          codeArg(options.item ?? ''),
          dateArg(options.from ?? ''),
          moneyArg('pack price', options.pack ?? '').amount,
          options.supplier ?? '',
        );
        context.write(
          renderRecord(
            {
              item: quoted.ingredientCode,
              from: quoted.effectiveFrom,
              pack: formatMoney(quoted.pack),
              supplier: quoted.supplier,
            },
            { format: context.format },
          ),
        );
      });
    });

  cost
    .command('history')
    .description('every price quoted against one ingredient')
    .requiredOption('--item <code>', 'the ingredient')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            costHistory(db, context.requireProperty(), codeArg(options.item ?? '')).map((row) => ({
              from: row.effectiveFrom,
              pack: formatMoney(row.pack),
            })),
            {
              format: context.format,
              empty: 'nobody has quoted that ingredient',
              columns: [{ key: 'from' }, { key: 'pack', align: 'right' }],
            },
          ),
        );
      });
    });

  cost
    .command('recipe')
    .description('cost one recipe, batch and portion')
    .requiredOption('--recipe <code>', 'the recipe')
    .requiredOption('--on <date>', 'the date to price it on')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const costed = costRecipe(
          db,
          context.requireProperty(),
          codeArg(options.recipe ?? ''),
          dateArg(options.on ?? ''),
        );
        if (context.format === 'json') {
          context.write(
            render(
              costed.lines.map((line) => ({
                item: line.ingredientCode,
                gross: formatQuantity(line.gross),
                cost: formatMoney(line.lineCost),
              })),
              { format: context.format, empty: 'that recipe has no lines' },
            ),
          );
          return;
        }
        const rows = costed.lines.map((line) => ({
          item: line.ingredientCode,
          gross: formatQuantity(line.gross),
          cost: formatMoney(line.lineCost),
        }));
        context.write(
          [
            render(rows, {
              format: context.format,
              empty: 'that recipe has no lines',
              columns: [
                { key: 'item' },
                { key: 'gross', align: 'right' },
                { key: 'cost', align: 'right' },
              ],
            }),
            '',
            `batch of ${costed.batchPortions}: ${formatMoney(costed.batchCost)}`,
            `per portion: ${formatMoney(costed.portionCost)}`,
          ].join('\n'),
        );
      });
    });

  cost
    .command('margin')
    .description('the margin on a recipe against a price')
    .requiredOption('--recipe <code>', 'the recipe')
    .requiredOption('--on <date>', 'the date to price it on')
    .requiredOption('--price <amount>', 'what the plate sells for')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const costed = costRecipe(
          db,
          context.requireProperty(),
          codeArg(options.recipe ?? ''),
          dateArg(options.on ?? ''),
        );
        const margin = marginOn(moneyArg('price', options.price ?? ''), costed.portionCost);
        context.write(
          renderRecord(
            {
              cost: formatMoney(margin.cost),
              price: formatMoney(margin.price),
              gross: formatMoney(margin.gross),
              margin: formatRate(margin.marginRate),
              food: formatRate(margin.costRate),
            },
            { format: context.format },
          ),
        );
      });
    });
}

export function registerLarderCommands(program: Command, makeContext: () => CliContext): void {
  const larder = program.command('larder').description('the ingredients the kitchen buys');

  larder
    .command('add')
    .description('put an ingredient on file')
    .requiredOption('--code <code>', 'short code the recipes use')
    .requiredOption('--name <name>', 'what it is called on the invoice')
    .requiredOption('--area <store>', 'DRY, CHILL, FREEZE, PRODUCE, BUTCHER, CELLAR or NONFOOD')
    .requiredOption('--unit <unit>', 'the unit it is counted in')
    .requiredOption('--pack <size>', 'how much comes in one pack')
    .option('--pack-unit <unit>', 'the unit the pack is measured in, if it differs')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const ingredient = createIngredient(
          db,
          context.requireProperty(),
          {
            code: options.code ?? '',
            name: options.name ?? '',
            store: options.area ?? '',
            purchaseUnit: options.unit ?? '',
            packSize: Number(options.pack ?? ''),
            ...(options.packUnit === undefined ? {} : { packUnit: options.packUnit }),
          },
          context.now(),
        );
        context.write(
          renderRecord(
            {
              code: ingredient.code,
              name: ingredient.name,
              store: ingredient.store,
              unit: ingredient.purchaseUnit,
              pack: formatQuantity(ingredient.packSize),
            },
            { format: context.format },
          ),
        );
      });
    });

  larder
    .command('list')
    .description('every ingredient, or just one store')
    .option('--area <store>', 'narrow to one store')
    .option('--all', 'include the ones taken off the list')
    .action((options: Record<string, string | boolean>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        context.write(
          render(
            listIngredients(db, context.requireProperty(), {
              ...(typeof options.area === 'string' ? { store: options.area } : {}),
              activeOnly: options.all !== true,
            }).map((row) => ({
              code: row.code,
              name: row.name,
              store: row.store,
              unit: row.purchaseUnit,
              pack: formatQuantity(row.packSize),
              active: row.active,
            })),
            {
              format: context.format,
              empty: 'the larder is empty',
              columns: [
                { key: 'code' },
                { key: 'name' },
                { key: 'store' },
                { key: 'unit' },
                { key: 'pack', align: 'right' },
              ],
            },
          ),
        );
      });
    });

  larder
    .command('retire')
    .description('take an ingredient off the buying list without deleting it')
    .requiredOption('--code <code>', 'the ingredient')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const ingredient = setIngredientActive(
          db,
          context.requireProperty(),
          codeArg(options.code ?? ''),
          false,
        );
        context.write(
          renderRecord(
            { code: ingredient.code, active: ingredient.active },
            { format: context.format },
          ),
        );
      });
    });
}

export function registerActualCommands(program: Command, makeContext: () => CliContext): void {
  const actual = program.command('actual').description('what the kitchen made on the night');

  actual
    .command('record')
    .description('record what went out and what came back')
    .requiredOption('--function <id>', 'the function')
    .requiredOption('--recipe <code>', 'the recipe')
    .requiredOption('--produced <count>', 'portions that went out')
    .option('--returned <count>', 'portions that came back', '0')
    .option('--note <text>', 'anything the chef wants remembered')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const row = recordProduced(
          db,
          entityArg('functionSlot', options.function ?? ''),
          codeArg(options.recipe ?? ''),
          {
            produced: wholeNumber('produced', options.produced ?? ''),
            returned: wholeNumber('returned', options.returned ?? '0'),
            note: options.note ?? '',
          },
          context.now(),
        );
        context.write(
          renderRecord(
            { recipe: row.recipeCode, produced: row.produced, returned: row.returned },
            { format: context.format },
          ),
        );
      });
    });

  actual
    .command('variance')
    .description('plan against actual for one function')
    .requiredOption('--function <id>', 'the function')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const variance = productionVariance(db, entityArg('functionSlot', options.function ?? ''));
        context.write(
          render(
            variance.rows.map((row) => ({
              recipe: row.recipeCode,
              plates: row.plates,
              planned: row.planned,
              produced: row.produced,
              returned: row.returned,
              over: row.overProduction,
              waste: formatRate(row.wasteRate),
              ranOut: row.ranOut,
            })),
            {
              format: context.format,
              empty: 'nothing has been recorded against that function',
              columns: [
                { key: 'recipe' },
                { key: 'plates', align: 'right' },
                { key: 'planned', align: 'right' },
                { key: 'produced', align: 'right' },
                { key: 'returned', align: 'right' },
                { key: 'waste', align: 'right' },
              ],
            },
          ),
        );
      });
    });

  actual
    .command('suggest')
    .description('what the production factor should have been')
    .requiredOption('--functions <ids>', 'comma separated function ids, all one service style')
    .action((options: Record<string, string>) => {
      const context = makeContext();
      withOpenStore(context, (db) => {
        const suggestion = suggestFactor(
          db,
          listArg(options.functions ?? '').map((id) => entityArg('functionSlot', id)),
        );
        context.write(
          renderRecord(
            {
              style: suggestion.serviceStyle,
              current: formatRate(suggestion.current),
              suggested: formatRate(suggestion.suggested),
              functions: suggestion.functionsRead,
              plates: suggestion.platesRead,
              served: suggestion.servedRead,
            },
            { format: context.format },
          ),
        );
      });
    });
}
