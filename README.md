# covercount

Banquet event order and catering production control for a hotel food and
beverage department. TypeScript, SQLite, a command line and a read only HTTP
service. No web framework and no ORM.

## What the problem actually is

A function is sold as a menu at a price per person, and almost nothing that
follows is driven by that price.

The client names a **guaranteed cover count** before a deadline. Before the
deadline the number moves either way; after it the number may only go up,
because the kitchen has bought against it. The dining room is **set** above the
guarantee by a house overset, capped. **Special meals come out of the
guarantee**, not on top of it, so twelve vegan covers on a hundred and eighty
means a hundred and sixty eight standard plates. The invoice bills the greater
of the guarantee and the covers actually served.

Every one of those rules feeds something else. Raise the guarantee and the
plate count moves, the recipe explosion moves, the pick list moves, the staffing
ratios move, a captain may appear, the plate up starts earlier, the pull sheet
needs more chairs, and the invoice changes. Get the special meal rule wrong and
the kitchen cooks twelve mains nobody eats.

`covercount` holds those rules in one place so the banquet event order, the
kitchen production sheet, the staffing sheet and the invoice all agree.

## Running it

    npm install
    npm run build
    node dist/src/cli/main.js --help

A property to look at:

    export COVERCOUNT_STORE=./canyon.covercount.db
    node dist/src/cli/main.js store init
    node dist/src/cli/main.js demo seed
    node dist/src/cli/main.js --property CANYON space list

The read service, which opens the store read only:

    node dist/src/cli/main.js serve start --port 8377
    curl localhost:8377/properties/CANYON/board?date=2025-04-18

In a container:

    docker build -t covercount .
    docker run --rm -v "$PWD/data:/data" -p 8377:8377 covercount

Every command takes `--format json`, so the same command feeds a printer and a
spreadsheet.

## Layout

    src/core          money, rates, units, dates, the ballroom clock, errors
    src/store         the SQLite handle, migrations, sequences, backup, transfer
    src/property      the property, its rooms and the airwalls between them
    src/booking       accounts, bookings, functions and the diary
    src/catalog       menu items, allergens, packages and effective dated prices
    src/covers        the guarantee, special meals and the course split
    src/production    ingredients, recipes, the explosion and requisitions
    src/labour        staffing ratios, rates and rosters
    src/billing       charges, tax profiles, invoices and deposits
    src/orders        the banquet event order, its revisions and change orders
    src/timeline      the run of show
    src/equipment     the cupboard and what a setup pulls
    src/reports       the sheets people print
    src/audit         what quietly stopped adding up
    src/http          the read only service
    src/cli           the command line
    tests             unit, cli, http and integration, mirroring src

## The rules worth knowing before reading the code

- **Money is minor units, rates are parts per million.** Nothing is a float.
  A sales tax of 8.875 percent is a real rate; basis points cannot hold it.
- **Recipes are batches, not portions.** Scaling a batch is not the same as
  scaling a portion, and the yield factor is applied before the pack rounding,
  never after.
- **A function date is a date.** It becomes an instant only where a service
  time is attached to it, and that crossing lives in one file.
- **A revision is a snapshot.** What the kitchen worked from on the Tuesday
  has to be readable in March, so revisions freeze rather than diff.
- **Every refusal carries a code.** The command line reports a domain refusal
  as exit 1 and a bug as exit 3.

## Development

    npm run check        everything CI runs, in the order it runs it
    npm test
    npm run coverage     with the floor enforced
    npm run docs         regenerate docs/commands.md from the program

`docs/commands.md` is generated. Do not edit it by hand.
