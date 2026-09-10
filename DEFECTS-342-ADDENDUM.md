# DEFECT REGISTER · ADDENDUM FOR BUILD 342

**Platform:** Vaultique Business Platform
**Build:** 342
**Written against:** `DEFECTS-341.md`
**Defects:** **D-46 and D-47 opened, neither fixed.** None closed.

This is an addendum rather than a rewrite of the 273 KB register. Merge these
entries into `DEFECTS-342.md` in the positions marked, or keep it beside the
register — but the four corrections in §2 should be applied to the entries they
name, because each one is currently wrong in a way that would misinform whoever
takes the fix.

**Nothing here touches Supabase, Netlify or AWS.** Both new defects are
client-side, in `js/modules/`.

---

## 1 · TWO NEW DEFECTS

Both were found during Phase 0's decision pass — the pass that exists to write
questions, not to find defects. Both were found the way this register's better
findings usually are: by reading a file in order to describe it accurately.

**Neither was caused by the migration.** D-47's two lines and D-46's four figures
are unchanged in build 225's source, the earliest in this repository.

### Insert under OPEN, FIX AFTER THE MIGRATION

---

### D-47 · custom order references skip every other number

**Found at build 342 by the sweep D-33's fix was going to run at build 346.**
Run early, because Q3 asks whether to renumber historical references and that
cannot be answered without knowing how many screens produce bad ones. **Not
caused by the migration. Fix with D-33, in one build.**

**Class:** one record drawing twice from one sequence.
**Verified:** `scope` — established by reading both lines and the sweep that
found them. Not yet driven through the dialog.
**Severity:** `silent` — the references look like records were deleted.

Your custom order references run **CO-2026-0001, CO-2026-0003, CO-2026-0005** —
never the even ones.

```js
js/modules/sales/orders.js
220:  const ref = "CO-"+new Date().getFullYear()+"-"+String(nextId("corder")).padStart(4,"0");
221:  const payments = paid>0 ? [{ … }] : [];
222:  DB.customOrders.push(Object.assign({ id:nextId("corder"), ref, … }, data));
```

Two lines apart, one record, two numbers. The first call builds the reference,
the second gives the record its id, and each advances the counter.

**This is D-33 exactly**, on a second screen, and D-33 is itself the mirror of
the fault build 295 fixed on Goods Received and wrote down as a rule: *"One
number, from the sequence, used for both the id and the reference."* **That rule
has now been broken, found and re-recorded three times.** It was never applied
beyond the screen it was written on.

**Why it matters more than D-33 does.** A supplier return reference is quoted to
a supplier. **A custom order reference is quoted to a customer** — it is what
somebody reads back at the counter when they come to collect a made-to-order
item, and it is on the slip in their hand. A run of missing numbers on a
customer-facing sequence invites exactly the wrong conclusion.

**How the sweep was done, so it can be repeated rather than trusted.** Every
`nextId("…")` call in `js/` was read, grouped by sequence key, and any two draws
on the same key within twenty-five lines were reported. **Five sites came back.
Three are correct and were checked rather than assumed:** `procurement/p2s.js`
writes two different journal entries, `sales/returns.js` writes two different
payments (credit applied, then balance), and `sales/till.js` the same. **Two are
one record taking two numbers**, and those two are D-33 and this.

**The fix, when it is taken:** take one number, use it for both — the same one
line as D-33, and they should be one build. What to do about the references
already on file is a decision about your records, not a code choice, and it is
**Q3** on the Phase 0 sheet.

**No test asserts this yet.** D-33 has `tests/browser/supplier-returns.cjs`
holding it; the equivalent for custom orders does not exist. The build that
fixes both writes it.

---

### D-46 · leave and loans count the branch and the business in the same row of cards

**Found at build 342 while checking D-34's reach.** Not caused by the migration.
**Fix after D-34, and not with it.**

**Class:** two figures in one row answering questions about different
populations.
**Verified:** `scope` — established by reading each figure to its source. Not yet
driven with a second branch on screen.
**Severity:** `silent` — every figure is a plausible number and none is labelled.

D-34 records that five employee-keyed registers show branch-scoped figures with
no label saying so. That is correct and all five were verified at build 342. But
`_hrRecScopeByEmp()` — the helper D-34 is described in terms of — **has eight
consumers, not five.** The other three belong to leave and loans, and those two
screens have a different problem.

**Leave overview**, `js/modules/hr.js:7134`:

| Card | Counts | From |
|---|---|---|
| On leave today | **this branch** | `_hrScopeByBranch(_lvEmployees())` |
| Awaiting approval | **the whole business** | raw `_lvRecords()` |
| Leave days this year | **the whole business** | raw `_lvRecords()` |
| Leave liability | **this branch** | the scoped `emps` |

**Loans overview**, `js/modules/hr.js:8290`:

| Card | Counts | From |
|---|---|---|
| Outstanding book | **the whole business** | `_lnBookValue()` over raw `_lnLoans()` |
| Active loans | **the whole business** | raw `_lnLoans()` |
| Awaiting approval | **the whole business** | raw `_lnLoans()` |
| Due this month | **this branch** | `_hrScopeByBranch(_lnEmps())` |

`_lvRecords()` and `_lnLoans()` return `_FDB.leaveRecords` and `_FDB.loans`
unfiltered — there is no scoping in either, and none of the four mixed cards
passes through `_hrRecScopeByEmp()`.

**Why this is not D-34 and must not be fixed with it.** D-34 is four correct
numbers missing a caption; the fix is a label and **no number moves**, which is
what lets five registers share one build. **Here a caption cannot be written that
is true of the row** — "Livingstone" would be false of two cards and "all
branches" false of the other two. Fixing it means deciding which population each
card should count, and **that changes what four figures say on two screens.**

**The warning banners inherit it.** The leave conflicts banner
(`_lvAllConflicts()`, `:6836`) and the loan arrears figure both walk the raw
collections, so a branch view warns about conflicts and arrears from shops the
reader is not looking at, underneath cards that are half branch-scoped.

**Not something the migration did.** All four mixed figures read the same in
build 225's source. The conversion moved the tables beneath these cards and did
not touch the cards.

**The fix, when it is taken**, is **Q5b** on the Phase 0 sheet: make the row
consistently branch-scoped (recommended, and consistent with the five registers
beside it), consistently company-wide, or label every card individually. All
three are defensible; only one is what the business wants to read.

**No test asserts this yet.** It needs a fixture with two branches and staff in
both, which `tests/browser/hr-leave.cjs` and `hr-loans.cjs` do not currently
build.

---

## 2 · FOUR CORRECTIONS TO ENTRIES ALREADY IN THE REGISTER

Each of these is currently wrong in the register in a way that would mislead
whoever takes the fix. Three are factual; the first changed a recommendation.

### 2.1 · D-43 · "sixteen reports and a painter for six" is wrong

The entry says *"What is behind it: a tab strip of **sixteen reports** and a
painter for six of them."* **Both halves are wrong at build 341.**

`HR_REPORTS` — the strip `_hrAnalytics()` actually draws — has **six** entries:

```js
js/modules/hr.js:3061
  directory, headcount, attendance, overtime, leavebal, leavehist
```

**All six are keys in `HR_REPORT_SPECS`**, so all six hand over a spec and draw
through `reports/table` — the same panel the Reports module uses, from the same
specs. `reports.js:2176` calls `HR.hrReportSpec(key)` for its own HR family.
**Nothing behind that tab is missing a painter.**

The "sixteen" appears to come from `HR_REPORT_SPECS`, which is a different and
larger set — **seventeen** keys serving the Reports module, thirteen real reports
and four `_hrAnPending()` placeholders. The comment at `:2994` says "sixteen"
too, so the miscount is older than the D-43 entry and was inherited by it.

**Why the correction matters.** The register's framing made wiring the tab look
like ten reports of new work, and `DEFECT-FIX-PLAN-342.md` recommended deleting
it on exactly that basis. **Wiring it is one `HR_AREAS` entry and one branch in
`_paintHR()`** — two lines, beside the branches already there for `recruitment`
and `employees`. The recommendation is withdrawn; **Q7 now carries no
recommendation**, because both options are cheap and the choice is a product one.

### 2.2 · D-43 · four lines of dead code in `_hrAnPaint()`

Not in the entry at all. After the spec check at `js/modules/hr.js:3138`:

```js
if(_hrAnRep==="attendance") return void (el.innerHTML=_hrAnAttendance(emps));
if(_hrAnRep==="overtime")   return void (el.innerHTML=_hrAnOvertime(emps));
if(_hrAnRep==="leavebal")   return void (el.innerHTML=_hrAnLeaveBalances(emps));
if(_hrAnRep==="leavehist")  return void (el.innerHTML=_hrAnLeaveHistory(emps));
```

All four keys are in `HR_REPORT_SPECS`, so `spec` is always truthy and the
function returns before reaching any of them. They are the pre-spec rendering
that build 323 replaced and did not remove. **They go with whichever way Q7 is
decided** — they are not a reason to decide it either way.

### 2.3 · D-34 · the training register's function name

The plan named `_trnRender`. The register does not name the five functions at
all, so this corrects the plan rather than the register, but it belongs with the
D-34 entry when the five are written down: training's cards are in
**`_trnRecords()`, `js/modules/hr.js:10262`, cards at `:10270`.** The other four
are `_docRegister` (`:9247`), `_disOpen` (`:9474`), `_astOut` (`:9703`) and
`_perfRevView` (`:10006`).

**And D-34's claim holds where it is made.** Every card in each of the five
derives from that register's own scoped list — checked in source at build 342,
not carried over from the build 303 survey.

### 2.4 · D-32 · `apply()` builds the line array twice

Not in the entry. `js/modules/inventory/stocktake.js:208` builds `rec.lines`
inside the record literal, and `:212` immediately throws that away and rebuilds
it from the pre-adjustment figures. The comment above the second explains why the
second is needed; nothing explains why the first survives.

Dead work rather than a defect — the result is identical because the second
assignment wins. **It should go with the D-32 fix**, since that fix is already
editing both lines, rather than becoming its own entry.

---

## 3 · THE COUNT

The register's `OPEN, FIX AFTER THE MIGRATION` heading says *"Nine, as of build
323"*, and `PHASE-115` §7 says *"your nine defects"*. Neither was updated when
D-45 opened at build 338.

**Twelve are open at build 342:**

| | |
|---|---|
| From build 323 | D-30, D-31, D-32, D-33, D-34, D-35, D-37, D-42, D-43 |
| Opened at 338 | D-45 |
| Opened at 342 | **D-46, D-47** |

**Eleven builds, not twelve** — D-33 and D-47 are one shape and close together.

The `OPEN, FIX DURING THE MIGRATION` section remains empty and the type gate
remains at zero and enforced. **The migration completed at build 338**, so the
standing rule that placed all twelve on the after list no longer defers any of
them.

---

## 4 · WHAT PHASE 0 DID NOT DO

**No code was changed.** This phase read source and wrote documents. The only
executable it produced is `tools/phase-0-diagnose.cjs`, which reads a backup
export and writes nothing — it exists because three of the seven questions ask
about records already on file, and the source cannot answer those.

**Nothing was verified in a browser**, and both new defects are marked `scope`
rather than `exec` for that reason. D-47's sweep and D-46's figures were
established by reading each value to its source, which is enough to open an entry
and not enough to close one. The builds that fix them drive them.
