# Pricing engine

## The rule

> If the application cannot find a current price, it does not invent one.

Everything below is machinery for keeping that true under pressure — because the
pressure is real. A tool that shows a total looks finished; a tool that shows
"12 lines unpriced" looks broken. The second one is correct.

## Why the price book ships empty

The application contains no prices at all. That is a decision, not an unfinished
feature.

During this project's research, published Pakistani material rates for mid-2026
were readily available: cement around PKR 1,430–1,550 per 50 kg bag, steel
around PKR 235–320 per kg depending on source, bricks around PKR 14,000–18,000
per thousand. Seeding those would have made the first run look impressive.

It would also have been the failure this rule exists to prevent. Those figures
disagree with each other by 30% on steel. They come from market blogs of
undocumented methodology. They are tied to a fuel-price environment that shifted
sharply during 2026. And once inside an installer, they carry no retrieval date
the user can weigh — they simply appear in a total the user might quote against.
A rate scraped from a blog six months ago and presented as current is a
fabricated price whether or not anyone typed a number from thin air.

So prices enter one of three ways, all attributed:

1. **A supplier quotation** the user uploads or types (Level 3)
2. **A price connector** fetching a configured source on the user's own machine,
   recording the URL and retrieval timestamp (Level 1 or 2)
3. **A manual estimate** entered knowingly, permanently reported at LOW
   confidence (Level 4)

Until one of those happens, the estimate reports the gap.

## Source hierarchy

```
LEVEL 3  Verified supplier quotation   ← highest standing for THIS project
LEVEL 1  Official (PBS, CDA, RDA, FBR)
LEVEL 2  Established market platforms
LEVEL 4  Market estimate / user guess  ← always LOW confidence
```

A supplier quotation outranks an official statistic deliberately. PBS publishes
a national average retail price; CDA publishes a schedule of rates for its own
works. Both are authoritative *as statistics*. But a quotation from a Rawalpindi
supplier, for a specific quantity, on a specific date, is what the user will
actually pay. Official sources still rank above market platforms because they
are accountable and methodologically documented.

See [`LOCAL_PRICING_SOURCES.md`](LOCAL_PRICING_SOURCES.md) for the registry.

## Every price record carries

| Field | Why |
| --- | --- |
| amount, currency, unit | The figure, and what it is per |
| sourceId, sourceTier | Which source, and how far it can be trusted |
| sourceUrl | Deep link so the user can check it themselves |
| retrievedAt | When it was fetched |
| verifiedAt | When a human last confirmed it — absent until someone does |
| location | Islamabad, Rawalpindi, ex-works Foshan |
| specification | Brand and grade. A rate without a grade cannot be compared |
| minimumQuantity | Prices conditional on volume |
| supersedesPriceId | Set when replacing an earlier record, which is kept |

Records are immutable. Refreshing appends and supersedes; it never overwrites.
That is what makes price history possible and what stops a refresh from silently
rewriting the basis of an estimate the user already approved.

## Confidence is derived, not stored

If confidence were a stored field, a stale HIGH would go on claiming to be HIGH.
Deriving it from tier plus age means it decays on its own as a project sits.

```
age > staleness window                     → LOW  (and treated as unavailable)
Level 3, human-verified                    → HIGH
Level 3, unverified                        → MEDIUM
Level 1, within half its window            → HIGH
Level 1, past half its window              → MEDIUM
Level 2                                    → MEDIUM
Level 4                                    → LOW, always
```

Staleness windows: supplier quote 30 days (quotations typically state 15–30 day
validity), official 45, market 30, estimate 14. Pakistani construction prices
have moved sharply within single months; a 90-day-old market listing is not a
current price, and presenting it as one is the quiet version of fabricating it.

## The type that enforces the rule

```ts
type PriceLookup =
  | { available: true;  record: PriceRecord; confidence: PriceConfidence; … }
  | { available: false; reason: UnavailableReason; remedy: string; staleRecords: … }
```

There is no `amount` on the unavailable branch and no default value. A caller
cannot read a price off a miss, and cannot coerce one to zero. Every consumer
must destructure on `available` and decide what to do about the gap.

`reason` maps to a different call to action:

| Reason | Remedy shown to the user |
| --- | --- |
| `no_record` | Enter a quotation, import a price list, or run a connector |
| `all_stale` | Re-verify with the supplier or refresh market prices |
| `unit_mismatch` | The price is in a unit that cannot convert to the takeoff unit |
| `no_exchange_rate` | Record a dated exchange rate with its source |
| `connector_not_run` | The configured source has not been fetched on this machine |

Stale records are returned with the miss so the user can re-verify them. They
are never used silently.

## What a gap does downstream

An unpriced line stays in the BOQ as a row marked `EXCLUDED FROM TOTAL`, with a
GAP badge carrying the remedy. It is not dropped — a bill of quantities that
quietly omits what could not be priced misrepresents the project precisely where
it matters most.

The estimate then reports:

- `complete: false`
- `completeness` as a fraction of lines priced
- a caveat reading *"Incomplete: N of M lines are unpriced and excluded. The true
  cost is higher than the figure shown."*
- the total labelled **at least** rather than **total**

Labour is handled the same way. Worker-days are known from the model whether or
not a wage rate is on file, so an unpriced trade still reports its effort — only
the money is missing.

## Exchange rates

Every conversion records the rate, its source and its retrieval date. A landed
cost cannot be computed at all without a dated rate on file; the calculation
returns `no_exchange_rate` rather than reaching for a remembered figure.

## Connectors run on the user's machine

Price connectors are a main-process concern, and they run locally so that a
retrieval is attributable to a real fetch with a real timestamp against a real
URL.

This is also a practical constraint worth recording. The environment this
foundation was built in blocks outbound access to `pbs.gov.pk`, `cda.gov.pk`,
`rda.gop.pk`, `zameen.com`, `brickpakistan.com`, `fbr.gov.pk` and `alibaba.com`
at the network policy level — all seven return a proxy denial. No connector
could have been tested here, and any price "fetched" during the build would
necessarily have been invented. The connector framework, the source registry and
the provenance model are therefore complete; the fetchers are marked `planned`
and must be written and verified against live sources on a machine that can
reach them.
