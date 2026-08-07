import { CHINA_SOURCES, PAKISTAN_SOURCES, type PriceSource, type SourceTier } from '@adp/core';

const TIER_LABEL: Record<SourceTier, string> = {
  LEVEL_1_OFFICIAL: 'Level 1 — Official',
  LEVEL_2_MARKET: 'Level 2 — Established market',
  LEVEL_3_SUPPLIER_QUOTE: 'Level 3 — Verified supplier',
  LEVEL_4_ESTIMATE: 'Level 4 — Market estimate',
};

const TIER_CLASS: Record<SourceTier, string> = {
  LEVEL_1_OFFICIAL: 'high',
  LEVEL_2_MARKET: 'medium',
  LEVEL_3_SUPPLIER_QUOTE: 'high',
  LEVEL_4_ESTIMATE: 'low',
};

const CONNECTOR_LABEL: Record<PriceSource['connector'], string> = {
  implemented: 'Available now',
  planned: 'Connector planned',
  manual_only: 'Consult manually',
};

function SourceCard({ source }: { source: PriceSource }): JSX.Element {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{source.name}</div>
          <div className="small muted">
            {source.region} · publishes {source.cadence.replace(/_/g, ' ')}
          </div>
        </div>
        <span className={`badge ${TIER_CLASS[source.tier]}`}>{TIER_LABEL[source.tier]}</span>
      </div>

      <p className="small" style={{ margin: '10px 0 6px' }}>
        {source.covers}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        <strong>Caveat:</strong> {source.caveats}
      </p>

      <div className="row" style={{ marginTop: 10 }}>
        <span className="small muted">{CONNECTOR_LABEL[source.connector]}</span>
        {source.url && (
          <a className="small" href={source.url} target="_blank" rel="noreferrer">
            View source ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function SourcesView(): JSX.Element {
  return (
    <div>
      <h1>Price sources</h1>
      <p className="sub">
        Not every source deserves the same trust, so none of them get it. Each source sits in a tier,
        and the tier decides the confidence badge shown against any figure taken from it and how
        quickly that figure goes stale. A supplier's quotation for this project outranks a national
        average, because it is what you will actually pay.
      </p>

      <div className="notice info">
        <strong>These sources are consulted from your machine, not from ours.</strong>
        <p style={{ margin: '8px 0 0' }} className="small">
          Price connectors run locally so the retrieval is attributable to a real fetch, with the URL
          and timestamp recorded against the figure. Sources marked <em>Consult manually</em> are
          ones where the useful content is a regulation or a tariff schedule that needs reading
          rather than scraping — open the link, read the figure, and record it as a price with its
          source.
        </p>
      </div>

      <h2>Pakistan — Islamabad and Rawalpindi</h2>
      <div className="grid cols-2">
        {PAKISTAN_SOURCES.map((s) => (
          <SourceCard key={s.id} source={s} />
        ))}
      </div>

      <h2>China and import</h2>
      <div className="grid cols-2">
        {CHINA_SOURCES.map((s) => (
          <SourceCard key={s.id} source={s} />
        ))}
      </div>

      <div className="notice">
        <strong>Property valuation is not construction cost.</strong>
        <p style={{ margin: '8px 0 0' }} className="small">
          FBR's notified valuation rates exist for tax assessment on property transfer. They are kept
          as a separate dataset and are never summed with, or substituted for, a construction
          estimate. Conflating the two is a common and expensive mistake.
        </p>
      </div>
    </div>
  );
}
