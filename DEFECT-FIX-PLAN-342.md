# PHASED DEFECT FIX PLAN · FROM BUILD 342

**Platform:** Vaultique Business Platform
**Written against:** build 341
**Revised at:** build 342, after Phase 0's decision pass
**Register:** `DEFECTS-341.md` + `DEFECTS-342-ADDENDUM.md`
**Companion:** `PHASE-0-DECISIONS-342.md` — the sheet that unblocks Phases 2–4

---

## IN PLAIN ENGLISH, FIRST

**The migration finished at build 338.** The standing rule that has been
deferring these — *"a defect that does not affect the migration is recorded here
and fixed after it is finished"* — no longer defers anything. Every open item is
now due.

**There are twelve.** The register's heading says nine and `PHASE-115` says nine;
both predate D-45, which opened at build 338. **Phase 0 then found two more** —
D-46 and D-47 — while reading the code to write the decision sheet properly.

**The code is small. The decisions are not.** Every fix here is between one line
and one function. What actually gates them is **seven decisions that are yours**,
and several are not about code at all — they are about what to do with records
already on file. That is the critical path, so it is Phase 0 and it is asked all
at once rather than one question per build.

**Three need nothing from you** and can start immediately, in parallel with the
decision sheet: D-45, D-35, D-31.

> **This revision.** Phase 0 changed two of this plan's own recommendations and
> added two defects. The Q7 recommendation — delete HR's Analytics screen — was
> **withdrawn**: it rested on the register's claim that wiring meant ten reports
> of new work, and that claim is wrong. Wiring is two lines. See
> `DEFECTS-342-ADDENDUM.md` §2.1.

---

## THE TWELVE, AND WHAT EACH ACTUALLY NEEDS

Sites verified against the build 341 tree, not read off the register.

| ID | Site | Code | Decision | Phase |
|---|---|---|---|---|
| D-45 | `js/modules/finance.js:1554` | 1 line | none | 1 |
| D-35 | `js/modules/hr.js:9275` | 1 line | none | 1 |
| D-31 | `js/modules/inventory/movements.js:428` | 1 line | none¹ | 1 |
| D-37 | `js/modules/hr.js:10139` | 1 line | Q4 · backfill? | 2 |
| D-33 | `js/modules/procurement/supplierreturns.js:188,191` | 1 line | Q3 · the gaps? | 2 |
| **D-47** | `js/modules/sales/orders.js:220,222` | 1 line | Q3 · with D-33 | 2 |
| D-30 | `js/modules/crm.js:374,537` | ~3 lines² | Q1 · which of two | 2 |
| D-32 | `js/modules/inventory/stocktake.js:208,212` | ~3 lines | Q2 · what it says | 2 |
| D-34 | `js/modules/hr.js` ×5 registers | 5 labels | Q5 · the wording | 3 |
| **D-46** | `js/modules/hr.js:7134, :8290` | ~8 figures | Q5b · which population | 3 |
| D-42 | `js/modules/users.js:508` **and** `:612` | rename or delete | Q6 · which one | 4 |
| D-43 | `js/modules/hr.js:3097`, `HR_AREAS:73` | 2 lines either way | Q7 · wire or delete | 4 |

¹ D-31 has a presentation convention attached, but the defect can be fixed
without settling it. See Phase 1.
² Revised down from ~5: `_timeline()` already does the lookup the fix needs.

**Corrections to the register carried by this plan**, each written up in
`DEFECTS-342-ADDENDUM.md` §2:

- **D-45 is in Finance, not HR** — `js/modules/finance.js:1554`. The entry quotes
  the handler without naming a file and the surrounding text reads as HR.
- **D-43 is six reports, not sixteen**, and all six already have painters.
- **`_hrAnPaint()` carries four lines of dead code**, unrecorded.
- **D-34's training register is `_trnRecords()`**, not `_trnRender`.
- **D-32's `apply()` builds its line array twice**, unrecorded.

---

## PHASE 0 · DECIDE · NO CODE · BLOCKS PHASES 2, 3 AND 4

**Done.** `PHASE-0-DECISIONS-342.md` is the sheet. Seven questions, each with a
recommendation except Q7, which honestly has none.

It also produced `tools/phase-0-diagnose.cjs` — a read-only script that sizes the
three questions that ask about records already on file. Q3 and Q4 cannot be
answered from source; they can only be answered from your data.

**Nothing after this point starts until the sheet comes back, except Phase 1,
which never needed it.**

---

## PHASE 1 · THE THREE THAT NEED NOTHING FROM YOU · 3 BUILDS

Starts immediately, in parallel with Phase 0. Cheapest first, and deliberately
low-stakes: this phase re-establishes the fix-then-flip-the-test loop before it
is pointed at anything that matters.

### Build 342 · D-45 · the double-escaped approver

`js/modules/finance.js:1554`. `js/components/ui.js:493` escapes the whole
message once, for every caller. This one escapes the approver's name again
first, so a chain ending at **"Finance & Admin Manager"** reads *"signed by
Finance &amp;amp; Admin Manager"*.

**The fix:** drop `escHtml(` and its closing bracket. Nothing else moves. The
tell that it is a leftover is in the same sentence — the asset's own name, two
clauses earlier, is correctly not escaped.

**No test asserts this today.** It is the one open defect with no standing
assertion, so this build writes one: drive the dialog with a role named with an
`&` in it.

### Build 343 · D-35 · Documents "By Type" can show one type twice

`js/modules/hr.js:9275`. Grouping trusts `d.type` as free text, so
`"Work Permit"` and `"Work permit"` count as two types on two rows.

**The fix:** group case-insensitively; display the spelling from `DOC_TYPES`
where one matches, and the record's own where none does.

**Nothing in the sample data hits it**, which is why it has no failing test. The
build seeds an off-list spelling and proves the two collapse to one row.
`tools/phase-0-diagnose.cjs` reports whether your live data hits it.

### Build 344 · D-31 · internal transfers counted as stock leaving the business

`js/modules/inventory/movements.js:428`:

```js
const d = effectAt(e, b) || (e.direction==="in" ? e.qty : -e.qty);
```

`effectAt()` is right: at company level a transfer returns `0`, because moving
stock between your own shops changes nothing about what the business holds. The
`||` reads that correct zero as *"no answer"* and falls through to the
movement's own direction — which for a transfer is neither, so it lands on
`-e.qty` and counts the units out.

**The fix:** separate *"this movement does not affect the view"* from *"this
movement has no effect recorded"* rather than folding them together with `||`.

**On the convention.** Two readings are defensible — a transfer is neither in nor
out at company level (**in 10, out 2, net 8**), or it is both (**in 14, out 6,
net 8**). Both give the same Net; today's behaviour gives neither and its Net is
wrong under both. **The fix as written falls out at "neither", because that is
what `effectAt()` already returns.** If you want "both", say so and it is a
different line — but do not let that choice hold the defect, because Net is the
figure that is wrong.

**Flips:** `tests/browser/inventory-movements.cjs`, which asserts today's
behaviour on purpose. Needs a check per branch as well as at company level: the
per-branch figures are already correct and must stay correct.

---

## PHASE 2 · RECORDS AND DOCUMENTS · 4 BUILDS · NEEDS Q1–Q4

Ordered cheapest first. Every one of these has a tail — *what about the records
already on file* — and in each case **the code fix ships without waiting for the
backfill answer.** Fix the behaviour going forward; treat historical repair as
its own decision with its own build, or as no build at all.

### Build 345 · D-37 · correcting a typo moves an old review's date to today

`js/modules/hr.js:10139`:

```js
if(status==="Completed") data.completedOn=new Date().toISOString().slice(0,10);
```

Applied on **every** save of a completed review, not only the save that completes
it, and `Object.assign` then writes it over whatever the record held.

**The fix:** set `completedOn` only when the review does not already carry one.

**Scoped, not assumed.** The training form and the disciplinary form were checked
and carry no such stamp. This is one form, not a pattern.

**Flips:** `tests/build-307.cjs` §7 and `tests/browser/hr-performance.cjs` §9.
Both currently assert the wrong date, and the browser one checks that My Account
agrees with it — so both fail on the day it is fixed, which is the point.

### Build 346 · D-33 **and D-47** · references that skip every other number

**One shape, two screens, one build.**

| | |
|---|---|
| D-33 | `js/modules/procurement/supplierreturns.js:188, :191` — `SR-` |
| D-47 | `js/modules/sales/orders.js:220, :222` — `CO-` |

Both take **two** numbers from one sequence for one record: the first call builds
the reference, the second gives the record its id.

**The fix:** take one, use it for both. This is not a new idea — **build 295
fixed this exact shape on Goods Received** and recorded the rule: *"One number,
from the sequence, used for both the id and the reference."* It was never applied
beyond that screen, which is why the sweep for it was worth running.

**D-47 was found by that sweep**, pulled forward into Phase 0 because Q3 asks
whether to renumber and that cannot be answered without knowing how many screens
produce bad references. **The sweep is complete**: five candidate sites, three
correct and checked (`p2s.js` journals, `returns.js` and `till.js` payments), two
real, both fixed here.

**D-47 matters more than D-33.** A supplier return reference is quoted to a
supplier; **a custom order reference is on a slip in a customer's hand.**

**Flips:** `tests/browser/supplier-returns.cjs`. **Writes:** the equivalent for
custom orders, which does not exist.

### Build 347 · D-30 · a prospect's follow-ups vanish on conversion

`js/modules/crm.js:374` `_convertLead()` and `:537` `_timeline()`. Per Q1.

**Cheaper than the first draft of this plan said.** `_timeline()` **already**
follows `convertedCustomerId` — it does that lookup at `:549` to draw the
"Converted from lead" event. The recommended fix reuses the lead ids it has
already collected and pulls their activities too, so the call appears on the
customer's profile **still labelled as lead-stage work**, which is what it was.

**Flips:** `tests/browser/crm-journey.cjs`, whose §7 asserts the follow-up is
absent and says in its own comment that it is asserting the defect.

### Build 348 · D-32 · the stock take sheet files uncounted lines as agreed

`js/modules/inventory/stocktake.js:212`. Per Q2.

```js
rec.lines = rows.map(p => { … const phys = (raw===undefined||raw==="") ? before : … });
```

`rows` is every product on the sheet, not the ones counted. A blank falls back to
the system figure, which is indistinguishable from a count that matched.

**Last in this phase because it is the one that changes what a signed document
contains.** A stock take is the paper a shop signs to say what it physically saw.

**Three sibling projections build lines the same way** — `:208`, `:212` and
`:272`. Whatever is decided applies to all three or the preview, the record and
the printed sheet will disagree with each other. **The footer at `:259` counts
`lines.length` while the record carries `items:`**, and those two must come to
agree under either option.

**Also in this build:** `apply()` builds `rec.lines` twice — at `:208` inside the
record literal, then again at `:212`. The first is dead and goes here, since this
fix is already editing both lines.

**Flips:** `tests/browser/stocktake.cjs`.

---

## PHASE 3 · THE BRANCH FIGURES · 2 BUILDS · NEEDS Q5 AND Q5b

**Two builds, not one.** The plan originally had one. Phase 0 found that the
shape D-34 describes has a worse cousin on two more screens, and the two cannot
share a build because **D-34 moves no number and D-46 moves eight.**

### Build 349 · D-34 · say which branch the figures mean

Five sites, one label each:

| Register | Function | Cards at |
|---|---|---|
| Documents | `_docRegister` | `hr.js:9247` |
| Discipline | `_disOpen` | `hr.js:9474` |
| Assets | `_astOut` | `hr.js:9703` |
| Performance | `_perfRevView` | `hr.js:10006` |
| Training | `_trnRecords` | `hr.js:10270` |

**The arithmetic is already right** — verified card by card at build 342 rather
than carried over from the build 303 survey. Every figure in each of the five
derives from that register's own scoped list. Nothing about what is counted
changes: **this build changes no number on any screen.** That is why it can be
one build across five registers where Phase 2 is one defect per build.

**Why it is worth a build at all.** The figure people act on is **Expired** — a
lapsed work permit or professional licence. Reading *"Expired 0"* in the
Livingstone view and taking it to mean the business has none is the wrong
conclusion and the natural one to draw from a number with no qualifier on it.

### Build 350 · D-46 · leave and loans count two different populations at once

`js/modules/hr.js:7134` (`_lvOverview`) and `:8290` (`_lnOverview`). Per Q5b.

Two cards in each row of four count the branch; the other two count the whole
business. **No caption can be written that is true of the row.**

| Leave | | Loans | |
|---|---|---|---|
| On leave today | branch | Outstanding book | business |
| Awaiting approval | **business** | Active loans | business |
| Leave days this year | **business** | Awaiting approval | business |
| Leave liability | branch | Due this month | **branch** |

**This build changes what four figures say on two screens**, which is exactly why
it is separated from 349. The warning banners underneath — leave conflicts, loan
arrears — inherit the same mix and move with the cards.

**No test asserts this yet.** It needs a fixture with two branches and staff in
both, which `tests/browser/hr-leave.cjs` and `hr-loans.cjs` do not build. Writing
that fixture is most of this build.

---

## PHASE 4 · INTENT · 2 BUILDS · NEEDS Q6 AND Q7

Last, because these are the only two that delete or wire a screen rather than
correct a line. **Neither is expensive** — Phase 0 established that — so this
phase is last on blast radius, not on cost.

### Build 351 · D-42 · one name, two functions

`js/modules/users.js:508` and `:612`. Per Q6. Two top-level `function`
declarations sharing a name is not an error in JavaScript — the later silently
wins — and the type gate does not report it.

**Phase 0 found they are not duplicates.** `:508` is an **exceptions report**
(everyone whose access differs from their role); `:612` is a **per-user editor**.
They answer different questions, and `js/modules/settings.js:1260` already
carries a third screen doing the editor's job on the same records.

**On the recommended answer (c) — rename the report** — the fix is a rename, not
a deletion, and the exceptions report becomes reachable for the first time.

**On closing, remove the exception** in `tests/build-321.cjs` §6b:

```js
const KNOWN_DUPLICATES = { "js/modules/users.js": ["_uOverrides"] };
```

That check requires no file in `js/` to declare a function twice, with this named
as the one exception on record. Emptying it is the proof.

**Whichever way it goes, drive the Overrides tab in a browser afterwards**, and
reconcile the three statements the platform makes about where overrides are
edited — `_uRoles()`, the read-only `_uOverrides`, and `settings.js:1269`. They
do not currently agree, and a comment that contradicts the screen is how the next
person makes a wrong decision.

### Build 352 · D-43 · HR's Analytics screen

`js/modules/hr.js:3097`, `HR_AREAS` at `:73`. Per Q7.

**The plan's original recommendation is withdrawn.** It said delete, because the
register described sixteen reports with painters for six. **The tab strip is six
reports and all six already draw through `reports/table`**, the same panel
Reports uses, from the same specs.

| | |
|---|---|
| **Wire it** | one `HR_AREAS` entry + one branch in `_paintHR()`. Two lines. |
| **Delete it** | `_hrAnalytics()`, `_hrAnPaint()`, `_hrAnRepLabel()`, `_hrAnMountSpec()`, `HR_REPORTS` and four dead fallbacks. |

**Either way, the four dead fallback lines in `_hrAnPaint()` go** — they are
unreachable under both options.

**Flips:** `tests/build-323.cjs` §5 and `tests/browser/hr-reports-contract.cjs`
§1, from "defined and unreachable" to whichever is true.

---

## PHASE 5 · THEN THE QUESTION THIS PLAN DOES NOT ANSWER

**Builds 251 to 341 are unshipped by decision**, taken at build 266: the live
platform was not to be interrupted while the migration was in progress. It has
not been in progress since build 338.

So when Phase 4 closes there are **ninety-one builds plus eleven defect-fix
builds** between the shop and `main`. That is a large first deploy, and it is a
separate piece of work from this plan — but it is the reason this plan matters,
because **none of these fixes reaches the shop until that happens.**
`DEPLOY.md` is the starting point.

Worth saying plainly: if the deploy is going to be staged, the twelve fixes here
are good candidates for the first stage. They are small, individually
verifiable, and every one has a test that fails if it regresses.

---

## HOW EVERY BUILD IN THIS PLAN IS VERIFIED

Not new. This is the loop builds 224 to 341 already run, written down so no phase
quietly drops a step.

**1 · Flip the test that asserts the defect.** Most open items have a standing
check that asserts the **broken** behaviour on purpose, so that the day it is
fixed the check fails and says so rather than passing quietly. Flipping it is not
paperwork — it is the evidence the fix landed. **Three have no such check** —
D-45, D-46 and D-47 — and those builds write one first.

**2 · Run everything.**

```
node tests/run-all.cjs          # 169 files
bun  tests/run-all.cjs          # the same 169, under Bun
bash tools/typecheck.sh         # gate must stay 0
node tools/validate.mjs         # 11 checks
node tests/browser/run-all.cjs  # 71 files
node tests/browser/stage6-baseline.cjs
```

**3 · Drive it in a browser.** The register is emphatic about this and has been
right twice: **D-05's severity was six times understated** because it had been
read rather than run, and **D-26 was recorded as a slow first paint** until it
was measured against a font host that hangs — at which point the platform turned
out to be **unusable for thirteen seconds**. Read is not driven. **D-46 and D-47
are both marked `scope` and neither is closed until it is driven.**

**4 · One defect per build**, per the standing rule — with two exceptions, each
earning it: build 349 takes five registers because it changes no number, and
build 346 takes D-33 and D-47 because they are one shape and fixing one without
the other repeats the mistake build 295 already made.

**5 · Update the register in the same build.** Move the entry to CLOSED with what
was decided and why, not only what was changed.

---

## WHAT THIS PLAN DOES NOT TOUCH

Stated explicitly, because the register's standing constraint from build 242 is
that neither is to be replaced, in whole or by stages that add up to a whole:

**Nothing here touches Supabase, Netlify or AWS.** All twelve are client-side.
That was true of every item in the register at build 226 and it is still true:
the sites are `js/modules/`, `js/services/` and `js/components/`, and none of
them is a write path, a function, or a schema.

**No file in `js/` is converted to TypeScript by this plan.** 50,278 lines stay
`.js`, and `tests/` asserts it.

---

## THE SHAPE OF IT, IN ONE PLACE

| Phase | What | Builds | Blocked on |
|---|---|---|---|
| **0** | Seven decisions | **done** | you |
| **1** | D-45, D-35, D-31 | 342–344 | nothing — starts now |
| **2** | D-37, D-33+D-47, D-30, D-32 | 345–348 | Q1–Q4 |
| **3** | D-34 ×5, then D-46 ×2 | 349–350 | Q5, Q5b |
| **4** | D-42, D-43 | 351–352 | Q6, Q7 |
| **5** | The deploy | — | separate work |

**Twelve defects, eleven builds.** Phase 1 does not wait for anything.
Everything after it waits on a decision sheet, which is why Phase 0 is one sheet
and not seven conversations.
