# covercount command reference

Generated from the program itself at version 0.1.0. Do not edit by hand.

Run `npm run docs` after changing a command.

## Global options

| option | what it is |
| --- | --- |
| `-V, --version` | output the version number |
| `-s, --store <path>` | path to the property store |
| `-p, --property <code>` | property code to work in |
| `-f, --format <format>` | table, plain, json or csv |
| `-a, --actor <name>` | who to record the change against |

## `store`

the property store file

### `store init`

create the store and bring it up to the schema this build carries

### `store status`

report the schema version and the migrations applied

### `store migrations`

list the migrations this build carries

### `store health`

whether the file is intact and what is in it

### `store compact`

hand the free pages back to the filesystem

### `store analyse`

refresh the statistics the query planner reads

### `store plans`

whether the reads that run on every screen still seek

## `load`

read a spreadsheet somebody sent over

### `load prices`

load a price book from a comma separated file

| option | what it is |
| --- | --- |
| `--book <code>` | the price book to load into (required) |
| `--file <path>` | the file to read (required) |
| `--dry-run` | check the file and write nothing |

### `load larder`

load ingredients from a comma separated file

| option | what it is |
| --- | --- |
| `--file <path>` | the file to read (required) |
| `--dry-run` | check the file and write nothing |

## `codes`

every refusal the domain can raise, and what kind it is

### `codes`

every refusal the domain can raise, and what kind it is

| option | what it is |
| --- | --- |
| `--area <area>` | narrow to one area, like covers or billing |

## `season`

roll a whole property onto next season s numbers

### `season`

roll a whole property onto next season s numbers

| option | what it is |
| --- | --- |
| `--from <date>` | the date the current numbers are read on (required) |
| `--to <date>` | the date the new ones take effect (required) |
| `--uplift <percent>` | how far the numbers move, negative to cut (required) |
| `--skip <books>` | comma separated books to leave alone |
| `--dry-run` | work it out and write nothing |

## `backup`

copies of the store

### `backup take`

copy the store consistently, without stopping the office

| option | what it is |
| --- | --- |
| `--to <path>` | where to write it (required) |

### `backup read`

look inside a backup without migrating it

| option | what it is |
| --- | --- |
| `--path <path>` | the backup (required) |

### `backup migrations`

the migrations a backup carries

| option | what it is |
| --- | --- |
| `--path <path>` | the backup (required) |

## `demo`

a property to look at

### `demo seed`

build a whole property, rooms, menu, kitchen, crew and rates

## `setup`

moving a property between stores

### `setup export`

write the property setup out as JSON

| option | what it is |
| --- | --- |
| `--to <path>` | write to a file instead of standard output |

### `setup import`

read a property setup in, optionally under a new code

| option | what it is |
| --- | --- |
| `--from <path>` | the export to read (required) |
| `--as <code>` | bring it in under a different property code |

## `property`

the property and its rooms

### `property create`

put a property on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code for the property (required) |
| `--name <name>` | the name it trades under (required) |
| `--zone <zone>` | IANA time zone the ballroom clock runs on (required) |
| `--currency <code>` | currency the property invoices in [default: USD] |
| `--guarantee-lead <days>` | business days before a function the count closes [default: 3] |
| `--guarantee-due <time>` | time of day the count closes, HH:MM [default: 12:00] |
| `--overset <percent>` | how far above the guarantee the room is set [default: 5] |
| `--overset-cap <covers>` | most covers the overset will ever add [default: 25] |

### `property list`

every property in this store

### `property show`

the settings a property books under

## `space`

the rooms in the property

### `space add`

put a room on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code for the room (required) |
| `--name <name>` | the name on the door (required) |
| `--fire <covers>` | the number on the fire certificate (required) |
| `--floor <floor>` | which floor it is on [default: ] |
| `--area <sqft>` | floor area in square feet [default: 0] |
| `--setup <minutes>` | minutes the crew needs in front of a function [default: 60] |
| `--teardown <minutes>` | minutes the crew needs behind it [default: 30] |

### `space list`

every room, with what it seats

### `space capacity`

publish what a room seats in one setup style

| option | what it is |
| --- | --- |
| `--code <code>` | the room (required) |
| `--style <style>` | the setup style (required) |
| `--covers <covers>` | how many it seats that way (required) |

## `room`

combined rooms and what they block

### `room combine`

define a room made of other rooms

| option | what it is |
| --- | --- |
| `--code <code>` | code for the combined room (required) |
| `--name <name>` | the name it is sold under (required) |
| `--parts <codes>` | comma separated room codes (required) |
| `--fire <covers>` | fire capacity, if it is not the sum of the parts |

### `room footprint`

what a room takes out of the diary, and what it clashes with

| option | what it is |
| --- | --- |
| `--code <code>` | the room (required) |

### `room service`

take a room out of service or put it back

| option | what it is |
| --- | --- |
| `--code <code>` | the room (required) |
| `--state <state>` | in or out (required) |

## `hold`

tentative space, ranked first and second

### `hold take`

put a hold on a room for a booking

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |
| `--room <code>` | the room (required) |
| `--date <date>` | the date held (required) |
| `--start <time>` | start time as HH:MM (required) |
| `--end <time>` | end time as HH:MM (required) |
| `--until <date>` | the date the hold runs out (required) |
| `--note <text>` | anything the sales office wants remembered |

### `hold list`

every live hold on a date

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |

### `hold release`

let a hold go and move everybody behind it up

| option | what it is |
| --- | --- |
| `--id <id>` | the hold (required) |

### `hold challenge`

tell the hold in front that somebody else wants the room

| option | what it is |
| --- | --- |
| `--id <id>` | the challenging hold (required) |
| `--by <date>` | the date the incumbent has to decide by (required) |

### `hold lapsed`

holds whose own date has run out

| option | what it is |
| --- | --- |
| `--on <date>` | the date to sweep at (required) |

## `turn`

turning a room between two setups

### `turn standard`

publish how long a turn takes and how many hands

| option | what it is |
| --- | --- |
| `--from <style>` | the setup it comes out of (required) |
| `--to <style>` | the setup it goes into (required) |
| `--minutes <minutes>` | how long it takes (required) |
| `--heads <heads>` | how many housemen it takes (required) |

### `turn table`

every turn the house has published

### `turn day`

every back to back pair on a date

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |
| `--tight` | only the ones that do not fit |

## `calendar`

the office and kitchen calendars

### `calendar close`

mark a date closed or open on one of the calendars

| option | what it is |
| --- | --- |
| `--calendar <which>` | office or kitchen (required) |
| `--date <date>` | the date, YYYY-MM-DD (required) |
| `--state <state>` | closed or open [default: closed] |
| `--note <note>` | why [default: ] |

### `calendar list`

the dates one calendar carries

| option | what it is |
| --- | --- |
| `--calendar <which>` | office or kitchen (required) |

## `account`

the accounts we book from

### `account add`

put an account on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code for the account (required) |
| `--name <name>` | the name it trades under (required) |
| `--kind <kind>` | corporate, association, government, social or internal (required) |
| `--email <email>` | where the invoice goes [default: ] |
| `--credit <status>` | approved, prepay or hold [default: APPROVED] |
| `--exempt <id>` | tax exemption certificate number [default: ] |

### `account list`

every account on file

### `account credit`

move an account credit status

| option | what it is |
| --- | --- |
| `--code <code>` | the account (required) |
| `--status <status>` | approved, prepay or hold (required) |

### `account show`

one account and the bookings on it

| option | what it is |
| --- | --- |
| `--code <code>` | the account (required) |

## `booking`

the deals in the diary

### `booking create`

open a booking as an inquiry

| option | what it is |
| --- | --- |
| `--post-as <name>` | how it reads on the reader board (required) |
| `--arrival <date>` | first day of the business (required) |
| `--departure <date>` | last day of the business (required) |
| `--account <code>` | the account it belongs to |
| `--manager <name>` | the sales manager on it [default: ] |

### `booking list`

bookings, filtered

| option | what it is |
| --- | --- |
| `--status <status>` | inquiry, tentative, definite, cancelled or closed |
| `--account <code>` | only this account |
| `--from <date>` | business overlapping on or after this date |
| `--to <date>` | business overlapping on or before this date |

### `booking show`

one booking with its functions

| option | what it is |
| --- | --- |
| `--id <id>` | the booking (required) |

## `damages`

what a cancellation costs, and the scale it comes off

### `damages band`

publish one band of the cancellation scale

| option | what it is |
| --- | --- |
| `--days <days>` | days before the function the band starts at (required) |
| `--percent <percent>` | how much of the contract is owed (required) |
| `--note <text>` | the clause it comes from |

### `damages scale`

the whole published scale

### `damages drop`

take one band off the scale

| option | what it is |
| --- | --- |
| `--days <days>` | the band to remove (required) |

### `damages quote`

what this booking owes if it walks on a date

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |
| `--on <date>` | the date notice is given (required) |

## `meet`

tastings, site visits and the pre con

### `meet book`

put an appointment in the diary

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |
| `--kind <kind>` | tasting, site-visit, pre-con or planning (required) |
| `--date <date>` | the date (required) |
| `--start <time>` | start time as HH:MM (required) |
| `--end <time>` | end time as HH:MM (required) |
| `--room <code>` | the room, if it needs one |
| `--who <names>` | who is coming |
| `--note <text>` | anything worth remembering |

### `meet list`

every appointment on a booking

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |

### `meet outcome`

write down what came out of it

| option | what it is |
| --- | --- |
| `--id <id>` | the appointment (required) |
| `--said <text>` | what was decided (required) |

### `meet drop`

take an appointment out of the diary

| option | what it is |
| --- | --- |
| `--id <id>` | the appointment (required) |

### `meet window`

whether a tasting still changes anything

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |

## `deal`

changing and advancing a booking

### `deal edit`

change a booking that is still live

| option | what it is |
| --- | --- |
| `--id <id>` | the booking (required) |
| `--post-as <name>` | a new reader board name |
| `--account <code>` | attach an account, or none to detach |
| `--arrival <date>` | a new arrival date |
| `--departure <date>` | a new departure date |
| `--manager <name>` | a new sales manager |

### `deal advance`

move a booking to its next stage

| option | what it is |
| --- | --- |
| `--id <id>` | the booking (required) |
| `--to <status>` | tentative, definite, cancelled or closed (required) |
| `--reason <reason>` | why, required to cancel |
| `--today <date>` | the date the office believes it is, required to close |

### `deal history`

everything that happened to a booking

| option | what it is |
| --- | --- |
| `--id <id>` | the booking (required) |

## `function`

the functions inside a booking

### `function add`

put a function in a room

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking it belongs to (required) |
| `--room <code>` | the room (required) |
| `--name <name>` | what it is called on the order (required) |
| `--date <date>` | the service date (required) |
| `--start <time>` | when guests arrive, HH:MM (required) |
| `--end <time>` | when it finishes, past 24:00 if it runs late (required) |
| `--setup <style>` | the setup style (required) |
| `--service <style>` | the service style (required) |
| `--covers <covers>` | covers the salesperson expects [default: 0] |

### `function list`

the functions on a booking

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |

## `slot`

moving a function once it exists

### `slot move`

change a function that is still live

| option | what it is |
| --- | --- |
| `--id <id>` | the function (required) |
| `--room <code>` | a new room |
| `--date <date>` | a new service date |
| `--start <time>` | a new start |
| `--end <time>` | a new end |
| `--setup <style>` | a new setup style |
| `--covers <covers>` | a new expected cover count |
| `--name <name>` | a new name |

### `slot status`

hold, confirm, release or cancel a function

| option | what it is |
| --- | --- |
| `--id <id>` | the function (required) |
| `--to <status>` | held, definite, released or cancelled (required) |

### `slot show`

one function

| option | what it is |
| --- | --- |
| `--id <id>` | the function (required) |

## `diary`

what is in the rooms on a date

### `diary day`

the function board for one date

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |

### `diary check`

what a proposed function would collide with

| option | what it is |
| --- | --- |
| `--room <code>` | the room (required) |
| `--date <date>` | the service date (required) |
| `--start <time>` | when it would start (required) |
| `--end <time>` | when it would end (required) |

## `covers`

the guarantee and what was served

### `covers open`

open a cover count and work out when the guarantee closes

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--contract <date>` | the date the contract was signed (required) |
| `--package <code>` | the menu package sold |
| `--book <code>` | the price book it was quoted from |

### `covers guarantee`

name the guaranteed cover count

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--covers <covers>` | the number guaranteed (required) |
| `--note <note>` | why, for the record [default: ] |
| `--override-cutoff` | lower the count after the deadline, on the record |

### `covers served`

record the count taken at the pass

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--covers <covers>` | how many went out (required) |

## `count`

reading a cover count

### `count show`

the guarantee, the plate count and what the room is set for

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `count movements`

every time the guarantee moved

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `special`

special meals inside the guarantee

### `special add`

record a guest who needs something different

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--guest <name>` | the guest [default: ] |
| `--covers <covers>` | how many covers it is for [default: 1] |
| `--diet <diet>` | the diet they follow |
| `--avoid <allergens>` | comma separated allergens to keep away from |
| `--substitute <code>` | the dish they will be served |
| `--note <note>` | anything else [default: ] |

### `special list`

the special meals on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `special substitute`

decide what a special meal will actually be

| option | what it is |
| --- | --- |
| `--id <id>` | the special meal (required) |
| `--item <code>` | the dish (required) |

### `special remove`

take a special meal off

| option | what it is |
| --- | --- |
| `--id <id>` | the special meal (required) |

## `tax`

tax profiles and the rates in them

### `tax profile`

put a tax profile on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code for the profile (required) |
| `--name <name>` | the jurisdiction it covers (required) |
| `--service <percent>` | service charge percentage [default: 0] |
| `--gratuity <percent>` | gratuity percentage [default: 0] |
| `--service-untaxed` | the service charge is not itself taxable |

### `tax rate`

set the sales tax rate for one charge category

| option | what it is |
| --- | --- |
| `--profile <code>` | the profile (required) |
| `--category <category>` | food, beverage, rental, av, labor, service or fee (required) |
| `--percent <percent>` | the rate (required) |

### `tax list`

every tax profile on file

## `charge`

what goes on the bill

### `charge add`

put a line on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--category <category>` | the charge category (required) |
| `--description <text>` | what it is (required) |
| `--quantity <count>` | how many (required) |
| `--unit <amount>` | the unit price (required) |
| `--item <code>` | the catalog item behind it |
| `--no-tax` | the line is not taxable |
| `--service` | the service charge falls on this line |

### `charge package`

draw the package line off the guarantee and the price book

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `charge upcharge`

bill an upcharge item to the covers that took it

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--item <code>` | the upcharge item (required) |
| `--covers <count>` | how many took it (required) |

### `charge list`

every line on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `charge remove`

take a line off

| option | what it is |
| --- | --- |
| `--id <id>` | the line (required) |

## `invoice`

invoices and what has been paid

### `invoice raise`

raise an invoice against a booking

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |
| `--profile <code>` | the tax profile to bill under (required) |
| `--note <note>` | anything the client should see [default: ] |

### `invoice show`

the totals on an invoice

| option | what it is |
| --- | --- |
| `--id <id>` | the invoice (required) |

### `invoice breakdown`

the totals per charge category

| option | what it is |
| --- | --- |
| `--id <id>` | the invoice (required) |

## `minimum`

the food and beverage floor a function is sold against

### `minimum set`

put a minimum on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--amount <amount>` | the floor, as money (required) |
| `--food-only` | count food alone, leaving the bar out of it |
| `--note <text>` | the contract clause it comes from |

### `minimum show`

where the function stands against its minimum

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `minimum sweep`

put the shortfall on the bill, or take it back off

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `minimum clear`

take the minimum off a function entirely

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `statement`

what an account owes, and how long it has owed it

### `statement terms`

how long an account has to pay

| option | what it is |
| --- | --- |
| `--account <code>` | the account (required) |
| `--net <days>` | days from issue to due (required) |
| `--limit <amount>` | credit limit, nil for none [default: 0] |

### `statement show`

the statement for one account

| option | what it is |
| --- | --- |
| `--account <code>` | the account (required) |
| `--on <date>` | the date to age it at (required) |

### `statement ageing`

the balance by age bucket

| option | what it is |
| --- | --- |
| `--account <code>` | the account (required) |
| `--on <date>` | the date to age it at (required) |

## `commission`

what a third party planner is owed

### `commission agree`

record the commission an account was promised

| option | what it is |
| --- | --- |
| `--account <code>` | the account (required) |
| `--planner <name>` | who it is owed to (required) |
| `--percent <percent>` | the rate (required) |
| `--base <base>` | food-beverage, net or gross (required) |
| `--note <text>` | the clause it comes from |

### `commission due`

what the planner earns on one invoice

| option | what it is |
| --- | --- |
| `--invoice <id>` | the invoice (required) |

### `commission compare`

the same rate under each of the three bases

| option | what it is |
| --- | --- |
| `--invoice <id>` | the invoice (required) |
| `--percent <percent>` | the rate to compare at (required) |

## `settle`

paying an invoice off

### `settle pay`

record a deposit, a payment or a refund

| option | what it is |
| --- | --- |
| `--id <id>` | the invoice (required) |
| `--kind <kind>` | deposit, payment, refund or write-off (required) |
| `--amount <amount>` | how much (required) |
| `--reference <text>` | the wire or cheque reference [default: ] |

### `settle payments`

everything that has landed against an invoice

| option | what it is |
| --- | --- |
| `--id <id>` | the invoice (required) |

### `settle advance`

issue, settle or void an invoice

| option | what it is |
| --- | --- |
| `--id <id>` | the invoice (required) |
| `--to <status>` | issued, paid or void (required) |

### `settle list`

invoices, filtered

| option | what it is |
| --- | --- |
| `--booking <id>` | only this booking |
| `--status <status>` | only this status |

## `order`

the banquet event order

### `order preview`

what the sheet would say if it were drawn now

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `order draw`

freeze a new revision

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--note <note>` | why this one was drawn [default: ] |

### `order show`

print a revision as it was frozen

| option | what it is |
| --- | --- |
| `--id <id>` | the revision (required) |

### `order list`

every revision on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `order distribute`

send the live revision out

| option | what it is |
| --- | --- |
| `--id <id>` | the revision (required) |

### `order sign`

record the client signature

| option | what it is |
| --- | --- |
| `--id <id>` | the revision (required) |
| `--by <name>` | who signed it (required) |

### `order drift`

what has moved since the live sheet was drawn

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `change`

change orders against a signed sheet

### `change raise`

raise a change order off whatever has drifted

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--reason <reason>` | why the change was asked for (required) |
| `--fee <amount>` | a late fee, only allowed after the guarantee closed |

### `change show`

what one change order carries

| option | what it is |
| --- | --- |
| `--id <id>` | the change order (required) |

### `change list`

every change order on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `change apply`

apply a change order and draw a fresh revision

| option | what it is |
| --- | --- |
| `--id <id>` | the change order (required) |

### `change decline`

turn a change order down

| option | what it is |
| --- | --- |
| `--id <id>` | the change order (required) |

## `send`

who gets the order, and who has said so

### `send add`

put somebody on the standing distribution list

| option | what it is |
| --- | --- |
| `--to <name>` | the recipient (required) |
| `--role <role>` | why they get it (required) |
| `--channel <channel>` | email, print, board or hand (required) |

### `send list`

the standing distribution list

| option | what it is |
| --- | --- |
| `--all` | include the ones who have been retired |

### `send retire`

take somebody off the list without losing what they were sent

| option | what it is |
| --- | --- |
| `--to <name>` | the recipient (required) |

### `send out`

send one revision to the whole list

| option | what it is |
| --- | --- |
| `--revision <id>` | the revision (required) |

### `send ack`

record that somebody acknowledged a delivery

| option | what it is |
| --- | --- |
| `--id <id>` | the delivery (required) |

### `send standing`

who has still not said they got it

| option | what it is |
| --- | --- |
| `--revision <id>` | the revision (required) |

## `runsheet`

the run of show template

### `runsheet step`

put a step on the template for a service style

| option | what it is |
| --- | --- |
| `--style <style>` | the service style (required) |
| `--sequence <n>` | where it sits in the template (required) |
| `--label <label>` | what happens (required) |
| `--anchor <anchor>` | setup, doors, service, close or teardown (required) |
| `--offset <minutes>` | minutes from the anchor, negative for before [default: 0] |
| `--per-cover <seconds>` | seconds a cover adds, pulling the step earlier [default: 0] |
| `--owner <role>` | whose job it is [default: ] |

### `runsheet show`

the template for one service style

| option | what it is |
| --- | --- |
| `--style <style>` | the service style (required) |

## `timeline`

the run of show on a function

### `timeline anchors`

the five fixed points on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `timeline preview`

what the run of show would be without saving it

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--covers <count>` | work it out against this count instead |

### `timeline save`

freeze the run of show, keeping anything pinned

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `timeline show`

the saved run of show

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `timeline pin`

fix one step at a time somebody has decided on

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--sequence <n>` | which step (required) |
| `--minute <minute>` | the minute of the day it lands on (required) |
| `--note <note>` | why [default: ] |

### `timeline unpin`

let a step follow the count again

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--sequence <n>` | which step (required) |

## `sheet`

the sheets people print

### `sheet production`

the production sheet for one function, by station

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `sheet pick`

the pick list for one date, by store

| option | what it is |
| --- | --- |
| `--date <date>` | the service date (required) |

### `sheet trips`

how many packs come out of each store on a date

| option | what it is |
| --- | --- |
| `--date <date>` | the service date (required) |

### `sheet board`

the function board for one date

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |

### `sheet reader`

what goes on the lobby screen

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |

### `sheet staffing`

who is called in on one date

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |

## `resume`

one booking on one page

### `resume show`

every function on a booking with the covers and the money

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |

### `resume open`

only what is still open on a booking

| option | what it is |
| --- | --- |
| `--booking <id>` | the booking (required) |

## `pace`

what is coming, day by day

### `pace range`

covers and revenue across a date range

| option | what it is |
| --- | --- |
| `--from <date>` | the first date (required) |
| `--to <date>` | the last date (required) |
| `--all-days` | include the days with nothing on them |

### `pace summary`

the totals across a range, without the daily detail

| option | what it is |
| --- | --- |
| `--from <date>` | the first date (required) |
| `--to <date>` | the last date (required) |

## `today`

the one page somebody reads at seven in the morning

### `today`

the one page somebody reads at seven in the morning

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |

## `serve`

the read only http service

### `serve start`

bind a port and answer read requests until stopped

| option | what it is |
| --- | --- |
| `--port <port>` | the port to bind [default: 8377] |
| `--host <host>` | the interface to bind [default: 127.0.0.1] |

### `serve routes`

every route the service answers

### `serve get`

answer one request against the store without binding a port

| option | what it is |
| --- | --- |
| `--path <path>` | the path to fetch (required) |

## `kit`

the store cupboard and what a setup pulls

### `kit add`

put a piece of equipment on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code (required) |
| `--name <name>` | what it is called (required) |
| `--kind <kind>` | table, seating, linen, china, glass, buffet, av or staging (required) |
| `--owned <count>` | how many the property owns [default: 0] |
| `--rental <amount>` | what one costs to hire in [default: 0.00] |

### `kit list`

everything in the cupboard

### `kit rule`

say what a setup style pulls

| option | what it is |
| --- | --- |
| `--style <style>` | the setup style (required) |
| `--item <code>` | the equipment (required) |
| `--per-cover <count>` | how many a cover needs [default: 0] |
| `--per-table <count>` | how many a table needs [default: 0] |
| `--fixed <count>` | how many whatever the size [default: 0] |

### `kit rules`

what one setup style pulls

| option | what it is |
| --- | --- |
| `--style <style>` | the setup style (required) |

## `pull`

the pull sheet for a function

### `pull sheet`

what the setup pulls, off its guaranteed count

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--covers <count>` | work it out against this count instead |
| `--save` | write it against the function |

### `pull tables`

how many tables a setup needs for a cover count

| option | what it is |
| --- | --- |
| `--style <style>` | the setup style (required) |
| `--covers <count>` | the covers (required) |

## `cupboard`

what the store cupboard can cover on a day

### `cupboard day`

peak demand against what the house owns

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |
| `--short` | only the items it is short of |

### `cupboard item`

one item across a day, and who wants it at the peak

| option | what it is |
| --- | --- |
| `--date <date>` | the date (required) |
| `--code <code>` | the item (required) |

## `audit`

look for what has quietly stopped adding up

### `audit sweep`

every finding across the property

| option | what it is |
| --- | --- |
| `--today <date>` | the date the office believes it is (required) |
| `--from <date>` | only look at functions on or after this date |
| `--errors-only` | leave the warnings out |

### `audit counts`

how many findings there are, by level

| option | what it is |
| --- | --- |
| `--today <date>` | the date the office believes it is (required) |

## `bartier`

the bar tiers a property sells

### `bartier add`

put a bar tier on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code (required) |
| `--name <name>` | what it is called (required) |
| `--first <amount>` | per cover for the first hour (required) |
| `--extra <amount>` | per cover for each hour after it (required) |

### `bartier list`

every tier on file

## `bar`

the bar on a function

### `bar set`

put a bar on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--kind <kind>` | package, consumption or cash (required) |
| `--tier <code>` | the tier, for a package bar |
| `--hours <hours>` | how long it runs [default: 0] |
| `--note <note>` | anything else [default: ] |

### `bar pour`

record what came out of a bottle

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--item <code>` | the beverage (required) |
| `--opening <tenths>` | tenths of a bottle at the start (required) |
| `--closing <tenths>` | tenths of a bottle at the end (required) |
| `--unit <amount>` | what a whole bottle costs (required) |

### `bar show`

the bar on a function and what it comes to

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `bar pours`

every bottle counted on a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `bar reconcile`

which way of selling the bar turned out to be right

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `barbill`

putting the bar on the invoice

### `barbill draw`

draw the bar charge onto the function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `split`

the covers per dish in a course

### `split set`

replace the split for one course

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--course <course>` | the course (required) |
| `--covers <pairs>` | comma separated ITEM:count pairs (required) |

### `split show`

every split on a function, with anything that does not add up

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `split clear`

take every split off a function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `factor`

how much more than the plate count a style has to be made

### `factor set`

publish the factor for one service style

| option | what it is |
| --- | --- |
| `--style <style>` | PLATED, BUFFET, STATIONS, RECEPTION or FAMILY (required) |
| `--percent <percent>` | the factor as a percent, so 115 is fifteen over (required) |
| `--note <text>` | why the chef set it there |

### `factor list`

every factor a property has published

### `factor show`

the factor in force for one style, published or not

| option | what it is |
| --- | --- |
| `--style <style>` | the service style (required) |

## `stock`

what is on the shelf and what should be

### `stock count`

record a physical count

| option | what it is |
| --- | --- |
| `--item <code>` | the ingredient (required) |
| `--on-hand <quantity>` | what was counted, like 40kg (required) |
| `--par <quantity>` | what the house wants sitting there |

### `stock move`

issue to a function or receive a delivery

| option | what it is |
| --- | --- |
| `--item <code>` | the ingredient (required) |
| `--by <quantity>` | the movement, negative to issue (required) |
| `--reason` | ISSUE, RECEIVE, WASTE or TRANSFER (required) |
| `--reference <text>` | the requisition or delivery note |

### `stock list`

the whole shelf

### `stock short`

everything sitting under its par

### `stock order`

what to order for a requirement, in whole packs

| option | what it is |
| --- | --- |
| `--item <code>` | the ingredient (required) |
| `--need <quantity>` | what the functions need (required) |

### `stock history`

every movement against one ingredient

| option | what it is |
| --- | --- |
| `--item <code>` | the ingredient (required) |

## `purchase`

what to buy in, netted against the shelf

### `purchase draft`

draft an order across a set of functions

| option | what it is |
| --- | --- |
| `--functions <ids>` | comma separated function ids (required) |

### `purchase summary`

pack counts by store, without the detail

| option | what it is |
| --- | --- |
| `--functions <ids>` | comma separated function ids (required) |

## `cost`

what a plate costs to put out

### `cost quote`

record what a supplier charges for a pack

| option | what it is |
| --- | --- |
| `--item <code>` | the ingredient (required) |
| `--from <date>` | the date the price takes effect (required) |
| `--pack <amount>` | what one pack costs (required) |
| `--supplier <name>` | who quoted it |

### `cost history`

every price quoted against one ingredient

| option | what it is |
| --- | --- |
| `--item <code>` | the ingredient (required) |

### `cost recipe`

cost one recipe, batch and portion

| option | what it is |
| --- | --- |
| `--recipe <code>` | the recipe (required) |
| `--on <date>` | the date to price it on (required) |

### `cost margin`

the margin on a recipe against a price

| option | what it is |
| --- | --- |
| `--recipe <code>` | the recipe (required) |
| `--on <date>` | the date to price it on (required) |
| `--price <amount>` | what the plate sells for (required) |

## `larder`

the ingredients the kitchen buys

### `larder add`

put an ingredient on file

| option | what it is |
| --- | --- |
| `--code <code>` | short code the recipes use (required) |
| `--name <name>` | what it is called on the invoice (required) |
| `--area <store>` | DRY, CHILL, FREEZE, PRODUCE, BUTCHER, CELLAR or NONFOOD (required) |
| `--unit <unit>` | the unit it is counted in (required) |
| `--pack <size>` | how much comes in one pack (required) |
| `--pack-unit <unit>` | the unit the pack is measured in, if it differs |

### `larder list`

every ingredient, or just one store

| option | what it is |
| --- | --- |
| `--area <store>` | narrow to one store |
| `--all` | include the ones taken off the list |

### `larder retire`

take an ingredient off the buying list without deleting it

| option | what it is |
| --- | --- |
| `--code <code>` | the ingredient (required) |

## `actual`

what the kitchen made on the night

### `actual record`

record what went out and what came back

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--recipe <code>` | the recipe (required) |
| `--produced <count>` | portions that went out (required) |
| `--returned <count>` | portions that came back [default: 0] |
| `--note <text>` | anything the chef wants remembered |

### `actual variance`

plan against actual for one function

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `actual suggest`

what the production factor should have been

| option | what it is |
| --- | --- |
| `--functions <ids>` | comma separated function ids, all one service style (required) |

## `menu`

what a package costs and what it makes

### `menu cost`

cost a package by its dearest choice in each course

| option | what it is |
| --- | --- |
| `--package <code>` | the package (required) |
| `--on <date>` | the date to price it on (required) |

### `menu margin`

the margin a package is priced at

| option | what it is |
| --- | --- |
| `--package <code>` | the package (required) |
| `--book <code>` | the price book (required) |
| `--on <date>` | the date to price it on (required) |

### `menu actual`

what one function actually cost, off the split

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--on <date>` | the date to price it on (required) |

## `kitchen`

what the split turns into

### `kitchen plates`

plates per dish, the split and the substitutions together

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `kitchen batches`

whole batches per recipe, by station

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `kitchen stores`

what has to come out of the stores, with the waste on the last pack

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

## `req`

requisitions on the stores

### `req raise`

draw a requisition for one store off a set of functions

| option | what it is |
| --- | --- |
| `--date <date>` | the service date (required) |
| `--area <store>` | the store area (required) |
| `--functions <ids>` | comma separated function ids (required) |
| `--note <note>` | anything the store should know [default: ] |

### `req show`

the lines on a requisition

| option | what it is |
| --- | --- |
| `--id <id>` | the requisition (required) |

### `req list`

requisitions, filtered

| option | what it is |
| --- | --- |
| `--date <date>` | only this service date |
| `--area <store>` | only this store area |
| `--status <status>` | only this status |

### `req advance`

issue, pick or cancel a requisition

| option | what it is |
| --- | --- |
| `--id <id>` | the requisition (required) |
| `--to <status>` | issued, picked or cancelled (required) |

### `req redraw`

redraw a draft against the demand as it stands now

| option | what it is |
| --- | --- |
| `--id <id>` | the requisition (required) |
| `--functions <ids>` | comma separated function ids (required) |

## `staffing`

the ratios and rates a property works to

### `staffing rule`

one head per so many covers, for a service style and a role

| option | what it is |
| --- | --- |
| `--style <style>` | the service style (required) |
| `--role <role>` | the role (required) |
| `--per <covers>` | covers per head, or servers per head for a captain (required) |
| `--minimum <heads>` | the fewest ever called in [default: 0] |
| `--call <hours>` | the shortest shift the property pays [default: 4] |
| `--lead-in <minutes>` | minutes before the function [default: 60] |
| `--lead-out <minutes>` | minutes after it [default: 30] |

### `staffing rules`

the ratios for one service style

| option | what it is |
| --- | --- |
| `--style <style>` | the service style (required) |

### `staffing rate`

what a role is paid from a date

| option | what it is |
| --- | --- |
| `--role <role>` | the role (required) |
| `--from <date>` | the date it takes effect (required) |
| `--hourly <amount>` | the hourly rate (required) |

### `staffing rates`

every rate a role has ever been paid

| option | what it is |
| --- | --- |
| `--role <role>` | the role (required) |

### `staffing heads`

what a cover count works out to, before anything is rostered

| option | what it is |
| --- | --- |
| `--style <style>` | the service style (required) |
| `--covers <covers>` | the covers (required) |

## `crew`

the roster on one function

### `crew build`

roster the function off the covers the room is set for

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--covers <count>` | work it out against this count instead |

### `crew add`

add a shift the rules did not produce

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |
| `--role <role>` | the role (required) |
| `--heads <count>` | how many (required) |
| `--from <minute>` | the minute of the day they start (required) |
| `--to <minute>` | the minute they finish (required) |
| `--hourly <amount>` | an hourly rate, if it is not the one on file |
| `--note <note>` | why [default: ] |

### `crew show`

who is called in, and what it comes to

| option | what it is |
| --- | --- |
| `--function <id>` | the function (required) |

### `crew remove`

take a shift off

| option | what it is |
| --- | --- |
| `--id <id>` | the shift (required) |

## `pool`

handing the service charge back out to the crew

### `pool points`

publish the points a role earns in the split

| option | what it is |
| --- | --- |
| `--role <role>` | the role (required) |
| `--points <points>` | points, relative to the other roles (required) |

### `pool table`

the points every role earns

### `pool split`

split the service charge on an invoice across the crew

| option | what it is |
| --- | --- |
| `--invoice <id>` | the invoice (required) |

### `pool check`

whether a recorded split still matches the invoice

| option | what it is |
| --- | --- |
| `--invoice <id>` | the invoice (required) |
