# Local pricing sources — Islamabad and Rawalpindi

The first pricing region. The registry lives in
`packages/core/src/pricing/source.ts` and is shown in the application under
**Price Sources**, with each source's tier, coverage and caveats.

**This document contains no prices.** It is a directory of where prices come
from and what each source can legitimately be used for. See
[`PRICING_ENGINE.md`](PRICING_ENGINE.md) for why.

## Verification note

Every source below was reachable and current as a published resource at the time
of writing, but **none could be fetched during this build**: the development
environment's network policy returns a proxy denial for all of them. Coverage and
caveats are therefore based on what each body publishes, not on a live read.
Connectors must be implemented and verified against the live sources.

## Level 1 — Official

### Pakistan Bureau of Statistics — Price Statistics
<https://www.pbs.gov.pk/price-statistics>

**Publishes.** Sensitive Price Indicator (weekly), Consumer Price Index and
Wholesale Price Index (monthly). The SPI basket includes cement; the WPI series
carries building materials.

**Good for.** An official anchor and trend direction. When a supplier quotation
is 20% off the national average, that is worth knowing before signing.

**Not good for.** Line items. These are average *retail* figures, not
delivered-to-site trade prices, published as PDF/Excel with a lag. Use to check a
total, not to price a BOQ row.

**Connector:** planned. Parsing a monthly PDF/Excel release, matching series
codes to material ids.

### Capital Development Authority — Laws and Regulations
<https://cda.gov.pk/lawsAndRegulations>

**Publishes.** Islamabad building control: land use, FAR, height, setbacks,
parking, coverage. Schedules of rates where published.

**Good for.** The regulation checker for any Islamabad project, and for CDA's
own schedule of rates as a Level 1 cost reference.

**Caveat.** Amendments are issued as separate notifications, so a consolidated
document on the site may lag. A check against these rules is never an approval.

**Connector:** manual. The valuable content is regulation that needs reading.

### Rawalpindi Development Authority — Land and Building Control
<https://rda.gop.pk/land-building-control>

As CDA, for Rawalpindi. The application selects the authority from the project's
city: Islamabad → CDA, Rawalpindi → RDA, elsewhere → other.

### FBR — Immovable Property Valuation (Islamabad)
<https://urdu.fbr.gov.pk/propertyValuation/17636>

**Publishes.** Notified valuation rates for immovable property by sector, for tax
purposes.

**Critical caveat.** This is **property valuation, not construction cost**. The
two are kept as separate datasets and must never be summed or substituted. A
sector's notified land value tells you nothing about what it costs to build
there. This source is listed specifically so the distinction is explicit rather
than assumed, and the application repeats the warning in the Price Sources view.

### FBR — Customs Tariff and Schedules
<https://www.fbr.gov.pk/>

**Publishes.** Customs duty, additional customs duty, regulatory duty, sales tax
and withholding rates by PCT/HS code. The authoritative input to any landed-cost
calculation.

**Caveat.** Rates are PCT-code specific and change with each Finance Act and with
SROs issued in between. Research for this build found the 2026-27 package
reducing several tariff, ACD and RD bands — which is exactly why no rate is
hard-coded anywhere in this repository. A landed cost computed from a remembered
rate is worthless; the code and the schedule date are stored with the figure.

## Level 2 — Established market

### Zameen — Construction Cost Calculator
<https://www.zameen.com/tools/construction-cost-calculator/>

Per-square-foot grey-structure and finishing benchmarks by city. Explicitly a
benchmark: methodology and update date are not published. Use to sanity-check a
total, never as the source for a line item.

### Brick Pakistan — Islamabad construction material rates
<https://www.brickpakistan.com/materials/islamabad>

Market rates for cement, steel, bricks, sand, crush and finishing materials by
city. Retail market listing; brand and grade are not always stated, and a rate
without a stated grade cannot be compared against a quotation that states one.

## Level 3 — Verified supplier

Quotations the user obtains and records. Highest standing for the project, but
only within their validity window and stated quantity — a quote for 500 sq ft
does not price 5,000 sq ft. The application records the supplier name, location,
specification and date, and treats a quotation the user is looking at as
verified today.

## Level 4 — Market estimate

Anything typed from memory. Permanently reported at LOW confidence. The
distinction from a quotation is what stops a guess reading like research three
months later.

## Adding a source

1. Add a `PriceSource` to `PAKISTAN_SOURCES` with its tier, coverage, caveats,
   cadence and region. The caveats field is not optional in spirit: it is what
   the UI shows to stop a user over-trusting a figure.
2. Set `connector` to `manual_only` until a fetcher exists.
3. Implement the fetcher in the main process. It must record the exact URL read
   and the retrieval timestamp on every record it produces.
4. Never let a connector overwrite an existing record. Append and supersede.

## Beyond Islamabad and Rawalpindi

The registry is a list, and the estimation engine takes the tier from the record
rather than from a hard-coded region. Adding Lahore or Karachi means adding
sources and their local authorities; nothing in the engines changes.
