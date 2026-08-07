# China sourcing and landed cost

## The rule

> Never present a factory price as the final Pakistan cost.

An Alibaba listing showing CNY 25/sq ft for porcelain tile is an ex-works
indication, usually a range, usually conditional on MOQ. Putting it next to a
Pakistani retail rate is not a comparison — it is a comparison of two different
things, and it always makes importing look better than it is.

## The cascade

Pakistani import taxation compounds. Sales tax is charged on a value that already
includes customs duty; withholding income tax is charged on a value that already
includes sales tax. Applying all of them to the CIF value — the intuitive but
wrong approach — understates landed cost substantially on high-duty goods.

```
    FOB          unit price × quantity (after MOQ)
  + freight      international
  + insurance
  ─────────────
  = CIF          the assessable value customs works from
  + CD           customs duty             on CIF
  + ACD          additional customs duty  on CIF
  + RD           regulatory duty          on CIF
  ─────────────
  = DUTY-PAID VALUE
  + ST           sales tax                on DUTY-PAID VALUE
  + VAT          value-addition tax       on DUTY-PAID VALUE
  ─────────────
  = TAX-PAID VALUE
  + WHT          withholding income tax   on TAX-PAID VALUE
  + port charges
  + clearing agent
  + inland freight
  + warehousing
  + installation
  ─────────────
  = LANDED COST
```

`packages/core/src/sourcing/landed-cost.ts`, tested in `landed-cost.test.ts`,
which asserts explicitly that sales tax exceeds `CIF × rate` — the check that
would fail if the cascade were flattened.

## No rate is hard-coded

`DutySchedule` requires the PCT code, every rate, the schedule name, the source
URL, the date it was read, and a `provisional` flag.

Duty rates are PCT-specific and change with each Finance Act and with SROs in
between; research for this build found the 2026-27 package reducing several
tariff, ACD and RD bands. A rate baked into this repository would be wrong within
months and wrong invisibly. The type makes it impossible to compute a landed cost
without recording where the rates came from.

Two warnings fire automatically: when `provisional` is set, and when the schedule
was read more than 120 days ago.

## Minimum order quantity

You buy what the factory will sell, not what the drawing needs. When MOQ exceeds
requirement, the calculation bills the MOQ, reports the surplus as
`moqOverhang`, and warns. A 300-unit requirement against a 500-unit MOQ is a 67%
cost overrun that a naive unit-price comparison never shows.

## Exchange rates

Every conversion uses a dated `ExchangeRate` carrying its source and retrieval
date. Without one on file the calculation returns `no_exchange_rate` and computes
nothing. There is no fallback rate.

## The comparison

`compareSourcing` returns one of four verdicts:

| Verdict | When |
| --- | --- |
| `local_cheaper` | Local wins beyond the comparable band |
| `imported_cheaper` | Import wins beyond the band, after all duties and handling |
| `comparable` | Within 5% — price gives no reason to import |
| `insufficient_data` | Either side unpriced; no comparison attempted |

**China is not assumed cheaper.** When local wins, the result says so in as many
words rather than presenting the import option anyway.

**Comparable is a real answer.** Within 5%, the honest statement is that price
gives no reason to import and the decision belongs to lead time, quality and
replacement risk.

Non-price factors are attached to every comparison, including one that is always
true: imported material carries replacement risk, because a damaged or
short-shipped batch cannot be topped up locally.

## Choosing a supplier

Never on price alone. The supplier model carries rating, years active,
certifications, MOQ, specification, lead time and last-checked date. A supplier
two months old with no certifications and the lowest price is a risk that the
lowest price does not compensate for.

## Beyond China

The landed-cost model is origin-agnostic — it needs a duty schedule, freight and
handling figures, and an exchange rate, none of which are China-specific. UAE,
Turkey, Italy and Germany need only their own duty schedules and freight
assumptions.

## Status

The landed-cost engine and the comparison are implemented and tested. The
Alibaba connector is `planned`: `alibaba.com` is blocked by this development
environment's network policy, so no live supplier data could be fetched or
verified here. Supplier records must currently be entered by hand.
