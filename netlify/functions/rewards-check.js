/* =====================================================================
   Vaultique Boutique Point — /api/rewards-check
   ---------------------------------------------------------------------
   Says whether the website's rewards can read the platform, through the
   platform's rewards door (its build 469). Since build 77 there is no
   other way: the old one, with the platform's secret key, is gone.

     "source": "door"   the rewards read through the door.
     "source": "none"   they cannot be read until the door is set up;
                        "why" and "next" say what is missing.

   Needs no sign-in, and says nothing about any customer: it asks the door
   with a number nobody could have, which the door answers without reading
   anything or counting it against its hourly allowance.
   ===================================================================== */
'use strict';
const P = require('./_pay');
const R = require('./_rewards');

exports.handler = async function (event) {
  if (event && event.httpMethod && event.httpMethod !== 'GET') return P.json(405, { error: 'GET only' });
  let out;
  try { out = await R.doorCheck(); }
  catch (e) { out = { source: 'none', why: 'the check could not run' }; }
  return P.json(200, out);
};
