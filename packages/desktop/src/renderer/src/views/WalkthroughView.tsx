import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  boundsOf,
  centroid,
  findFurniture,
  findMaterial,
  PAKISTAN_LOCATIONS,
  polygonArea,
  sunPosition,
  type Design,
  type Floor,
  type Project,
} from '@adp/core';
import { cacheFrame, registerCanvas } from '../state/view-capture.js';

interface Props {
  readonly project: Project;
  readonly floors: readonly Floor[];
  readonly design: Design | undefined;
}

type Mode = 'orbit' | 'walk';

const EYE_HEIGHT_MM = 1650;
const WALK_SPEED_MM_PER_S = 3000;
const COLLISION_RADIUS_MM = 300;
const MM = 0.001; // millimetres to scene metres

/**
 * 3D digital twin, walkthrough and daylight.
 *
 * Geometry is extruded from the architecture layer on every load — there is no
 * separate 3D model to fall out of sync with the plan. Materials and furniture
 * come from the design layer, so switching design options re-skins the same
 * building rather than rebuilding it.
 *
 * Millimetres are scaled to metres for the scene. Three.js lighting and its
 * near/far defaults assume roughly metre-scale units; a building modelled in
 * millimetres puts the camera 4,572 units from a wall and shadow bias, fog and
 * attenuation all stop behaving. The conversion happens here and nowhere else.
 */
export function WalkthroughView({ project, floors, design }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('orbit');
  const [floorIndex, setFloorIndex] = useState(0);
  const [showCeilings, setShowCeilings] = useState(false);
  const [showFurniture, setShowFurniture] = useState(true);
  const [hour, setHour] = useState(10);
  const [month, setMonth] = useState(5);
  const [day, setDay] = useState(21);
  const [status, setStatus] = useState('');
  const [sunInfo, setSunInfo] = useState('');

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const floorIndexRef = useRef(floorIndex);
  floorIndexRef.current = floorIndex;

  // Sun state is read by the render loop each frame rather than triggering a
  // scene rebuild, so dragging the time slider is smooth.
  const sunRef = useRef<{ light: THREE.DirectionalLight | null; ambient: THREE.HemisphereLight | null }>({
    light: null,
    ambient: null,
  });
  const timeRef = useRef({ hour, month, day });
  timeRef.current = { hour, month, day };

  const city = project.architecture.site.location.city;
  const location = PAKISTAN_LOCATIONS[city] ?? PAKISTAN_LOCATIONS['Islamabad']!;

  const designSignature = useMemo(
    () =>
      design
        ? design.floors
            .flatMap((f) => f.rooms)
            .map(
              (r) =>
                `${r.roomId}:${r.finishes.map((x) => x.surface + x.materialId).join(',')}:${r.furniture.length}`,
            )
            .join('|')
        : 'none',
    [design],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1116);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 800);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    registerCanvas('model', renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xbcd4f0, 0x2a3038, 1.0);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffe9c9, 2.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);
    sunRef.current = { light: sun, ambient };

    // ---- Materials from the design layer ---------------------------------
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();
    const materialFor = (
      materialId: string | undefined,
      fallbackHex: number,
      side: THREE.Side = THREE.FrontSide,
    ): THREE.MeshStandardMaterial => {
      const key = `${materialId ?? `fallback_${fallbackHex}`}|${side}`;
      const cached = materialCache.get(key);
      if (cached) return cached;

      const spec = materialId ? findMaterial(materialId as never) : undefined;
      const appearance = spec?.appearance;
      const material = new THREE.MeshStandardMaterial({
        color: appearance ? new THREE.Color(appearance.baseColorHex) : new THREE.Color(fallbackHex),
        roughness: appearance?.roughness ?? 0.9,
        metalness: appearance?.metalness ?? 0,
        side,
      });
      materialCache.set(key, material);
      return material;
    };

    const designByRoom = new Map(
      (design?.floors ?? []).flatMap((f) => f.rooms.map((r) => [r.roomId, r] as const)),
    );

    const building = new THREE.Group();
    scene.add(building);

    const ceilingMeshes: THREE.Mesh[] = [];
    const furnitureMeshes: THREE.Object3D[] = [];
    const wallSegments: Array<{
      level: number;
      a: THREE.Vector2;
      b: THREE.Vector2;
      halfThickness: number;
    }> = [];
    const allPoints: Array<{ x: number; y: number }> = [];

    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x8fc0d6,
      roughness: 0.06,
      metalness: 0.1,
      transparent: true,
      opacity: 0.32,
    });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 0.6 });

    for (const floor of floors) {
      const elevation = floor.elevation * MM;

      for (const room of floor.rooms) {
        allPoints.push(...room.boundary);
        const rd = designByRoom.get(room.id);

        // Plan Y maps to scene -Z. That flip is done ENTIRELY by the -90° X
        // rotation below, which sends a shape point (x, y) to world (x, 0, -y).
        // Building the shape in (x, -y) as well applied the flip twice and put
        // every floor slab mirrored across the origin, sitting beside its own
        // walls rather than inside them.
        const shape = new THREE.Shape();
        room.boundary.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x * MM, p.y * MM);
          else shape.lineTo(p.x * MM, p.y * MM);
        });
        shape.closePath();

        const floorFinish = rd?.finishes.find((f) => f.surface === 'floor');
        const slab = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          materialFor(floorFinish?.materialId, 0x9aa3ad),
        );
        slab.rotation.x = -Math.PI / 2;
        slab.position.y = elevation + 0.01;
        slab.receiveShadow = true;
        building.add(slab);

        const ceilingDrop = (rd?.ceiling.dropHeight ?? 0) * MM;
        // Same rotation as the slab, so it lands in the same place; BackSide so
        // it is visible from inside the room and invisible from above.
        const ceiling = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          materialFor(rd?.ceiling.materialId, 0xf2f0ec, THREE.BackSide),
        );
        ceiling.rotation.x = -Math.PI / 2;
        ceiling.position.y = elevation + room.clearHeight * MM - ceilingDrop;
        ceiling.receiveShadow = true;
        ceilingMeshes.push(ceiling);
        building.add(ceiling);

        // ---- Furniture from the design layer -----------------------------
        for (const item of rd?.furniture ?? []) {
          const spec = findFurniture(item.catalogueKey);
          const colour = spec ? new THREE.Color(spec.placeholderColorHex) : new THREE.Color(0x8892a0);
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(item.width * MM, item.height * MM, item.depth * MM),
            new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 }),
          );
          mesh.position.set(
            item.position.x * MM,
            elevation + (item.height / 2) * MM,
            -item.position.y * MM,
          );
          mesh.rotation.y = -(item.rotationDeg * Math.PI) / 180;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          furnitureMeshes.push(mesh);
          building.add(mesh);
        }
      }

      // ---- Walls, built as the solid pieces between openings --------------
      for (const wall of floor.walls) {
        allPoints.push(wall.start, wall.end);
        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;

        wallSegments.push({
          level: floor.level,
          a: new THREE.Vector2(wall.start.x, wall.start.y),
          b: new THREE.Vector2(wall.end.x, wall.end.y),
          halfThickness: wall.thickness / 2,
        });

        const angle = Math.atan2(dy, dx);

        // A room's wall finish is applied to the walls that bound it. Where two
        // rooms share a wall the first wins — a per-face finish needs split
        // geometry, which is not worth the triangle count at this stage.
        const owningRoom = floor.rooms.find((r) => r.boundingWallIds.includes(wall.id));
        const rd = owningRoom ? designByRoom.get(owningRoom.id) : undefined;
        const wallFinish = rd?.finishes.find((f) => f.surface === 'wall_internal' && !f.heightLimit);
        const material = materialFor(
          wallFinish?.materialId,
          wall.function === 'exterior' ? 0xb9b3a8 : 0xd8d4cc,
        );

        const sorted = [...wall.openings].sort((a, b) => a.distanceAlongWall - b.distanceAlongWall);
        const solids: Array<[number, number]> = [];
        let cursor = 0;
        for (const o of sorted) {
          const start = Math.max(0, o.distanceAlongWall - o.width / 2);
          const end = Math.min(length, o.distanceAlongWall + o.width / 2);
          if (start > cursor) solids.push([cursor, start]);
          cursor = Math.max(cursor, end);
        }
        if (cursor < length) solids.push([cursor, length]);

        const addBox = (
          fromAlong: number,
          toAlong: number,
          baseMm: number,
          heightMm: number,
          mat: THREE.Material,
        ) => {
          const segLen = toAlong - fromAlong;
          if (segLen <= 1 || heightMm <= 1) return;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(segLen * MM, heightMm * MM, wall.thickness * MM),
            mat,
          );
          const midAlong = (fromAlong + toAlong) / 2;
          mesh.position.set(
            (wall.start.x + Math.cos(angle) * midAlong) * MM,
            elevation + (baseMm + heightMm / 2) * MM,
            -(wall.start.y + Math.sin(angle) * midAlong) * MM,
          );
          mesh.rotation.y = -angle;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          building.add(mesh);
        };

        for (const [a, b] of solids) addBox(a, b, 0, wall.height, material);

        for (const o of sorted) {
          const start = Math.max(0, o.distanceAlongWall - o.width / 2);
          const end = Math.min(length, o.distanceAlongWall + o.width / 2);
          const headBase = o.sillHeight + o.height;
          addBox(start, end, headBase, Math.max(0, wall.height - headBase), material);
          if (o.sillHeight > 0) addBox(start, end, 0, o.sillHeight, material);

          const infill = new THREE.Mesh(
            new THREE.BoxGeometry((end - start) * MM, o.height * MM, wall.thickness * 0.4 * MM),
            o.kind === 'window' ? glassMaterial : doorMaterial,
          );
          const midAlong = (start + end) / 2;
          infill.position.set(
            (wall.start.x + Math.cos(angle) * midAlong) * MM,
            elevation + (o.sillHeight + o.height / 2) * MM,
            -(wall.start.y + Math.sin(angle) * midAlong) * MM,
          );
          infill.rotation.y = -angle;
          building.add(infill);
        }
      }
    }

    // ---- Ground ----------------------------------------------------------
    const modelBounds = boundsOf(allPoints);
    const spanX = (modelBounds.maxX - modelBounds.minX) * MM;
    const spanY = (modelBounds.maxY - modelBounds.minY) * MM;
    // The ground is sized to the shadow camera below rather than made huge.
    // Ground extending past the shadow frustum renders fully lit, which reads as
    // two bright wedges beside the building — a frustum edge, mistakable for
    // geometry.
    const siteSpan = Math.max(spanX, spanY, 12);
    const groundSize = siteSpan * 2.2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);

    const modelCentre = centroid([
      { x: modelBounds.minX, y: modelBounds.minY },
      { x: modelBounds.maxX, y: modelBounds.minY },
      { x: modelBounds.maxX, y: modelBounds.maxY },
      { x: modelBounds.minX, y: modelBounds.maxY },
    ]);
    const target = new THREE.Vector3(modelCentre.x * MM, 2, -modelCentre.y * MM);
    ground.position.x = target.x;
    ground.position.z = target.z;
    sun.target.position.copy(target);

    // Fit the shadow frustum to the ground so every lit surface is inside it.
    const half = groundSize / 2;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = siteSpan * 8;
    sun.shadow.camera.updateProjectionMatrix();

    let orbitAngle = Math.PI * 0.25;
    let orbitElevation = 0.55;
    let orbitDistance = Math.max(spanX, spanY, 12) * 1.6;

    const walkPos = new THREE.Vector3(target.x, EYE_HEIGHT_MM * MM, target.z + 3);
    let yaw = Math.PI;
    let pitch = 0;
    const keys = new Set<string>();

    const applyOrbit = () => {
      camera.position.set(
        target.x + Math.cos(orbitAngle) * Math.cos(orbitElevation) * orbitDistance,
        target.y + Math.sin(orbitElevation) * orbitDistance,
        target.z + Math.sin(orbitAngle) * Math.cos(orbitElevation) * orbitDistance,
      );
      camera.lookAt(target);
    };
    applyOrbit();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const el = renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (modeRef.current === 'orbit') {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
      } else {
        void el.requestPointerLock();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (modeRef.current === 'orbit') {
        if (!dragging) return;
        orbitAngle -= (e.clientX - lastX) * 0.006;
        orbitElevation = Math.max(0.05, Math.min(1.45, orbitElevation + (e.clientY - lastY) * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        applyOrbit();
      } else if (document.pointerLockElement === el) {
        yaw -= e.movementX * 0.0022;
        pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.0022));
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== 'orbit') return;
      e.preventDefault();
      orbitDistance = Math.max(3, Math.min(600, orbitDistance * (1 + e.deltaY * 0.0012)));
      applyOrbit();
    };
    const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    /**
     * Collision: push the camera out of any wall it has entered.
     *
     * A capsule-versus-segment test rather than raycasting the mesh. It is
     * cheap, it cannot tunnel through a wall at speed, and it works on the
     * centreline data the twin already holds instead of on render geometry.
     */
    const resolveCollisions = (position: THREE.Vector3, level: number) => {
      const p = new THREE.Vector2(position.x / MM, -position.z / MM);
      for (const seg of wallSegments) {
        if (seg.level !== level) continue;
        const ab = new THREE.Vector2().subVectors(seg.b, seg.a);
        const lenSq = ab.lengthSq();
        if (lenSq === 0) continue;
        let t = new THREE.Vector2().subVectors(p, seg.a).dot(ab) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closest = new THREE.Vector2().copy(seg.a).addScaledVector(ab, t);
        const away = new THREE.Vector2().subVectors(p, closest);
        const dist = away.length();
        const minDist = seg.halfThickness + COLLISION_RADIUS_MM;
        if (dist < minDist && dist > 0.001) {
          away.multiplyScalar((minDist - dist) / dist);
          p.add(away);
        }
      }
      position.x = p.x * MM;
      position.z = -p.y * MM;
    };

    let raf = 0;
    let previous = performance.now();
    let sunFrame = 0;

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;

      // Sun is recomputed a few times a second, not every frame — the position
      // changes by fractions of a degree per minute of simulated time.
      if (sunFrame++ % 10 === 0) {
        const t = timeRef.current;
        const date = new Date(2026, t.month, t.day, Math.floor(t.hour), Math.round((t.hour % 1) * 60));
        const p = sunPosition({
          latitude: location.latitude,
          longitude: location.longitude,
          utcOffsetHours: location.utcOffsetHours,
          date,
        });

        const distance = Math.max(spanX, spanY, 40) * 2;
        sun.position.set(
          target.x + p.direction.x * distance,
          Math.max(0.5, p.direction.z * distance),
          target.z - p.direction.y * distance,
        );
        sun.intensity = p.isUp ? 0.4 + Math.sin((p.altitude * Math.PI) / 180) * 2.2 : 0;
        ambient.intensity = p.isUp ? 0.7 + Math.sin((p.altitude * Math.PI) / 180) * 0.6 : 0.25;
        // Low sun reads warmer, which is most of what makes a shadow study legible.
        const warmth = p.isUp ? Math.max(0, 1 - p.altitude / 45) : 0;
        sun.color.setRGB(1, 0.92 - warmth * 0.18, 0.79 - warmth * 0.32);

        setSunInfo(
          p.isUp
            ? `Altitude ${p.altitude.toFixed(1)}°, azimuth ${p.azimuth.toFixed(0)}° — ${city}`
            : `Sun below the horizon — ${city}`,
        );
      }

      if (modeRef.current === 'walk') {
        const floor = floors[floorIndexRef.current];
        const elevation = (floor?.elevation ?? 0) * MM;

        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const move = new THREE.Vector3();
        if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(forward);
        if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(forward);
        if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
        if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);

        if (move.lengthSq() > 0) {
          const speed = (keys.has('ShiftLeft') ? 2 : 1) * WALK_SPEED_MM_PER_S * MM;
          move.normalize().multiplyScalar(speed * dt);
          walkPos.add(move);
          resolveCollisions(walkPos, floor?.level ?? 0);
        }
        walkPos.y = elevation + EYE_HEIGHT_MM * MM;

        camera.position.copy(walkPos);
        camera.lookAt(
          walkPos.x + Math.sin(yaw) * Math.cos(pitch),
          walkPos.y + Math.sin(pitch),
          walkPos.z + Math.cos(yaw) * Math.cos(pitch),
        );
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    setStatus(
      `${floors.length} floor(s), ${floors.reduce((n, f) => n + f.rooms.length, 0)} rooms, ` +
        `${floors.reduce((n, f) => n + f.walls.length, 0)} walls, ` +
        `${furnitureMeshes.length} furniture item(s) from the design layer.`,
    );

    // Expose the toggles to the outer component without rebuilding the scene.
    const applyVisibility = (ceilings: boolean, furniture: boolean) => {
      for (const m of ceilingMeshes) m.visible = ceilings;
      for (const m of furnitureMeshes) m.visible = furniture;
    };
    visibilityRef.current = applyVisibility;
    applyVisibility(showCeilings, showFurniture);

    return () => {
      cacheFrame('model');
      registerCanvas('model', null);
      visibilityRef.current = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // designSignature rather than `design`: a new object identity with the same
    // content should not tear down and rebuild the whole scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, designSignature, city]);

  const visibilityRef = useRef<((ceilings: boolean, furniture: boolean) => void) | null>(null);
  useEffect(() => {
    visibilityRef.current?.(showCeilings, showFurniture);
  }, [showCeilings, showFurniture]);

  const totalArea = useMemo(
    () => floors.reduce((sum, f) => sum + f.rooms.reduce((s, r) => s + polygonArea(r.boundary) / 92_903.04, 0), 0),
    [floors],
  );

  return (
    <div className="viewport" ref={mountRef}>
      <div className="overlay tl" style={{ maxWidth: 260 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{project.name}</div>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className={mode === 'orbit' ? 'primary' : 'ghost'} onClick={() => setMode('orbit')}>
            Orbit
          </button>
          <button className={mode === 'walk' ? 'primary' : 'ghost'} onClick={() => setMode('walk')}>
            Walk
          </button>
        </div>

        {mode === 'walk' && (
          <>
            <label htmlFor="walk-floor">Floor</label>
            <select
              id="walk-floor"
              value={floorIndex}
              onChange={(e) => setFloorIndex(Number(e.target.value))}
            >
              {floors.map((f, i) => (
                <option key={f.id} value={i}>
                  {f.name}
                </option>
              ))}
            </select>
          </>
        )}

        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={showCeilings}
            onChange={(e) => setShowCeilings(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span className="small">Show ceilings</span>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showFurniture}
            onChange={(e) => setShowFurniture(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span className="small">Show furniture</span>
        </label>

        <div className="small muted" style={{ marginTop: 8 }}>
          {mode === 'orbit' ? (
            <>Drag to orbit, scroll to zoom.</>
          ) : (
            <>
              Click to capture the mouse, then <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>,{' '}
              <kbd>Shift</kbd> to run, <kbd>Esc</kbd> to release. Walls are solid.
            </>
          )}
        </div>
      </div>

      <div className="overlay tr" style={{ maxWidth: 250 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>
          Daylight
        </div>
        <label htmlFor="sun-hour">Time — {hour.toFixed(1).replace('.0', ':00').replace('.5', ':30')}</label>
        <input
          id="sun-hour"
          type="range"
          min={0}
          max={23.5}
          step={0.5}
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
        />
        <div className="grid cols-2" style={{ marginTop: 8 }}>
          <div>
            <label htmlFor="sun-month">Month</label>
            <select id="sun-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(
                (m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label htmlFor="sun-day">Day</label>
            <input
              id="sun-day"
              type="number"
              min={1}
              max={31}
              value={day}
              onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="ghost"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => {
              setMonth(5);
              setDay(21);
            }}
          >
            21 Jun
          </button>
          <button
            className="ghost"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => {
              setMonth(11);
              setDay(21);
            }}
          >
            21 Dec
          </button>
        </div>
        <div className="small muted mono" style={{ marginTop: 8 }}>
          {sunInfo}
        </div>
      </div>

      <div className="overlay bl">
        <div className="small mono">{totalArea.toFixed(0)} sq ft gross</div>
        <div className="small muted" style={{ marginTop: 4, maxWidth: 360 }}>
          {status}
        </div>
      </div>
    </div>
  );
}
