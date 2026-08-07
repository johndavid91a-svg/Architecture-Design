import { useMemo, useState } from 'react';
import {
  BASE_MATERIALS,
  compareSourcing,
  computeTakeoff,
  computeLandedCost,
  DEFAULT_SETTINGS,
  estimate,
  findSubstitutions,
  type DutySchedule,
  type ExchangeRate,
  type FreightAndHandling,
  type MaterialId,
} from '@adp/core';
import type { ProjectStore } from '../state/project-store.js';
import type { PriceBook } from '../state/price-book.js';

interface Props {
  readonly store: ProjectStore;
  readonly priceBook: PriceBook;
  readonly priceVersion: number;
}

const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

const EMPTY_DUTY = {
  pctCode: '',
  customsDuty: '',
  additionalCustomsDuty: '',
  regulatoryDuty: '',
  salesTax: '',
  valueAdditionTax: '',
  withholdingTax: '',
  sourceUrl: '',
  readAt: new Date().toISOString().slice(0, 10),
};

const EMPTY_HANDLING = {
  internationalFreight: '',
  insurance: '',
  portCharges: '',
  clearingAgentFee: '',
  inlandFreight: '',
  warehousing: '',
  installation: '',
};

export function SourcingView({ store, priceBook, priceVersion }: Props): JSX.Element {
  const { floors, design } = store;

  // ---- Value engineering -------------------------------------------------
  const [targetSaving, setTargetSaving] = useState('');

  const takeoff = useMemo(
    () => (floors.length > 0 ? computeTakeoff(floors, design) : null),
    [floors, design],
  );

  const result = useMemo(() => {
    if (!takeoff) return null;
    return estimate(
      [...takeoff.lines, ...takeoff.gaps],
      (materialId) => priceBook.lookup(materialId),
      (trade) => priceBook.lookupLabour(trade),
      DEFAULT_SETTINGS,
    );
  }, [takeoff, priceBook, priceVersion]);

  const lineMaterials = useMemo(() => {
    const map = new Map<string, MaterialId>();
    for (const line of takeoff?.lines ?? []) {
      if (line.materialId) map.set(line.key, line.materialId);
    }
    return map;
  }, [takeoff]);

  const ve = useMemo(() => {
    if (!result) return null;
    const target = Number(targetSaving);
    return findSubstitutions(
      result,
      lineMaterials,
      (materialId) => priceBook.lookup(materialId),
      'STANDARD',
      Number.isFinite(target) && target > 0 ? target : 0,
    );
  }, [result, lineMaterials, priceBook, priceVersion, targetSaving]);

  // ---- Landed cost -------------------------------------------------------
  const [materialId, setMaterialId] = useState<string>('mat_tile_porcelain');
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [moq, setMoq] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [duty, setDuty] = useState(EMPTY_DUTY);
  const [handling, setHandling] = useState(EMPTY_HANDLING);
  const [localTotal, setLocalTotal] = useState('');
  const [provisional, setProvisional] = useState(true);

  const landed = useMemo(() => {
    const price = Number(unitPrice);
    const qty = Number(quantity);
    const rate = Number(fxRate);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (!Number.isFinite(rate) || rate <= 0) return null;

    const pct = (raw: string) => {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? v / 100 : 0;
    };
    const money = (raw: string) => {
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    };

    const schedule: DutySchedule = {
      pctCode: duty.pctCode || 'not entered',
      description: BASE_MATERIALS.find((m) => m.id === materialId)?.name ?? '',
      customsDuty: pct(duty.customsDuty),
      additionalCustomsDuty: pct(duty.additionalCustomsDuty),
      regulatoryDuty: pct(duty.regulatoryDuty),
      salesTax: pct(duty.salesTax),
      valueAdditionTax: pct(duty.valueAdditionTax),
      withholdingTax: pct(duty.withholdingTax),
      sourceName: 'User-entered from the current tariff schedule',
      sourceUrl: duty.sourceUrl,
      readAt: new Date(duty.readAt).toISOString(),
      provisional: provisional || duty.pctCode === '',
    };

    const freight: FreightAndHandling = {
      internationalFreight: money(handling.internationalFreight),
      insurance: money(handling.insurance),
      portCharges: money(handling.portCharges),
      clearingAgentFee: money(handling.clearingAgentFee),
      inlandFreight: money(handling.inlandFreight),
      warehousing: money(handling.warehousing),
      installation: money(handling.installation),
      currency: 'PKR',
    };

    const rates: ExchangeRate[] = [
      {
        from: 'CNY',
        to: 'PKR',
        rate,
        retrievedAt: new Date().toISOString(),
        sourceName: 'Entered by user',
        sourceUrl: '',
      },
    ];

    return computeLandedCost({
      description: BASE_MATERIALS.find((m) => m.id === materialId)?.name ?? 'Imported item',
      unitPrice: price,
      quantity: qty,
      minimumOrderQuantity: Number(moq) > 0 ? Number(moq) : undefined,
      currency: 'CNY',
      duty: schedule,
      handling: freight,
      targetCurrency: 'PKR',
      rates,
    });
  }, [materialId, unitPrice, quantity, moq, fxRate, duty, handling, provisional]);

  const comparison = useMemo(() => {
    const local = Number(localTotal);
    return compareSourcing({
      description: BASE_MATERIALS.find((m) => m.id === materialId)?.name ?? 'Item',
      localTotal: Number.isFinite(local) && local > 0 ? local : null,
      importedTotal: landed?.ok ? landed.breakdown.landedTotal : null,
      currency: 'PKR',
      importProvisional: landed?.ok ? landed.breakdown.provisional : undefined,
      importLeadTimeDays: 45,
      localLeadTimeDays: 7,
    });
  }, [localTotal, landed, materialId]);

  const setDutyField = (key: keyof typeof EMPTY_DUTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDuty((d) => ({ ...d, [key]: e.target.value }));
  const setHandlingField =
    (key: keyof typeof EMPTY_HANDLING) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setHandling((h) => ({ ...h, [key]: e.target.value }));

  return (
    <div>
      <h1>Sourcing and value engineering</h1>

      <h2>Local versus imported</h2>
      <p className="sub">
        A factory price is not a Pakistan cost. Duties are charged on CIF, sales tax on the duty-paid
        value, and withholding tax on the tax-paid value — the taxes compound rather than stacking on
        the same base, and flattening that understates the landed cost substantially on high-duty
        goods.
      </p>

      <div className="notice">
        <strong>Enter the rates from the current schedule for your PCT code.</strong>
        <div className="small" style={{ marginTop: 4 }}>
          Nothing is pre-filled. Duty rates are PCT-specific and change with each Finance Act and with
          SROs issued in between; a rate baked into this application would be wrong within months and
          wrong invisibly. Confirm with a clearing agent before committing.
        </div>
      </div>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="sv-mat">Material</label>
            <select id="sv-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              {BASE_MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sv-price">Ex-works unit price (CNY)</label>
            <input id="sv-price" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
          <div>
            <label htmlFor="sv-qty">Quantity required</label>
            <input id="sv-qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <label htmlFor="sv-moq">Supplier MOQ</label>
            <input id="sv-moq" value={moq} onChange={(e) => setMoq(e.target.value)} placeholder="optional" />
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="sv-fx">CNY → PKR rate</label>
            <input id="sv-fx" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="sv-pct">PCT / HS code</label>
            <input id="sv-pct" value={duty.pctCode} onChange={setDutyField('pctCode')} />
          </div>
          <div>
            <label htmlFor="sv-url">Schedule URL</label>
            <input id="sv-url" value={duty.sourceUrl} onChange={setDutyField('sourceUrl')} />
          </div>
          <div>
            <label htmlFor="sv-read">Schedule read on</label>
            <input id="sv-read" type="date" value={duty.readAt} onChange={setDutyField('readAt')} />
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="sv-cd">Customs duty %</label>
            <input id="sv-cd" value={duty.customsDuty} onChange={setDutyField('customsDuty')} />
          </div>
          <div>
            <label htmlFor="sv-acd">Additional CD %</label>
            <input id="sv-acd" value={duty.additionalCustomsDuty} onChange={setDutyField('additionalCustomsDuty')} />
          </div>
          <div>
            <label htmlFor="sv-rd">Regulatory duty %</label>
            <input id="sv-rd" value={duty.regulatoryDuty} onChange={setDutyField('regulatoryDuty')} />
          </div>
          <div>
            <label htmlFor="sv-st">Sales tax %</label>
            <input id="sv-st" value={duty.salesTax} onChange={setDutyField('salesTax')} />
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="sv-vat">Value-addition tax %</label>
            <input id="sv-vat" value={duty.valueAdditionTax} onChange={setDutyField('valueAdditionTax')} />
          </div>
          <div>
            <label htmlFor="sv-wht">Withholding tax %</label>
            <input id="sv-wht" value={duty.withholdingTax} onChange={setDutyField('withholdingTax')} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={provisional}
                onChange={(e) => setProvisional(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span className="small">Rates unverified (provisional)</span>
            </label>
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 12 }}>
          {(
            [
              ['internationalFreight', 'Intl. freight (PKR)'],
              ['insurance', 'Insurance'],
              ['portCharges', 'Port charges'],
              ['clearingAgentFee', 'Clearing agent'],
              ['inlandFreight', 'Inland freight'],
              ['warehousing', 'Warehousing'],
              ['installation', 'Installation'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`sv-${key}`}>{label}</label>
              <input id={`sv-${key}`} value={handling[key]} onChange={setHandlingField(key)} />
            </div>
          ))}
          <div>
            <label htmlFor="sv-local">Local total for the same quantity (PKR)</label>
            <input id="sv-local" value={localTotal} onChange={(e) => setLocalTotal(e.target.value)} />
          </div>
        </div>
      </div>

      {landed === null && (
        <div className="notice info small">
          Enter at least an ex-works price, a quantity and an exchange rate to compute a landed cost.
        </div>
      )}

      {landed && !landed.ok && (
        <div className="notice err">
          <strong>Cannot compute.</strong> {landed.detail}
        </div>
      )}

      {landed?.ok && (
        <>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <tbody>
                {(
                  [
                    ['FOB (ex-works × quantity)', landed.breakdown.fob],
                    ['International freight', landed.breakdown.internationalFreight],
                    ['Insurance', landed.breakdown.insurance],
                    ['= CIF (assessable value)', landed.breakdown.cif],
                    ['Customs duty', landed.breakdown.customsDuty],
                    ['Additional customs duty', landed.breakdown.additionalCustomsDuty],
                    ['Regulatory duty', landed.breakdown.regulatoryDuty],
                    ['= Duty-paid value', landed.breakdown.dutyPaidValue],
                    ['Sales tax (on duty-paid value)', landed.breakdown.salesTax],
                    ['Value-addition tax', landed.breakdown.valueAdditionTax],
                    ['= Tax-paid value', landed.breakdown.taxPaidValue],
                    ['Withholding tax (on tax-paid value)', landed.breakdown.withholdingTax],
                    ['Port charges', landed.breakdown.portCharges],
                    ['Clearing agent', landed.breakdown.clearingAgentFee],
                    ['Inland freight', landed.breakdown.inlandFreight],
                    ['Warehousing', landed.breakdown.warehousing],
                    ['Installation', landed.breakdown.installation],
                  ] as const
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td className={label.startsWith('=') ? '' : 'muted'} style={{ width: '60%' }}>
                      {label.startsWith('=') ? <strong>{label.slice(2)}</strong> : label}
                    </td>
                    <td className="num">{fmt(value)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>LANDED COST</strong>
                  </td>
                  <td className="num">
                    <strong>{fmt(landed.breakdown.landedTotal)} PKR</strong>
                  </td>
                </tr>
                <tr>
                  <td className="muted">Per unit ({fmt(landed.breakdown.billedQuantity)} billed)</td>
                  <td className="num">{landed.breakdown.landedUnitCost.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {landed.breakdown.warnings.map((w) => (
            <div key={w} className="notice">
              {w}
            </div>
          ))}

          <div className={comparison.verdict === 'local_cheaper' ? 'notice info' : 'notice'}>
            <strong>{comparison.statement}</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {comparison.nonPriceFactors.map((f) => (
                <li key={f} className="small muted">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>Value engineering</h2>
      <p className="sub">
        Substitutions are only proposed where both the current material and the alternative are
        actually priced. A saving computed against an unpriced alternative would be a fabricated
        price wearing a different hat, and it would arrive attached to a confident recommendation.
      </p>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="ve-target">Target saving (PKR)</label>
            <input
              id="ve-target"
              value={targetSaving}
              onChange={(e) => setTargetSaving(e.target.value)}
              placeholder="leave blank to list everything"
            />
          </div>
        </div>
      </div>

      {ve && (
        <>
          <div className={ve.targetReached ? 'notice info' : 'notice'}>
            <strong>{ve.statement}</strong>
          </div>

          {ve.skipped.length > 0 && (
            <div className="notice">
              <strong>{ve.skipped.length} candidate(s) could not be costed.</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {ve.skipped.map((s) => (
                  <li key={s} className="small">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ve.substitutions.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '55vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Current</th>
                    <th>Alternative</th>
                    <th className="num">Saving</th>
                    <th>Recommendation</th>
                    <th style={{ width: '30%' }}>Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {ve.substitutions.map((s) => (
                    <tr key={`${s.lineKey}-${s.alternativeMaterialId}`}>
                      <td className="small">{s.lineDescription}</td>
                      <td className="small">
                        {s.currentMaterialName}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {fmt(s.currentCost)}
                        </div>
                      </td>
                      <td className="small">
                        {s.alternativeMaterialName}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {fmt(s.alternativeCost)}
                        </div>
                      </td>
                      <td className="num" style={{ color: 'var(--ok)' }}>
                        {fmt(s.saving)}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {(s.savingFraction * 100).toFixed(0)}%
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            s.recommendation === 'recommended'
                              ? 'high'
                              : s.recommendation === 'acceptable'
                                ? 'medium'
                                : 'low'
                          }`}
                        >
                          {s.recommendation.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="small muted">
                        {s.qualityImpact}
                        <div style={{ marginTop: 3 }}>{s.visualImpact}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
