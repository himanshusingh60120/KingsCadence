/**
 * ANGLE ROTATION
 * ──────────────────────────────────────────────────────────────────────────
 * Every email in the last run opened the same way: a rival's name, then a
 * threat to the reader. Wing did X. Northrop did Y. Pentagon did Z. Every
 * subject was "[Rival]'s [move] + your [thing]". Every E1 carried the line
 * "We track your sector pricing quarterly. Three things we can see that you
 * probably cannot from inside:". Every E4 opened "I'm not chasing a reply".
 *
 * Two separate mistakes produced that:
 *
 *   1. The prompt contained literal example sentences, and models copy
 *      example sentences verbatim. Anything written as a quotable line in a
 *      prompt WILL come back word for word across every row.
 *
 *   2. Each guard I added narrowed the space a little more until only one
 *      shape survived. Twenty emails from one mould read as bulk instantly,
 *      which is the exact thing the whole rewrite was supposed to avoid.
 *
 * And there is a deeper error under both: anchoring on the RIVAL'S MOVE.
 * A competitor's move is a fact. What makes an email worth answering is what
 * that fact does to a DECISION THE READER OWNS. "Northrop expanded their
 * campus, this threatens you" is a fact plus a guess. "If Patriot production
 * triples, every supplier in the qualification queue gets re-scoped, and the
 * seeker packages and perimeter systems are different procurement tracks" is
 * a structural read of their world.
 *
 * So: five entry angles, assigned deterministically per prospect. Stable for
 * a given person (a re-run produces the same angle) but spread across a
 * list, so no two consecutive rows share a shape.
 */

export const ANGLES = [
  {
    key: "DECISION",
    name: "the decision under pressure",
    open:
      "Open on a DECISION THIS READER OWNS that just got harder, and name the decision explicitly. Not a competitor, not a headline: the choice on their desk. What changed is the second sentence, not the first. " +
      "Shape of the thinking: a call they make on a cycle (what to price, what to bid, what to renew, where to put capacity) now has a variable in it that was not there last quarter."
  },
  {
    key: "STRUCTURAL",
    name: "how the market actually works",
    open:
      "Open on a STRUCTURAL FACT about how their market works that they may not have connected to their own position. A mechanism, a sequence, a dependency: how budgets get released, how qualification queues re-scope, how renewal timing clusters, how a rule change propagates to their buyers two steps later. " +
      "This is the angle that most demonstrates you understand their world rather than their news."
  },
  {
    key: "BUYER",
    name: "the buyer side",
    open:
      "Open on THEIR CUSTOMERS, not their competitors. What is changing in what their buyers need, budget, or are being told to prioritise. The reader watches rivals constantly and their buyers' internal shifts far less, so this is often the largest blind spot. " +
      "Name the buyer type specifically."
  },
  {
    key: "RIVAL",
    name: "a competitor move",
    open:
      "Open on a NAMED COMPETITOR'S MOVE, but the move is only the setup. The substance is the non-obvious consequence: what does NOT transfer, what a second-order effect will be, what the obvious reading gets wrong. " +
      "If all you can say is \"they did this, it threatens you\", you have not earned the email."
  },
  {
    key: "REGULATORY",
    name: "a rule and its second order",
    open:
      "Open on a REGULATORY OR COMPLIANCE CHANGE and follow it one step past the obvious. Everyone in the market reads the rule; almost nobody has worked out what it does to procurement timing, to who qualifies, to what a buyer must now document, or to which segment absorbs the cost. " +
      "Give them that second step."
  }
];

/** Stable string hash. Same person always lands on the same angle. */
function hash(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Pick the entry angle for this prospect.
 *
 * Availability constrains the choice: RIVAL needs a competitor event,
 * REGULATORY needs a regulatory one. Everything else can be written from the
 * thesis alone, which is what lets a row with no news still say something
 * worth reading instead of falling back to a mirror.
 */
export function chooseAngle(lead = {}, events = [], thesis = null) {
  const has = (subj, typeRe) =>
    (events || []).some((e) =>
      (subj ? e.subject === subj : true) && (typeRe ? typeRe.test(`${e.type || ""} ${e.what || ""}`) : true)
    );

  const available = ANGLES.filter((a) => {
    if (a.key === "RIVAL") return has("competitor");
    if (a.key === "REGULATORY") return has(null, /regulat|complian|rule|law|licen|ban|tariff|mandate|FAA|FDA|EPA|SEC\b/i);
    if (a.key === "DECISION") return !!(thesis && thesis.decisions && thesis.decisions.length);
    if (a.key === "BUYER") return !!(thesis && thesis.whoPaysThem);
    return true; // STRUCTURAL always works: it is a read, not a headline
  });

  const pool = available.length ? available : [ANGLES[1]]; // STRUCTURAL fallback
  const seed = hash(`${lead.email || ""}|${lead.companyName || ""}`);
  return pool[seed % pool.length];
}

/**
 * Rotate the closing shape too. Every E4 opened with the same release line
 * last run, because the prompt gave one example and the model reused it.
 * These are DESCRIPTIONS of a move, never quotable sentences, so the model
 * has to write the line itself.
 */
export const CLOSING_MOVES = [
  "release them without naming the fact that they did not reply: acknowledge the timing is theirs, not yours",
  "hand over what you have with no framing at all, as if forwarding something useful to a colleague",
  "note that the situation will look different in a quarter and leave the door on that hinge",
  "state plainly that this was the last of these, without reproach and without a hook",
  "close on the work rather than on them: what you will keep watching, whether or not they answer"
];

export function chooseClosing(lead = {}) {
  return CLOSING_MOVES[hash(`close|${lead.email || ""}`) % CLOSING_MOVES.length];
}

/**
 * Subject shapes. One fixed shape produced twenty identical subject lines,
 * which is its own deliverability problem as well as a credibility one.
 */
export const SUBJECT_SHAPES = [
  "name the decision or the cost, not the event: what is now in question for them",
  "state the mechanism in plain words, as an analyst would in a note to a colleague",
  "lead with the number, then the thing it is about",
  "name the outside actor and the specific thing of theirs it touches",
  "pose the question the event raises, in the reader's own vocabulary",
  "name the segment and what just moved in it"
];

export function chooseSubjectShape(lead = {}) {
  return SUBJECT_SHAPES[hash(`subj|${lead.email || ""}|${lead.companyName || ""}`) % SUBJECT_SHAPES.length];
}
