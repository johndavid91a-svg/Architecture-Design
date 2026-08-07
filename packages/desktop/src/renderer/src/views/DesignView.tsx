import { useEffect, useMemo, useState } from 'react';
import {
  applyThemeToFloors,
  buildInteriorPrompt,
  designFromTheme,
  extractJson,
  findMaterial,
  findTheme,
  fromMm2,
  MAX_CORRECTION_ROUNDS,
  polygonArea,
  THEMES,
  validateInteriorProposal,
  type Design,
  type DesignRequest,
  type Room,
  type RoomDesign,
  type ThemeId,
} from '@adp/core';
import type { ProjectStore } from '../state/project-store.js';

interface Props {
  readonly store: ProjectStore;
}

interface AiState {
  readonly configured: boolean;
  readonly keyLocation: string;
  readonly model: string;
}

/** One line of the AI transcript, so the user sees what happened and why. */
interface LogLine {
  readonly kind: 'info' | 'ok' | 'warn' | 'err';
  readonly text: string;
}

export function DesignView({ store }: Props): JSX.Element {
  const { project, floors, design } = store;
  const [themeId, setThemeId] = useState<ThemeId>(THEMES[0]!.id);
  const [includeFurniture, setIncludeFurniture] = useState(true);
  const [message, setMessage] = useState('');
  const [unplaced, setUnplaced] = useState<readonly string[]>([]);

  const [ai, setAi] = useState<AiState | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [instruction, setInstruction] = useState(
    'Make this room feel like a premium satellite technology company: technical, restrained, organised around visible data.',
  );
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  useEffect(() => {
    void window.desktop.aiStatus().then(setAi);
  }, []);

  const rooms = useMemo(
    () => floors.flatMap((f) => f.rooms.map((r) => ({ floor: f, room: r }))),
    [floors],
  );

  useEffect(() => {
    if (!selectedRoomId && rooms.length > 0) setSelectedRoomId(rooms[0]!.room.id);
  }, [rooms, selectedRoomId]);

  const theme = findTheme(themeId);

  const applyTheme = () => {
    if (!project || !design || !theme) return;
    const ids = store.newDesignIds();
    const result = designFromTheme({
      design,
      floors,
      theme,
      name: `${theme.name}`,
      label: `Option ${String.fromCharCode(65 + project.designs.length)} — ${theme.name}`,
      includeFurniture,
      createdAt: new Date().toISOString(),
      newDesignId: ids.designId,
      newVersionId: ids.versionId,
    });
    store.addDesign(result.design);
    setUnplaced(result.unplaced);
    setMessage(
      `Applied "${theme.name}" as a new design option.` +
        (result.unplaced.length > 0
          ? ` ${result.unplaced.length} item(s) could not be placed — listed below.`
          : ''),
    );
  };

  const applyThemeToCurrent = () => {
    if (!design || !theme) return;
    const applied = applyThemeToFloors(floors, theme, { includeFurniture });
    store.replaceDesign({ ...design, themeId: theme.id, floors: applied.floors });
    setUnplaced(applied.unplaced);
    setMessage(`Re-applied "${theme.name}" to the current design.`);
  };

  /**
   * Run the AI Interior Designer on one room.
   *
   * The loop is the point: propose, validate against real geometry, and on
   * failure re-prompt with the exact measurements that failed. A model asked to
   * furnish a room will produce something plausible and slightly too large
   * often enough that a single-shot call is not a feature, it is a liability.
   */
  const runAgent = async () => {
    if (!project || !design) return;
    const target = rooms.find((r) => r.room.id === selectedRoomId);
    if (!target) return;

    setBusy(true);
    setLog([{ kind: 'info', text: `Designing "${target.room.name}" — ${instruction}` }]);

    const request: DesignRequest = {
      instruction,
      scope: { kind: 'room', roomId: target.room.id },
      themeId: theme?.id,
    };

    let correction: string | undefined;
    let applied = false;

    for (let round = 1; round <= MAX_CORRECTION_ROUNDS; round++) {
      const prompt = buildInteriorPrompt({
        request,
        room: target.room,
        walls: target.floor.walls,
        theme,
        correction,
      });

      setLog((l) => [...l, { kind: 'info', text: `Round ${round}: calling ${ai?.model ?? 'the model'}…` }]);

      const response = await window.desktop.aiCall({
        system: prompt.system,
        user: prompt.user,
        maxTokens: 4096,
      });

      if (!response.ok) {
        setLog((l) => [...l, { kind: 'err', text: `${response.reason}: ${response.detail}` }]);
        break;
      }

      const parsed = extractJson(response.text);
      if (parsed === null) {
        correction = 'Your response was not valid JSON. Respond with a single JSON object, nothing else.';
        setLog((l) => [...l, { kind: 'warn', text: 'Response was not JSON. Re-prompting.' }]);
        continue;
      }

      const validated = validateInteriorProposal(parsed, target.room, target.floor.walls);
      if (!validated.ok) {
        correction = validated.correction;
        setLog((l) => [
          ...l,
          { kind: 'warn', text: `Rejected (${validated.reason}): ${validated.detail}` },
        ]);
        continue;
      }

      // Design-layer only. There is no path from here to the architecture.
      const nextFloors = design.floors.map((fd) =>
        fd.floorId === target.floor.id
          ? {
              ...fd,
              rooms: fd.rooms.map((rd: RoomDesign) =>
                rd.roomId === target.room.id ? validated.value.design : rd,
              ),
            }
          : fd,
      );

      const next: Design = {
        ...design,
        floors: nextFloors,
        origin: { kind: 'ai', instruction, model: response.model, parentDesignId: design.id },
      };
      store.replaceDesign(next);
      applied = true;

      setLog((l) => [
        ...l,
        { kind: 'ok', text: `Accepted on round ${round}. ${validated.value.design.rationale ?? ''}` },
        ...validated.warnings.map((w) => ({ kind: 'warn' as const, text: w })),
      ]);
      break;
    }

    if (!applied) {
      setLog((l) => [
        ...l,
        {
          kind: 'err',
          text:
            `Gave up after ${MAX_CORRECTION_ROUNDS} rounds. Nothing was applied — the previous design ` +
            `is untouched. This is the intended outcome when a proposal cannot be made to fit.`,
        },
      ]);
    }
    setBusy(false);
  };

  if (!project || !design) return <div className="list-empty">Create a project first.</div>;

  const designedRooms = design.floors.flatMap((f) => f.rooms).filter((r) => r.finishes.length > 0).length;
  const totalRooms = rooms.length;

  return (
    <div>
      <h1>Design</h1>
      <p className="sub">
        The design layer holds finishes, furniture and lighting. It references rooms by id and carries
        no geometry of its own, so nothing here can move a wall — which is what makes generating five
        options over one building both cheap and safe.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="k">Active design</div>
          <div className="v" style={{ fontSize: 15 }}>
            {design.label ?? design.name}
          </div>
          <div className="n">{design.origin.kind.replace(/_/g, ' ')}</div>
        </div>
        <div className="stat">
          <div className="k">Rooms designed</div>
          <div className="v">
            {designedRooms}/{totalRooms}
          </div>
          <div className="n">with finishes assigned</div>
        </div>
        <div className="stat">
          <div className="k">Options</div>
          <div className="v">{project.designs.length}</div>
          <div className="n">saved on this building</div>
        </div>
        <div className="stat">
          <div className="k">AI</div>
          <div className="v" style={{ fontSize: 15, color: ai?.configured ? 'var(--ok)' : 'var(--warn)' }}>
            {ai === null ? '…' : ai.configured ? 'Ready' : 'No key'}
          </div>
          <div className="n">{ai?.model ?? ''}</div>
        </div>
      </div>

      <h2>Apply a theme</h2>
      <p className="sub small">
        Deterministic and instant — no API key, no latency. It assigns finishes from the theme's
        role-keyed materials, sizes the lighting to an illuminance target for each room's use, and lays
        out furniture through the same clearance validator that AI proposals face.
      </p>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="dv-theme">Theme</label>
            <select id="dv-theme" value={themeId} onChange={(e) => setThemeId(e.target.value as ThemeId)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={includeFurniture}
                onChange={(e) => setIncludeFurniture(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span className="small">Lay out furniture</span>
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="primary" onClick={applyTheme}>
              Apply as new option
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="ghost" onClick={applyThemeToCurrent}>
              Apply to current design
            </button>
          </div>
        </div>

        {theme && (
          <div className="small muted" style={{ marginTop: 10 }}>
            {theme.identity}
          </div>
        )}
      </div>

      {message && <div className="notice info">{message}</div>}

      {unplaced.length > 0 && (
        <div className="notice">
          <strong>Could not place {unplaced.length} item(s).</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {unplaced.map((u) => (
              <li key={u} className="small">
                {u}
              </li>
            ))}
          </ul>
          <div className="small muted" style={{ marginTop: 6 }}>
            Reported rather than forced in. An item that does not fit is a room-size problem, and the
            layout will not pretend otherwise.
          </div>
        </div>
      )}

      <h2>AI Interior Designer</h2>

      {ai && !ai.configured && (
        <div className="notice">
          <strong>No API key configured, so the agent cannot run.</strong>
          <p className="small" style={{ margin: '6px 0' }}>
            Set <span className="mono">ANTHROPIC_API_KEY</span>, or save a key below. It is written to{' '}
            <span className="mono">{ai.keyLocation}</span> and never into a project file — project
            files get copied and emailed, and a credential inside one leaks the moment it is shared.
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="password"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ maxWidth: 360 }}
            />
            <button
              className="ghost"
              disabled={!apiKey}
              onClick={async () => {
                const result = await window.desktop.aiSaveKey(apiKey);
                if (result.saved) {
                  setApiKey('');
                  setAi(await window.desktop.aiStatus());
                } else {
                  setMessage(`Could not save the key: ${result.error}`);
                }
              }}
            >
              Save key
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="grid cols-2">
          <div>
            <label htmlFor="dv-room">Room</label>
            <select id="dv-room" value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)}>
              {rooms.map(({ floor, room }) => (
                <option key={room.id} value={room.id}>
                  {floor.name} — {room.name} ({fromMm2(polygonArea(room.boundary), 'ft2').toFixed(0)} sq ft)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dv-instr">Instruction</label>
            <textarea
              id="dv-instr"
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={runAgent} disabled={busy || !ai?.configured}>
            {busy ? 'Designing…' : 'Run AI Interior Designer'}
          </button>
          <span className="small muted">
            Proposals are validated against the real room before anything is applied. A layout that does
            not fit is rejected and the model is re-prompted with the measurements — up to{' '}
            {MAX_CORRECTION_ROUNDS} rounds.
          </span>
        </div>
      </div>

      {log.length > 0 && (
        <div className="card">
          <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>
            Transcript
          </div>
          {log.map((line, i) => (
            <div
              key={i}
              className="small mono"
              style={{
                marginBottom: 4,
                color:
                  line.kind === 'ok'
                    ? 'var(--ok)'
                    : line.kind === 'warn'
                      ? 'var(--warn)'
                      : line.kind === 'err'
                        ? 'var(--err)'
                        : 'var(--muted)',
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}

      <h2>Rooms in this design</h2>
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '50vh' }}>
        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th>Floor finish</th>
              <th>Wall finish</th>
              <th>Ceiling</th>
              <th className="num">Lights</th>
              <th className="num">Furniture</th>
            </tr>
          </thead>
          <tbody>
            {design.floors.flatMap((fd) =>
              fd.rooms.map((rd) => {
                const room: Room | undefined = rooms.find((r) => r.room.id === rd.roomId)?.room;
                const floorFinish = rd.finishes.find((f) => f.surface === 'floor');
                const wallFinish = rd.finishes.find((f) => f.surface === 'wall_internal');
                return (
                  <tr key={rd.roomId}>
                    <td>{room?.name ?? rd.roomId}</td>
                    <td className="small">
                      {floorFinish ? (findMaterial(floorFinish.materialId)?.name ?? '—') : <span className="muted">none</span>}
                    </td>
                    <td className="small">
                      {wallFinish ? (findMaterial(wallFinish.materialId)?.name ?? '—') : <span className="muted">none</span>}
                    </td>
                    <td className="small">{rd.ceiling.kind.replace(/_/g, ' ')}</td>
                    <td className="num">{rd.lighting.reduce((n, l) => n + l.count, 0)}</td>
                    <td className="num">{rd.furniture.length}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
