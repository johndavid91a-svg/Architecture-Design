# ADR-0002: Ship an empty price book

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** repository maintainers

## Context

The product's requirements state plainly that it must never fabricate a price:
if a current price cannot be found, the application must say so rather than
invent one.

Published Pakistani material rates for mid-2026 were readily available while
building this: cement around PKR 1,430–1,550 per 50 kg bag, steel around PKR
235–320 per kg depending on the source, bricks around PKR 14,000–18,000 per
thousand. Seeding them would have made the first run of the application look
substantially more complete.

Three facts argued against it. Those sources disagree with each other by roughly
30% on steel. They are market blogs of undocumented methodology, not primary
sources. And they are tied to a fuel-price environment that shifted sharply
during 2026 — the same research found petrol rising more than 40% in a single
revision.

There is also a hard practical constraint: the development environment's network
policy blocks outbound access to every configured source — PBS, CDA, RDA, FBR,
Zameen, Brick Pakistan and Alibaba all return a proxy denial. No connector could
be written or verified, so any price appearing in the repository would
necessarily have been transcribed from a search result rather than fetched.

## Decision

The application ships with no prices. The price book starts empty.

Prices enter only through an attributed path: a supplier quotation the user
records (Level 3), a connector fetching a configured source on the user's own
machine and recording the URL and timestamp (Level 1 or 2), or a manual estimate
the user enters knowingly (Level 4, permanently LOW confidence).

Until then, the estimate reports the gap and labels its total *at least*.

## Options considered

### Option A — Empty price book (chosen)

Correct by construction and impossible to misread. The cost is a first run that
shows no numbers, which looks unfinished to anyone who has not read why.

### Option B — Seed with attributed market observations, marked LOW confidence

Tempting, and defensible on the surface: the figures would carry a source URL, a
retrieval date and a low-confidence badge, which is what the pricing model asks
for.

Rejected because a badge is not read in the same moment a total is. A rate
scraped from a blog and shipped in an installer carries no retrieval a user can
weigh — it simply appears inside a figure they might quote against. Six months
after release it is a fabricated price whether or not anyone invented the digits.

### Option C — Seed and refresh on first run

Rejected: it makes correctness conditional on network access at an arbitrary
moment, and it fails silently into option B whenever the fetch does not happen.

## Consequences

The application is honest at the moment of highest risk — when someone is about
to act on a number. `EstimateResult.complete` and the *at least* labelling make
an incomplete estimate visibly incomplete, and `PriceLookup` has no numeric
field on its unavailable branch, so a gap cannot be silently coerced to zero.

The costs are real. The first run demonstrates no costing without user input,
which weakens a demo. Every evaluator must record at least one quotation before
seeing the estimation engine work. And the burden of sourcing prices sits with
the user until the connectors exist.

Those costs are accepted. The alternative is a tool whose most confident-looking
output is its least trustworthy.

## References

- `packages/core/src/pricing/price.ts` — the `PriceLookup` union
- `packages/desktop/src/renderer/src/state/price-book.ts`
- [PRICING_ENGINE.md](../PRICING_ENGINE.md)
