import { useState } from 'react';
import { findMaterial, THEMES, themeToBrief, type Theme } from '@adp/core';

function Swatch({ hex, label }: { hex: string; label: string }): JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          height: 44,
          borderRadius: 6,
          background: hex,
          border: '1px solid var(--line)',
        }}
      />
      <div className="small muted mono" style={{ marginTop: 4, fontSize: 10 }}>
        {label}
      </div>
    </div>
  );
}

function ThemeDetail({ theme }: { theme: Theme }): JSX.Element {
  const [showBrief, setShowBrief] = useState(false);
  const materialName = (id?: string) => (id ? (findMaterial(id as never)?.name ?? id) : '—');

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{theme.name}</div>
          <div className="small muted">{theme.family.replace(/_/g, ' ')}</div>
        </div>
        <button className="ghost" onClick={() => setShowBrief((s) => !s)}>
          {showBrief ? 'Hide AI brief' : 'Show AI brief'}
        </button>
      </div>

      <p className="small" style={{ margin: '10px 0' }}>
        {theme.identity}
      </p>

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <Swatch hex={theme.palette.primary} label="primary" />
        <Swatch hex={theme.palette.secondary} label="secondary" />
        <Swatch hex={theme.palette.accent} label="accent" />
        <Swatch hex={theme.palette.neutralLight} label="neutral" />
      </div>

      <div className="small muted" style={{ marginBottom: 10 }}>
        <strong>Accent discipline:</strong> {theme.palette.accentUsage}
      </div>

      <table>
        <tbody>
          <tr>
            <td className="muted small" style={{ width: '32%' }}>
              Primary floor
            </td>
            <td className="small">{materialName(theme.materials.primaryFloor)}</td>
          </tr>
          <tr>
            <td className="muted small">Wall</td>
            <td className="small">{materialName(theme.materials.primaryWall)}</td>
          </tr>
          <tr>
            <td className="muted small">Ceiling</td>
            <td className="small">
              {materialName(theme.materials.ceiling)} ({theme.ceilingKind.replace(/_/g, ' ')})
            </td>
          </tr>
          <tr>
            <td className="muted small">Façade</td>
            <td className="small">
              {materialName(theme.materials.facade)}
              {theme.facadeSystem ? ` · ${theme.facadeSystem.replace(/_/g, ' ')}` : ''}
            </td>
          </tr>
          <tr>
            <td className="muted small">Lighting</td>
            <td className="small">
              {theme.lighting.description} ({theme.lighting.colourTemperatureK}K)
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 12 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
          Signature elements
        </div>
        {theme.signatureElements.map((s) => (
          <div key={s.element} className="small" style={{ marginBottom: 8 }}>
            <span className="muted mono" style={{ fontSize: 11 }}>
              {String(s.where).replace(/_/g, ' ')}
            </span>
            <div>{s.element}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {s.rationale}
            </div>
          </div>
        ))}
      </div>

      <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
        <span className="small">
          <strong>Avoid:</strong> {theme.avoid}
        </span>
      </div>

      {showBrief && (
        <pre
          className="small mono"
          style={{
            marginTop: 12,
            marginBottom: 0,
            whiteSpace: 'pre-wrap',
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: 12,
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {themeToBrief(theme)}
        </pre>
      )}
    </div>
  );
}

export function ThemesView(): JSX.Element {
  return (
    <div>
      <h1>Theme engine</h1>
      <p className="sub">
        A theme is a specification, not a filter. It states a design language — palette, materials,
        lighting character, signature moves, and what to avoid — and the design agents consult it as
        a constraint. Because it is data, a theme can be read and judged before anything is
        generated, and a new one can be added without touching code. Themes never name a supplier or
        a price: those vary by city and by month, and a theme that hard-coded one would be wrong
        everywhere but in the market it was written for.
      </p>

      <div className="notice info">
        <span className="small">
          The <strong>AI brief</strong> on each theme is the exact prose handed to the design agents.
          Negative constraints carry most of the value, and models follow a prohibition written as a
          sentence far more reliably than one encoded as a field.
        </span>
      </div>

      <div className="grid cols-2">
        {THEMES.map((t) => (
          <ThemeDetail key={t.id} theme={t} />
        ))}
      </div>
    </div>
  );
}
