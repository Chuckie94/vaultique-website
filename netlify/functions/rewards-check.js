/* =====================================================================
   Vaultique Boutique Point — /api/rewards-check
   ---------------------------------------------------------------------
   Says which way the website's rewards read the platform: through the
   platform's rewards door (its build 469), or the old way with the
   secret key. Open it after setting POS_REWARDS_KEY in Netlify:

     "source": "door"   the rewards read through the door. Once it says so,
                        POS_SUPABASE_KEY can be deleted from Netlify.
     "source": "row"    still the old way; "why" says what is missing.
     "source": "none"   neither: the rewards cannot be read until the door
                        is set up.

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
