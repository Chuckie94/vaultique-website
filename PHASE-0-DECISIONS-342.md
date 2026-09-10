# PHASE 0 · THE DECISION SHEET · BUILD 342

**Platform:** Vaultique Business Platform
**Written against:** build 341
**Plan reference:** `DEFECT-FIX-PLAN-342.md`, Phase 0
**Defects:** **D-46 and D-47 opened.** None closed — this phase writes no code.

---

## IN PLAIN ENGLISH, FIRST

This is the sheet that unblocks the other four phases. **Seven questions, each
with a recommendation you can disagree with.**

Reading the code to write the questions properly turned up more than the
questions. **Two new defects**, one of them the exact twin of a defect already on
the list, sitting on a screen nobody had checked. **Four corrections** to what
the register says. And **one of the seven questions had the wrong answer in the
plan** — the one I was most confident about.

That last one is worth saying plainly: the plan recommended deleting HR's
Analytics screen on the grounds that wiring it was "ten reports of new work."
**It is two lines.** The register's own description of that defect is wrong, and
I took it at face value when I wrote the plan.

---

## WHAT THIS PASS FOUND BEFORE THE QUESTIONS

### Two new defects

**D-47 · custom order references skip every other number.** This is **D-33's
exact twin**, on a different screen, and it was found by the sweep the plan
scheduled for build 346 — run early, because a question about renumbering
references cannot be answered without knowing how many screens do it.

```js
js/modules/sales/orders.js
220:  const ref = "CO-"+new Date().getFullYear()+"-"+String(nextId("corder")).padStart(4,"0");
222:  DB.customOrders.push(Object.assign({ id:nextId("corder"), ref, … }, data));
```

One custom order, two numbers from the `corder` sequence. Your custom order
references run **CO-2026-0001, CO-2026-0003, CO-2026-0005.**

**It matters more than D-33 does.** A supplier return reference is quoted to a
supplier. **A custom order reference is quoted to a customer** — it is what
somebody reads back at the counter when they come to collect. Q3 now covers both.

The sweep read every `nextId()` call in `js/` and found five sites where the same
sequence is drawn from twice within twenty-five lines. **Three are correct** and
were checked rather than assumed: `p2s.js` writes two different journal entries,
and `returns.js` and `till.js` each write two different payments. Two are one
record taking two numbers, and those two are D-33 and D-47.

**D-46 · leave and loans mix branch figures and company figures in one row of
cards.** Found while checking D-34's reach.

D-34 says five registers show branch-scoped figures with no label. That is
correct, and all five were verified. But `_hrRecScopeByEmp()` — the helper D-34
is described in terms of — has **eight** consumers, not five. The other three
belong to leave and loans, and those two screens have a different and worse
problem:

**Leave overview** (`js/modules/hr.js:7134`):

| Card | Counts |
|---|---|
| On leave today | **this branch** — `_hrScopeByBranch(_lvEmployees())` |
| Awaiting approval | **the whole business** — raw `_lvRecords()` |
| Leave days this year | **the whole business** — raw `_lvRecords()` |
| Leave liability | **this branch** |

**Loans overview** (`js/modules/hr.js:8290`):

| Card | Counts |
|---|---|
| Outstanding book | **the whole business** — raw `_lnLoans()` |
| Active loans | **the whole business** |
| Awaiting approval | **the whole business** |
| Due this month | **this branch** — `_hrScopeByBranch(_lnEmps())` |

**This is not D-34 and no label can fix it.** D-34 is four right numbers missing
a caption. Here two cards in the same row of four answer questions about
different populations, and a caption over the row would be false about half of
it. The warning banners underneath — leave conflicts, loan arrears — are
company-wide in both, sitting under cards that are half branch-scoped.

It is a **separate decision from Q5** and a separate build, because unlike D-34
**fixing it changes numbers on screen.**

### Four corrections to the register

**1 · D-43 is not sixteen reports and a painter for six.** `HR_REPORTS`, the tab
strip `_hrAnalytics()` draws, has **six** entries: Employee Directory, Headcount,
Attendance, Overtime, Leave Balances, Leave History. **All six have specs in
`HR_REPORT_SPECS`**, so all six already draw through `reports/table` — the same
panel the Reports module uses, from the same specs (`reports.js:2176` calls
`HR.hrReportSpec(key)`).

The "sixteen" comes from a different set. `HR_REPORT_SPECS` holds **seventeen**
keys serving the Reports module — thirteen real reports and four
`_hrAnPending()` placeholders. The register conflated the Analytics tab strip
with the Reports catalogue. **Wiring the tab is one `HR_AREAS` entry and one
branch in `_paintHR()`.** Q7 is rewritten below because of this.

**2 · `_hrAnPaint()` carries four lines of dead code.** After the spec check,
four fallbacks remain:

```js
if(_hrAnRep==="attendance") return void (el.innerHTML=_hrAnAttendance(emps));
if(_hrAnRep==="overtime")   return void (el.innerHTML=_hrAnOvertime(emps));
if(_hrAnRep==="leavebal")   return void (el.innerHTML=_hrAnLeaveBalances(emps));
if(_hrAnRep==="leavehist")  return void (el.innerHTML=_hrAnLeaveHistory(emps));
```

All four keys are in `HR_REPORT_SPECS`, so `spec` is always truthy and the
function returns before reaching any of them. They go with whichever way Q7 is
decided.

**3 · D-34's training register is `_trnRecords()`**, at `js/modules/hr.js:10262`
with its cards at `:10270`. The plan said `_trnRender`. The other four sites in
the plan are right.

**4 · `apply()` builds `rec.lines` twice.** `js/modules/inventory/stocktake.js`
builds the line array at `:208`, then throws it away and rebuilds it at `:212`
with the pre-adjustment figures. The comment above the second says why the
second exists; nothing says why the first is still there. Dead work, not a
defect, and it should go with the D-32 fix rather than on its own.

### And the count

**Twelve open now**, not the nine the register's heading claims or the ten the
plan corrected it to: the original ten, plus D-46 and D-47.

---

## THE SEVEN QUESTIONS

Answer in the right-hand column and send the sheet back. Nothing here needs to
be answered in order, and nothing needs a meeting.

---

### Q1 · D-30 · a prospect's follow-ups vanish when they become a customer

**What happens.** Log a call against a lead, convert the lead, open the
customer's profile. The call is not on the timeline and nothing says it ever
happened.

**What I found that changes the question.** `_timeline()` **already** follows
`convertedCustomerId` — it does exactly that lookup at `crm.js:549` to draw the
"Converted from lead" event on the timeline:

```js
_leads().filter(l=>String(l.convertedCustomerId)===String(cid)).forEach(l=>{ … });
```

So option (b) is not "add a lookup." It is **reuse the lookup that is already
three lines further up.** Roughly three lines, and no new machinery.

| | |
|---|---|
| **(a)** | Re-point the activities at conversion — `customerId = cid`, clear `leadId`. One line. **Rewrites records that were true when they were written**: the call really was made to a lead. |
| **(b)** | Collect the lead ids `_timeline()` already finds, and pull their activities too. The follow-up appears on the profile **still labelled lead-stage work**, which is what it was. |

> **Recommended: (b).** It was the better answer before; it is now also the
> cheaper one.

**Your answer:** ☐ (a)  ☐ (b)  ☐ something else: ______________________

---

### Q2 · D-32 · what should an uncounted line say on a signed stock take?

**What happens.** Count three products out of four. The saved stock take holds
**four lines**. The one nobody counted is written as system 6, physical 6,
variance 0 — which on the printed sheet, the one that gets signed and filed,
reads *"we counted it and it agreed."*

The same sheet then contradicts itself. The footer at `stocktake.js:259` counts
`lines.length` and prints **"Items counted: 4"**; the record itself carries
`items: 3`, counted from the products that actually got a number.

| | |
|---|---|
| **(a)** | File no line at all for a product nobody counted. |
| **(b)** | File the line marked uncounted, and print it blank rather than as a match. |

> **Recommended: (b).** A sheet that silently omits a product cannot be told
> apart from a sheet where the product was not on the shelf. Marked-and-blank
> says what actually happened, and a second count reading back the first one's
> sheet can then tell which lines were walked.

**Either way**, the footer must count the same thing `items:` counts. They
disagree today under both readings.

**Also in this build:** the same function builds the line array twice (`:208`,
then `:212`). The first is dead. It goes with this fix.

**Your answer:** ☐ (a)  ☐ (b)  ☐ something else: ______________________

---

### Q3 · D-33 **and D-47** · reference numbers that skip every other number

**Now two screens, not one.** Supplier returns (`SR-`) and custom orders
(`CO-`). Both take two numbers from one sequence for one record. The code fix is
settled and identical for both — take one number, use it for both the id and the
reference, which is what Goods Received already does and what build 295 wrote
down as the rule.

**The question is only the references already on file.**

| | |
|---|---|
| **(a)** | Leave them. New references run contiguous from the day of the fix; the existing gaps stay. |
| **(b)** | Renumber historically. |

> **Recommended: (a).** A reference is what you quoted somebody. Renumbering
> changes a number a supplier has in a file, or a customer has on a slip.
> Record why the gaps exist so the next person does not go looking for deleted
> records.

**Run `tools/phase-0-diagnose.cjs` before answering** — it reports how many
references on each screen actually sit in a gap. If the answer is "eleven", (a)
is obvious. If it is "eleven hundred", you may want a note printed on the
documents themselves, which is a third option.

**Your answer:** ☐ (a)  ☐ (b)  ☐ something else: ______________________

---

### Q4 · D-37 · the performance reviews already carrying today's date

**What happens.** Open a review completed months ago, change one word, save —
and the record says it was completed today. `My Account` shows the staff member
their own 2025 appraisal dated wrong, and a corrected old review jumps above
reviews that genuinely came after it.

The code fix is one line: set `completedOn` only when the review does not
already carry one.

**On finding the damaged records — checked, and it cannot be done reliably.**
`updatedAt` is written on every save, so it cannot separate a genuine same-day
completion from a re-stamp. The best available tell is the `period` field
against `completedOn`: a review **for period "2025 H1" completed in 2026** is a
strong candidate. That is a candidate list for a human to judge, not a script
that can repair anything.

| | |
|---|---|
| **(a)** | Leave them; correct on request. |
| **(b)** | Produce the candidate list and have HR walk it. |

> **Recommended: (a)**, and tell HR — because the employees see these dates and
> will be the ones who notice. `tools/phase-0-diagnose.cjs` prints the candidate
> list either way, so you can size (b) before choosing it.

**Your answer:** ☐ (a)  ☐ (b)  ☐ something else: ______________________

---

### Q5 · D-34 · the label, on five registers

**The five are confirmed**, each checked rather than taken from the register:
Documents `_docRegister` (`hr.js:9247`), Discipline `_disOpen` (`:9474`), Assets
`_astOut` (`:9703`), Performance `_perfRevView` (`:10006`), Training
`_trnRecords` (`:10270`). In every one, all four cards derive from the same
scoped list — **the arithmetic is right and only the caption is missing.**

The platform already has the wording, at `js/modules/inventory/movements.js:327`:

> *"Showing Livingstone only. Switch to All branches to see every shop."*

> **Recommended:** use that shape on all five. It is the wording that is your
> call, not whether to label them. This build changes no number on any screen,
> which is why five registers can share one build.

**Your answer:** ☐ use the movements wording  ☐ different wording: ____________

---

### Q5b · D-46 · leave and loans · **a new question, and it is not Q5**

Covered in full above. Two cards in one row of four count the branch; the other
two count the business. **A caption cannot fix this** — it would be false about
half the row.

| | |
|---|---|
| **(a)** | Make every card branch-scoped, then label the row per Q5. Consistent with the other five registers. **Changes what four numbers say.** |
| **(b)** | Make every card company-wide and label it as such. **Changes what four numbers say**, the other way. |
| **(c)** | Leave the mix and label each card individually. Honest, and ugly. |

> **Recommended: (a).** It makes leave and loans behave like the five registers
> beside them, and a branch manager looking at a leave screen in their branch
> expects their branch. But it moves figures a manager may have been reading for
> a year, so it is genuinely yours.

**This needs its own build** and it must not be folded into Q5's, because Q5's
warrant is that no number moves.

**Your answer:** ☐ (a)  ☐ (b)  ☐ (c)  ☐ something else: ______________________

---

### Q6 · D-42 · the two `_uOverrides`

`js/modules/users.js` declares it at `:508` and again at `:612`. The later wins.

**Reading both, they are not duplicates — they do different jobs.**

| | |
|---|---|
| `:508` **(unreachable)** | An **exceptions report**: everyone whose access differs from their role, with what was granted and what was revoked. *"Nobody listed here means everybody is following their role exactly, which is the healthy state."* |
| `:612` **(wins)** | A **per-user editor**: pick a user, tick thirteen module boxes, writes `permGrant` / `permRevoke`. |

**And there is a third screen.** `js/modules/settings.js:1260` already carries a
per-user override editor — "One user, one exception" — writing the same two
fields on the same user record (`:1318–1327`).

**The platform makes three statements about this and they do not agree:**

1. `_uRoles()`, users.js: *"edited in one place only: Settings."*
2. The read-only `_uOverrides`: *"ticked in Settings … under 'One user, one exception'."*
3. Settings' own note at `:1269`: *"This is the same matrix the Users module shows, reading and writing the same records. Change it in either place and the other agrees, because there is only one of it."*

**Statement 3 describes the editable one and endorses it.** And it is factually
right where the fear in statement 1 is not: both screens write the same two
arrays on the same record, so they cannot drift apart. The data model already
makes them one thing.

| | |
|---|---|
| **(a)** | The read-only one is the design. Delete the editor from Users; Settings keeps it. |
| **(b)** | The editable one is the design. Delete the read-only report; correct statement 2. |
| **(c)** | **Keep both and rename them.** They answer different questions — *"who is an exception?"* and *"make this person an exception."* The defect is the name collision, not the second function. |

> **Recommended: (c).** The exceptions report is the only place in the platform
> that answers "who currently has non-standard access", which is the question an
> audit asks. Deleting it to resolve a name collision loses a capability nothing
> else provides. Rename the report `_uOverridesReport()`, leave the editor as it
> is, and statement 3 becomes true of all three screens.
>
> If you would rather have one screen than three, **(a)** is the coherent
> version of that — but it deletes the audit view too, so say so knowingly.

**Your answer:** ☐ (a)  ☐ (b)  ☐ (c)  ☐ something else: ______________________

---

### Q7 · D-43 · HR's Analytics screen · **the plan's recommendation was wrong**

The plan said delete it, on the register's description: *"a tab strip of sixteen
reports and a painter for six"*, which made wiring it ten reports of new work.

**That description is wrong.** The tab strip is **six** reports, and **all six
already draw through the same panel Reports uses**, from the same specs. Nothing
is missing a painter. Wiring the tab is:

- one entry in `HR_AREAS`
- one `if(a.key==="analytics")` branch in `_paintHR()`, alongside the ones
  already there for `recruitment` and `employees`

**Two lines, and the reports are already built.**

So the question is no longer about cost. It is the product question underneath:

| | |
|---|---|
| **(a)** | **Wire it.** HR gets an Analytics tab showing six reports — Directory, Headcount, Attendance, Overtime, Leave Balances, Leave History — drawn by the same panel, from the same specs, as the Reports module already draws them. Two lines. |
| **(b)** | **Delete it.** Reports is where reports live; HR does not need a second door. `_hrAnalytics()`, `_hrAnPaint()`, `_hrAnRepLabel()`, `_hrAnMountSpec()`, `HR_REPORTS` and the four dead fallbacks all go. |

> **No recommendation, and this time that is the honest answer.** Both are
> cheap, neither is risky, and the deciding factor is whether an HR manager
> should be able to see headcount and leave balances without leaving HR. That is
> a question about how your people work, not about the code.
>
> What I will say: the reason the plan gave for deleting it — that wiring was
> expensive — **does not exist.** If that reason is what made deletion
> attractive, reconsider.

**Your answer:** ☐ (a) wire it  ☐ (b) delete it  ☐ something else: ___________

---

### Also worth deciding in the same pass

Not defects. Same kind of ask, and batching them saves a round trip.

| | | |
|---|---|---|
| **Q-04** | Recent Sales shows today's sales oldest-first | one line · ☐ fix ☐ leave |
| **Q-05** | The tallest bar on the trend charts renders 4% short | a few pixels, two screens · ☐ fix ☐ leave |

**Q-01** (`hrPayroll`) cannot be answered without production data — the
diagnostic reports whether your backup carries the old spelling, which answers
it. **Q-02** is tooling. **Q-03** is a recorded measurement, not an action.

---

## WHAT THIS CHANGES IN THE PLAN

| | |
|---|---|
| **Phase 1** unchanged | D-45, D-35, D-31 still need nothing from you and can start now. |
| **Phase 2** gains a screen | D-33's build now fixes D-47 with it — one shape, two sites, one build. |
| **Phase 3** gains a build | D-34's five registers, then D-46's two as its own build, because D-46 moves numbers and D-34 does not. |
| **Phase 4** unchanged in shape | Q6 and Q7 both have more options than the plan offered; neither is now expensive. |

**Twelve defects, eleven builds** — D-33 and D-47 share one.

**Nothing in this phase touches Supabase, Netlify or AWS.** Nothing was changed:
this phase read code and wrote documents.

---

## HOW TO SEND IT BACK

Tick the boxes above and return this file, or reply with just the answers:

```
Q1 (b)   Q2 (b)   Q3 (a)   Q4 (a)   Q5 movements wording
Q5b (a)  Q6 (c)   Q7 (?)   Q-04 fix   Q-05 leave
```

**Q7 is the only one with no recommendation.** The other six can be accepted as
recommended by saying so, and Phase 1 does not wait for any of them.
