/**
 * A whole property, built in one call.
 *
 * This exists for two reasons that are both about not lying. A person
 * evaluating the build should be able to see a real day rather than an empty
 * file, and the tests that walk the whole system should not each carry their
 * own idea of what a property looks like. Everything here goes through the
 * same public writers a coordinator uses, so if a rule changes this stops
 * building and somebody has to look at it.
 */

import type { CatalogCode } from '../core/ids.js';
import { catalogCode } from '../core/ids.js';
import { addCalendarEntry, addSpace, createProperty, setSpaceCapacity } from '../property/store.js';
import { defineCombination } from '../property/combinations.js';
import { createAccount } from '../booking/accounts.js';
import { createItem } from '../catalog/items.js';
import { createPackage } from '../catalog/packages.js';
import { createPriceBook, setPrice } from '../catalog/pricing.js';
import { createIngredient } from '../production/ingredients.js';
import { createRecipe } from '../production/recipes.js';
import { setLabourRate, setStaffingRule } from '../labour/staffing.js';
import { setTemplateStep } from '../timeline/runofshow.js';
import { createTaxProfile } from '../billing/tax.js';
import { createEquipment, setRequirement } from '../equipment/store.js';
import { calendarDate } from '../core/calendar.js';
import { setProductionFactor } from '../production/factors.js';
import { setCancellationBand } from '../booking/damages.js';
import { setTurnStandard } from '../property/turns.js';
import { setDistributionPoints } from '../labour/distribution.js';
import { addRecipient } from '../orders/delivery.js';
import { setCreditTerms } from '../billing/statement.js';
import { setIngredientCost } from '../production/costing.js';
import { inTransaction, type Database } from '../store/database.js';

const DEMO_PROPERTY: CatalogCode = catalogCode('CANYON');

export interface DemoResult {
  readonly propertyCode: CatalogCode;
  readonly rooms: number;
  readonly items: number;
  readonly packages: number;
  readonly recipes: number;
  readonly equipment: number;
  /** Rules the house publishes once: factors, bands, turns, points, terms. */
  readonly houseRules: number;
}

const ITEMS = [
  ['CRAB-CAKE', 'Dungeness crab cake', 'FOOD', 'CANAPE', 'PIECE', 'SHELLFISH,EGG,WHEAT', ''],
  [
    'BEET-TART',
    'Golden beet tartare',
    'FOOD',
    'STARTER',
    'PERSON',
    '',
    'VEGETARIAN,VEGAN,DAIRY-FREE',
  ],
  ['SQUASH-SOUP', 'Roast squash soup', 'FOOD', 'SOUP', 'PERSON', 'MILK', 'VEGETARIAN,GLUTEN-FREE'],
  ['SHORT-RIB', 'Braised short rib', 'FOOD', 'MAIN', 'PERSON', 'BEEF,SULPHITE', ''],
  ['HALIBUT', 'Roast halibut', 'FOOD', 'MAIN', 'PERSON', 'FISH,MILK', 'PESCATARIAN'],
  [
    'ROOT-PLATE',
    'Winter root plate',
    'FOOD',
    'MAIN',
    'PERSON',
    '',
    'VEGETARIAN,VEGAN,GLUTEN-FREE,DAIRY-FREE,NUT-FREE',
  ],
  ['CHOC-TART', 'Bitter chocolate tart', 'FOOD', 'DESSERT', 'PERSON', 'MILK,EGG,WHEAT', ''],
  [
    'SORBET',
    'Blood orange sorbet',
    'FOOD',
    'DESSERT',
    'PERSON',
    '',
    'VEGETARIAN,VEGAN,GLUTEN-FREE,DAIRY-FREE',
  ],
  ['HOUSE-RED', 'House red', 'BEVERAGE', 'BEVERAGE', 'EACH', 'ALCOHOL,SULPHITE', ''],
  ['COFFEE', 'Coffee service', 'BEVERAGE', 'BEVERAGE', 'GALLON', '', ''],
  ['LOBSTER-UP', 'Butter poached lobster', 'FOOD', 'MAIN', 'PERSON', 'SHELLFISH,MILK', ''],
  ['SCREEN', 'Projection screen', 'AV', 'NONE', 'EACH', '', ''],
] as const;

const INGREDIENTS = [
  ['SHORT-RIB', 'Beef short rib, bone in', 'BUTCHER', 'LB', 40],
  ['MIREPOIX', 'Mirepoix mix', 'PRODUCE', 'LB', 10],
  ['RED-WINE', 'Cooking red', 'CELLAR', 'GAL', 3],
  ['VEAL-STOCK', 'Veal stock', 'FREEZE', 'QT', 4],
  ['ROOT-VEG', 'Winter root mix', 'PRODUCE', 'LB', 25],
  ['OLIVE-OIL', 'Olive oil', 'DRY', 'L', 5],
  ['BLOOD-ORANGE', 'Blood orange', 'PRODUCE', 'EA', 48],
  ['SUGAR', 'Caster sugar', 'DRY', 'LB', 25],
  ['BEETROOT', 'Golden beetroot', 'PRODUCE', 'LB', 20],
  ['HALIBUT-FILLET', 'Halibut fillet', 'CHILL', 'LB', 22],
  ['BUTTER', 'Unsalted butter', 'CHILL', 'LB', 36],
] as const;

export function seedDemoProperty(db: Database, now: string): DemoResult {
  return inTransaction(db, (handle) => {
    createProperty(
      handle,
      {
        code: 'CANYON',
        name: 'Canyon Ridge Hotel',
        timeZone: 'America/Denver',
        currency: 'USD',
        guaranteeLeadDays: 3,
        guaranteeDueMinute: 720,
        oversetPpm: 50_000,
        oversetCap: 25,
      },
      now,
    );

    seedRooms(handle);
    seedCalendars(handle);
    seedCatalog(handle, now);
    seedKitchen(handle, now);
    seedCrew(handle);
    seedMoney(handle, now);
    seedCupboard(handle, now);

    createAccount(
      handle,
      DEMO_PROPERTY,
      {
        code: 'FENWICK',
        name: 'Fenwick Geological Society',
        kind: 'ASSOCIATION',
        billingEmail: 'ap@fenwick.example',
      },
      now,
    );

    seedHouseRules(handle, now);

    return {
      propertyCode: DEMO_PROPERTY,
      rooms: 4,
      items: ITEMS.length,
      packages: 2,
      recipes: 5,
      equipment: 6,
      houseRules: 22,
    };
  });
}

function seedRooms(db: Database): void {
  addSpace(db, DEMO_PROPERTY, {
    code: 'GRAND-A',
    name: 'Grand Ballroom A',
    floor: 'Lobby',
    areaSqFt: 3200,
    fireCapacity: 350,
    setupMinutes: 120,
    teardownMinutes: 60,
    capacities: [
      { setupStyle: 'ROUNDS-10', capacity: 200 },
      { setupStyle: 'THEATER', capacity: 300 },
      { setupStyle: 'RECEPTION', capacity: 350 },
    ],
  });
  addSpace(db, DEMO_PROPERTY, {
    code: 'GRAND-B',
    name: 'Grand Ballroom B',
    floor: 'Lobby',
    areaSqFt: 3200,
    fireCapacity: 350,
    setupMinutes: 120,
    teardownMinutes: 60,
    capacities: [
      { setupStyle: 'ROUNDS-10', capacity: 200 },
      { setupStyle: 'THEATER', capacity: 300 },
      { setupStyle: 'RECEPTION', capacity: 350 },
    ],
  });
  addSpace(db, DEMO_PROPERTY, {
    code: 'ASPEN',
    name: 'Aspen Room',
    floor: 'Second',
    areaSqFt: 900,
    fireCapacity: 80,
    setupMinutes: 45,
    teardownMinutes: 30,
    capacities: [
      { setupStyle: 'ROUNDS-10', capacity: 60 },
      { setupStyle: 'U-SHAPE', capacity: 28 },
      { setupStyle: 'BOARDROOM', capacity: 20 },
    ],
  });
  defineCombination(db, DEMO_PROPERTY, {
    code: 'GRAND',
    name: 'Grand Ballroom',
    components: ['GRAND-A', 'GRAND-B'],
  });
  setSpaceCapacity(db, DEMO_PROPERTY, catalogCode('GRAND'), 'ROUNDS-10', 420);
  setSpaceCapacity(db, DEMO_PROPERTY, catalogCode('GRAND'), 'THEATER', 620);
  setSpaceCapacity(db, DEMO_PROPERTY, catalogCode('GRAND'), 'RECEPTION', 700);
}

function seedCalendars(db: Database): void {
  for (const date of ['2025-07-04', '2025-11-27', '2025-12-25']) {
    addCalendarEntry(db, DEMO_PROPERTY, { calendar: 'office', date, kind: 'closed' });
  }
  addCalendarEntry(db, DEMO_PROPERTY, {
    calendar: 'kitchen',
    date: '2025-12-25',
    kind: 'closed',
    note: 'property dark',
  });
}

function seedCatalog(db: Database, now: string): void {
  for (const [code, name, kind, course, soldBy, allergens, diets] of ITEMS) {
    createItem(
      db,
      DEMO_PROPERTY,
      {
        code,
        name,
        kind,
        course,
        soldBy,
        isUpcharge: code === 'LOBSTER-UP',
        allergens: allergens.length === 0 ? [] : allergens.split(','),
        diets: diets.length === 0 ? [] : diets.split(','),
      },
      now,
    );
  }

  createPackage(
    db,
    DEMO_PROPERTY,
    {
      code: 'PLATED-THREE',
      name: 'Three course plated dinner',
      serviceStyle: 'PLATED',
      minCovers: 20,
      courses: [
        { course: 'STARTER', choices: 1, items: ['BEET-TART'] },
        { course: 'SOUP', choices: 1, required: false, items: ['SQUASH-SOUP'] },
        { course: 'MAIN', choices: 1, items: ['SHORT-RIB', 'HALIBUT', 'ROOT-PLATE'] },
        { course: 'DESSERT', choices: 1, items: ['CHOC-TART', 'SORBET'] },
      ],
    },
    now,
  );
  createPackage(
    db,
    DEMO_PROPERTY,
    {
      code: 'RECEPTION-HOUR',
      name: 'One hour canape reception',
      serviceStyle: 'RECEPTION',
      minCovers: 30,
      courses: [{ course: 'CANAPE', choices: 1, required: false, items: ['CRAB-CAKE'] }],
    },
    now,
  );

  createPriceBook(db, DEMO_PROPERTY, { code: 'RACK-2025', name: 'Rack rates 2025' }, now);
  const prices: [string, string, number][] = [
    ['PACKAGE', 'PLATED-THREE', 8950],
    ['PACKAGE', 'RECEPTION-HOUR', 3200],
    ['ITEM', 'LOBSTER-UP', 2400],
    ['ITEM', 'CRAB-CAKE', 675],
    ['ITEM', 'HOUSE-RED', 4200],
    ['ITEM', 'COFFEE', 8500],
    ['ITEM', 'SCREEN', 22500],
  ];
  for (const [subjectKind, subjectCode, priceMinor] of prices) {
    setPrice(db, DEMO_PROPERTY, {
      bookCode: 'RACK-2025',
      subjectKind,
      subjectCode,
      effectiveFrom: '2025-01-01',
      priceMinor,
    });
  }
}

function seedKitchen(db: Database, now: string): void {
  for (const [code, name, store, purchaseUnit, packSize] of INGREDIENTS) {
    createIngredient(db, DEMO_PROPERTY, { code, name, store, purchaseUnit, packSize }, now);
  }

  createRecipe(
    db,
    DEMO_PROPERTY,
    {
      code: 'BRAISED-SHORT-RIB',
      name: 'Braised short rib',
      itemCode: 'SHORT-RIB',
      batchPortions: 20,
      station: 'ROAST',
      method: 'sear, braise four hours, rest, portion',
      lines: [
        { ingredientCode: 'SHORT-RIB', quantity: 16, unit: 'LB', yieldPercent: 65 },
        { ingredientCode: 'MIREPOIX', quantity: 4, unit: 'LB', yieldPercent: 85 },
        { ingredientCode: 'RED-WINE', quantity: 3, unit: 'QT' },
        { ingredientCode: 'VEAL-STOCK', quantity: 5, unit: 'QT' },
      ],
    },
    now,
  );
  createRecipe(
    db,
    DEMO_PROPERTY,
    {
      code: 'ROAST-HALIBUT',
      name: 'Roast halibut',
      itemCode: 'HALIBUT',
      batchPortions: 24,
      station: 'FISH',
      lines: [
        { ingredientCode: 'HALIBUT-FILLET', quantity: 12, unit: 'LB', yieldPercent: 88 },
        { ingredientCode: 'BUTTER', quantity: 1.5, unit: 'LB' },
      ],
    },
    now,
  );
  createRecipe(
    db,
    DEMO_PROPERTY,
    {
      code: 'WINTER-ROOT-PLATE',
      name: 'Winter root plate',
      itemCode: 'ROOT-PLATE',
      batchPortions: 12,
      station: 'GARDE-MANGER',
      lines: [
        { ingredientCode: 'ROOT-VEG', quantity: 9, unit: 'LB', yieldPercent: 80 },
        { ingredientCode: 'OLIVE-OIL', quantity: 500, unit: 'ML' },
      ],
    },
    now,
  );
  createRecipe(
    db,
    DEMO_PROPERTY,
    {
      code: 'BLOOD-ORANGE-SORBET',
      name: 'Blood orange sorbet',
      itemCode: 'SORBET',
      batchPortions: 30,
      station: 'PASTRY',
      lines: [
        { ingredientCode: 'BLOOD-ORANGE', quantity: 24, unit: 'EA', yieldPercent: 45 },
        { ingredientCode: 'SUGAR', quantity: 3, unit: 'LB' },
      ],
    },
    now,
  );
  createRecipe(
    db,
    DEMO_PROPERTY,
    {
      code: 'BEET-TARTARE',
      name: 'Golden beet tartare',
      itemCode: 'BEET-TART',
      batchPortions: 16,
      station: 'GARDE-MANGER',
      lines: [
        { ingredientCode: 'BEETROOT', quantity: 6, unit: 'LB', yieldPercent: 70 },
        { ingredientCode: 'OLIVE-OIL', quantity: 250, unit: 'ML' },
      ],
    },
    now,
  );
}

function seedCrew(db: Database): void {
  const rules: [string, string, number, number][] = [
    ['PLATED', 'SERVER', 16, 2],
    ['PLATED', 'CAPTAIN', 5, 1],
    ['PLATED', 'HOUSEMAN', 100, 1],
    ['BUFFET', 'SERVER', 30, 2],
    ['BUFFET', 'CAPTAIN', 5, 1],
    ['RECEPTION', 'BARTENDER', 75, 1],
    ['RECEPTION', 'SERVER', 50, 2],
  ];
  for (const [serviceStyle, role, coversPerHead, minimumHeads] of rules) {
    setStaffingRule(db, DEMO_PROPERTY, { serviceStyle, role, coversPerHead, minimumHeads });
  }
  for (const [role, hourly] of [
    ['SERVER', 2400],
    ['CAPTAIN', 3200],
    ['HOUSEMAN', 2100],
    ['BARTENDER', 2900],
  ] as const) {
    setLabourRate(db, DEMO_PROPERTY, role, '2025-01-01', hourly);
  }

  const steps: [number, string, string, number, number, string][] = [
    [1, 'crew in, room set', 'SETUP', 0, 0, 'HOUSEMAN'],
    [2, 'mise en place', 'DOORS', -180, 0, 'CHEF'],
    [3, 'plate up starts', 'SERVICE', 0, 20, 'CHEF'],
    [4, 'doors open', 'DOORS', 0, 0, 'CAPTAIN'],
    [5, 'guests seated', 'SERVICE', 0, 0, 'CAPTAIN'],
    [6, 'main fired', 'SERVICE', 45, 0, 'CHEF'],
    [7, 'dessert away', 'SERVICE', 105, 0, 'CHEF'],
    [8, 'bar closes', 'CLOSE', -30, 0, 'BARTENDER'],
    [9, 'room struck', 'TEARDOWN', 0, 0, 'HOUSEMAN'],
  ];
  for (const [sequence, label, anchor, offsetMinutes, perCoverSeconds, owner] of steps) {
    setTemplateStep(db, DEMO_PROPERTY, {
      serviceStyle: 'PLATED',
      sequence,
      label,
      anchor,
      offsetMinutes,
      perCoverSeconds,
      owner,
    });
  }
}

function seedMoney(db: Database, now: string): void {
  createTaxProfile(
    db,
    DEMO_PROPERTY,
    {
      code: 'DENVER',
      name: 'Denver County',
      serviceChargePpm: 220_000,
      serviceChargeTaxable: true,
      rates: [
        { category: 'FOOD', ppm: 88_100 },
        { category: 'BEVERAGE', ppm: 88_100 },
        { category: 'AV', ppm: 88_100 },
        { category: 'SERVICE', ppm: 88_100 },
      ],
    },
    now,
  );
}

function seedCupboard(db: Database, now: string): void {
  const items: [string, string, string, number, number][] = [
    ['ROUND-72', '72 inch round', 'TABLE', 40, 0],
    ['BANQUET-CHAIR', 'Banquet chair', 'SEATING', 400, 0],
    ['FLOOR-CLOTH', 'Floor length cloth', 'LINEN', 60, 0],
    ['PLACE-SETTING', 'Place setting', 'CHINA', 320, 275],
    ['WINE-GLASS', 'Wine glass', 'GLASS', 600, 0],
    ['LECTERN', 'Lectern', 'STAGING', 2, 0],
  ];
  for (const [code, name, kind, owned, rentalMinor] of items) {
    createEquipment(db, DEMO_PROPERTY, { code, name, kind, owned, rentalMinor }, now);
  }
  const rules: [string, number, number, number][] = [
    ['ROUND-72', 0, 1, 0],
    ['BANQUET-CHAIR', 1, 0, 0],
    ['FLOOR-CLOTH', 0, 1, 0],
    ['PLACE-SETTING', 1, 0, 0],
    ['WINE-GLASS', 2, 0, 0],
    ['LECTERN', 0, 0, 1],
  ];
  for (const [equipmentCode, perCover, perTable, fixed] of rules) {
    setRequirement(db, DEMO_PROPERTY, {
      setupStyle: 'ROUNDS-10',
      equipmentCode,
      perCover,
      perTable,
      fixed,
    });
  }
}

/**
 * The rules the house publishes once and then works to all year.
 *
 * These came later than the rest of the demo and they are the reason it is
 * worth reseeding: without them half the commands answer "this property
 * publishes nothing", which reads as a broken build rather than an empty one.
 */
function seedHouseRules(db: Database, now: string): void {
  // What the kitchen makes over the plate count, by how the room is served.
  setProductionFactor(db, DEMO_PROPERTY, 'BUFFET', 1_150_000, 'display holds to the last table');
  setProductionFactor(db, DEMO_PROPERTY, 'STATIONS', 1_250_000, 'guests go back');

  // The scale on the back of the contract.
  const bands: [number, number, string][] = [
    [180, 250_000, 'six months out'],
    [90, 500_000, 'a quarter out'],
    [30, 750_000, 'a month out'],
    [0, 1_000_000, 'inside a month'],
  ];
  for (const [days, ratePpm, note] of bands) {
    setCancellationBand(db, DEMO_PROPERTY, days, ratePpm, note);
  }

  // How long a room takes to turn, and how many hands it takes.
  const turns: [string, string, number, number][] = [
    ['THEATER', 'ROUNDS-10', 150, 6],
    ['ROUNDS-10', 'THEATER', 90, 4],
    ['ROUNDS-10', 'RECEPTION', 60, 3],
  ];
  for (const [from, to, minutes, heads] of turns) {
    setTurnStandard(db, DEMO_PROPERTY, from, to, minutes, heads);
  }

  // What each role earns out of the service charge.
  const points: [string, number][] = [
    ['SERVER', 10],
    ['CAPTAIN', 16],
    ['BARTENDER', 10],
    ['HOUSEMAN', 6],
    ['COAT-CHECK', 4],
  ];
  for (const [role, earned] of points) {
    setDistributionPoints(db, DEMO_PROPERTY, role, earned);
  }

  // Who gets the order when it goes out.
  const list: [string, string, string][] = [
    ['chef@canyonridge.example', 'Executive chef', 'EMAIL'],
    ['Banquet board', 'Houseman', 'BOARD'],
    ['av@canyonridge.example', 'Audio visual', 'EMAIL'],
  ];
  for (const [recipient, role, channel] of list) {
    addRecipient(db, DEMO_PROPERTY, { recipient, role, channel });
  }

  setCreditTerms(db, DEMO_PROPERTY, catalogCode('FENWICK'), 45, 25_000_00);

  // What a case costs, so a plate can be costed at all.
  const quotes: [string, number][] = [
    ['SHORT-RIB', 32_000],
    ['MIREPOIX', 1_400],
    ['RED-WINE', 4_200],
    ['VEAL-STOCK', 5_600],
    ['BEETROOT', 2_200],
  ];
  for (const [ingredient, pack] of quotes) {
    setIngredientCost(
      db,
      DEMO_PROPERTY,
      catalogCode(ingredient),
      calendarDate('2025-01-01'),
      pack,
      'Front Range Provisions',
    );
  }
  void now;
}
