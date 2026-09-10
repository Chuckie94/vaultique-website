#!/usr/bin/env node
/* PHASE 0 DIAGNOSTIC · build 342
 *
 * Reads a backup export and reports how big the record questions in
 * PHASE-0-DECISIONS-342.md actually are. Three of the seven questions ask what
 * to do about records already on file, and none of them can be answered from
 * the source — only from your data.
 *
 * IT READS. IT DOES NOT WRITE. There is no code path in this file that opens a
 * file for writing, and it never touches the platform, Supabase, Netlify or AWS.
 * Run it against a downloaded backup, not against anything live.
 *
 *   node tools/phase-0-diagnose.cjs <backup.json>
 *
 * The backup is the JSON the platform's own Backup & Restore produces: one
 * object with the named collections on it (see BK_TABLES, settings.js:5778).
 */

"use strict";

const fs = require("fs");

const ARG = process.argv[2];
if (!ARG) {
  console.error("usage: node tools/phase-0-diagnose.cjs <backup.json>");
  console.error("       the JSON your platform's Backup & Restore produces.");
  process.exit(2);
}

let DB;
try {
  const raw = fs.readFileSync(ARG, "utf8");
  DB = JSON.parse(raw);
} catch (e) {
  console.error("Could not read " + ARG + ": " + e.message);
  process.exit(2);
}

/* A backup may wrap the collections one level down. Accept both shapes rather
   than making the reader find out by getting zeros everywhere. */
if (DB && !Array.isArray(DB.customers) && DB.data && typeof DB.data === "object") DB = DB.data;
if (DB && !Array.isArray(DB.customers) && DB.db && typeof DB.db === "object") DB = DB.db;

const arr = k => (Array.isArray(DB[k]) ? DB[k] : []);
const pad = (s, n) => String(s).padEnd(n);
const rule = () => console.log("-".repeat(66));

function head(t) {
  console.log("\n" + t);
  rule();
}

let flagged = 0;

/* ------------------------------------------------------------------ */
/* Q3 · D-33 and D-47 · references that sit in a gap                   */
/* ------------------------------------------------------------------ */
/* Both screens take two numbers from one sequence for one record, so the
   reference gets an odd number and the id gets the next one. The tell is not
   "the sequence has gaps" — a deleted record leaves a gap too. The tell is that
   the record's OWN id is one higher than the number in its OWN reference. */

function refSkew(rows, refField, label) {
  let checked = 0, skewed = 0;
  const sample = [];
  rows.forEach(r => {
    const ref = r && r[refField];
    const id = r && r.id;
    if (typeof ref !== "string" || id == null) return;
    const m = ref.match(/(\d+)\s*$/);
    if (!m) return;
    checked++;
    const refNo = parseInt(m[1], 10);
    const idNo = parseInt(id, 10);
    if (!isFinite(refNo) || !isFinite(idNo)) return;
    if (idNo === refNo + 1) {
      skewed++;
      if (sample.length < 5) sample.push(ref + "  (id " + id + ")");
    }
  });
  console.log(pad(label, 26) + pad(rows.length + " on file", 16) +
              skewed + " of " + checked + " took two numbers");
  if (sample.length) sample.forEach(s => console.log("    " + s));
  if (skewed) flagged++;
  return skewed;
}

head("Q3 · reference numbers that consumed two numbers  [D-33, D-47]");
const srSkew = refSkew(arr("supplierReturns"), "ref", "Supplier returns (SR-)");
const coSkew = refSkew(arr("customOrders"), "ref", "Custom orders (CO-)");
if (!srSkew && !coSkew) {
  console.log("\n  Nothing on file shows the skew. Either these screens have not");
  console.log("  been used, or this backup predates them.");
} else {
  console.log("\n  Each of these has a reference one lower than its own id, which");
  console.log("  is the signature of the defect rather than of a deleted record.");
  console.log("  This is the number Q3 is asking you to leave alone or renumber.");
}

/* ------------------------------------------------------------------ */
/* Q4 · D-37 · performance reviews whose completion date looks re-stamped */
/* ------------------------------------------------------------------ */
/* updatedAt cannot separate a genuine same-day completion from a re-stamp,
   because it is written on every save. The usable tell is the review's own
   period against the date it claims to have been completed: a review FOR 2025
   completed in 2026 is a candidate. Candidates, not findings — a late appraisal
   is a real thing and looks identical. */

head("Q4 · performance reviews whose completion date looks re-stamped  [D-37]");
const reviews = arr("hrReviews");
const candidates = [];
reviews.forEach(r => {
  if (!r || r.status !== "Completed") return;
  const done = String(r.completedOn || "");
  const m = done.match(/^(\d{4})-/);
  if (!m) return;
  const doneYear = parseInt(m[1], 10);
  const period = String(r.period || "");
  const py = period.match(/(20\d{2})/);
  if (!py) return;
  const periodYear = parseInt(py[1], 10);
  if (doneYear > periodYear) {
    candidates.push({
      ref: r.ref || ("review " + r.id),
      period: period,
      completedOn: done,
      updatedAt: String(r.updatedAt || "").slice(0, 10)
    });
  }
});
console.log(pad("Completed reviews", 30) + reviews.filter(r => r && r.status === "Completed").length);
console.log(pad("Completed after their period", 30) + candidates.length + "  (candidates, not findings)");
if (candidates.length) {
  flagged++;
  console.log("");
  console.log("  " + pad("reference", 20) + pad("period", 14) + pad("says completed", 16) + "last saved");
  candidates.slice(0, 25).forEach(c => {
    console.log("  " + pad(c.ref, 20) + pad(c.period, 14) + pad(c.completedOn, 16) + c.updatedAt);
  });
  if (candidates.length > 25) console.log("  … and " + (candidates.length - 25) + " more");
  console.log("");
  console.log("  A late appraisal looks exactly like a re-stamped one. This list is");
  console.log("  for a person in HR to walk, which is what Q4 option (b) costs.");
}

/* ------------------------------------------------------------------ */
/* Q1 · D-30 · activities stranded on converted leads                  */
/* ------------------------------------------------------------------ */

head("Q1 · follow-ups that vanished when a lead became a customer  [D-30]");
const leads = arr("crmLeads");
const acts = arr("crmActivities");
const convertedLeadIds = {};
let converted = 0;
leads.forEach(l => {
  if (!l) return;
  if (l.convertedCustomerId != null && l.convertedCustomerId !== "") {
    convertedLeadIds[String(l.id)] = String(l.convertedCustomerId);
    converted++;
  }
});
let stranded = 0;
acts.forEach(a => {
  if (!a) return;
  const lid = a.leadId == null ? "" : String(a.leadId);
  const cid = a.customerId == null ? "" : String(a.customerId);
  if (lid && !cid && convertedLeadIds[lid]) stranded++;
});
console.log(pad("Leads converted", 26) + converted);
console.log(pad("Activities stranded", 26) + stranded);
if (stranded) {
  flagged++;
  console.log("\n  " + stranded + " follow-up(s) are missing from the profile of a customer who");
  console.log("  is on your books today. Option (b) makes all of them reappear with");
  console.log("  no data change; option (a) rewrites them.");
} else if (converted) {
  console.log("\n  Leads have been converted but none carried a logged activity, so");
  console.log("  nothing is hidden today. The defect is still live for the next one.");
}

/* ------------------------------------------------------------------ */
/* D-35 · document types that differ only by spelling                  */
/* ------------------------------------------------------------------ */

head("Phase 1 sizing · document types that differ only by case  [D-35]");
const docs = arr("hrDocuments");
const byLower = {};
docs.forEach(d => {
  if (!d) return;
  const t = d.type || "Other";
  const k = String(t).trim().toLowerCase();
  (byLower[k] = byLower[k] || {})[t] = (byLower[k][t] || 0) + 1;
});
const split = Object.keys(byLower).filter(k => Object.keys(byLower[k]).length > 1);
console.log(pad("Documents on file", 26) + docs.length);
console.log(pad("Types split by spelling", 26) + split.length);
split.forEach(k => {
  flagged++;
  console.log("    " + Object.keys(byLower[k]).map(s => '"' + s + '" ×' + byLower[k][s]).join("   "));
});
if (!split.length) console.log("\n  Every type is spelled one way. D-35 is a guard, not a repair.");

/* ------------------------------------------------------------------ */
/* Q-01 · does any real backup carry the old hrPayroll spelling?       */
/* ------------------------------------------------------------------ */

head("Q-01 · the hrPayroll carry-over, which only your data can answer");
const hasOld = DB.hrPayroll !== undefined;
const hasNew = DB.payrollData !== undefined;
console.log(pad("hrPayroll present", 26) + (hasOld ? "YES" : "no"));
console.log(pad("payrollData present", 26) + (hasNew ? "yes" : "NO"));
if (hasOld) {
  flagged++;
  console.log("\n  This backup carries the OLD spelling. The migration in");
  console.log("  _hrMigrateFromPayroll() is guarded and never runs, so those working");
  console.log("  hours, overtime multipliers and public holidays were silently lost.");
  console.log("  Q-01 is answered: the function is not dead and the settings need");
  console.log("  recovering from this file.");
} else {
  console.log("\n  No old spelling here. If every backup you hold says the same, the");
  console.log("  function is dead and Q-01 closes by deleting it.");
}

/* ------------------------------------------------------------------ */
/* The two phantom collections the register carries below the line     */
/* ------------------------------------------------------------------ */

head("Recorded, below the threshold · the two names nothing writes");
["leaveRequests", "writeOffs"].forEach(k => {
  const n = Array.isArray(DB[k]) ? DB[k].length : (DB[k] === undefined ? -1 : 0);
  console.log(pad(k, 30) + (n < 0 ? "not present" : n + " record(s)"));
});
console.log(pad("leaveRecords (the real one)", 30) + arr("leaveRecords").length + " record(s)");

/* ------------------------------------------------------------------ */

console.log("");
rule();
if (flagged) {
  console.log(flagged + " item(s) above have something on file to decide about.");
} else {
  console.log("Nothing on file needs a decision. Answer Q3 and Q4 (a) and move on.");
}
console.log("Nothing was written. This file only reads.");
rule();
