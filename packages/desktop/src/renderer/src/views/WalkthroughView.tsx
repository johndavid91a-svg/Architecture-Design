import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { allFloors, boundsOf, centroid, polygonArea, type Floor, type Project } from '@adp/core';

interface Props {
  readonly project: Project;
}

type Mode = 'orbit' | 'walk';

/** Eye height for the first-person camera. */
const EYE_HEIGHT_MM = 1650;
const WALK_SPEED_MM_PER_S = 3000;
const COLLISION_RADIUS_MM = 300;

/**
 * 3D digital twin and walkthrough.
 *
 * The geometry is extruded directly from the architecture layer every time the
 * project changes — there is no separate 3D model to fall out of sync with the
 * plan. That is the point of a digital twin: one set of dimensions, several
 * views of it.
 *
 * Millimetres are scaled to metres for the scene (Three.js and its lighting
 * defaults assume roughly metre-scale units; a building modelled in millimetres
 * puts the camera 4,572 units from a wall and the near/far planes stop
 * behaving). The conversion happens here at the boundary and nowhere else.
 */
export function WalkthroughView({ project }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('orbit');
  const [floorIndex, setFloorIndex] = useState(0);
  const [status, setStatus] = useState('');
  const floors = useMemo(() => allFloors(project), [project]);

  // Kept in refs so the animation loop reads current values without re-mounting
  // the whole scene on every state change.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const floorIndexRef = useRef(floorIndex);
  floorIndexRef.current = floorIndex;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1116);
    scene.fog = new THREE.Fog(0x0d1116, 40, 200);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // ---- Lighting -------------------------------------------------------
    scene.add(new THREE.HemisphereLight(0xbcd4f0, 0x2a3038, 1.1));
    const sun = new THREE.DirectionalLight(0xffe9c9, 1.8);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    scene.add(sun);

    // ---- Build the building ---------------------------------------------
    const MM = 0.001; // millimetres to scene metres
    const building = new THREE.Group();
    scene.add(building);

    /** Walls per floor level, kept for collision tests during walkthrough. */
    const wallSegments: Array<{
      level: number;
      a: THREE.Vector2;
      b: THREE.Vector2;
      halfThickness: number;
    }> = [];

    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.85 });
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.95 });
    const structuralMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.95 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x8fc0d6,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
    });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 0.6 });

    const allPoints: Array<{ x: number; y: number }> = [];

    for (const floor of floors) {
      const elevation = floor.elevation * MM;

      // --- Floor slabs from room polygons ---
      for (const room of floor.rooms) {
        allPoints.push(...room.boundary);
        const shape = new THREE.Shape();
        room.boundary.forEach((p, i) => {
          if (i === 0) shape.moveTo(p.x * MM, p.y * MM);
          else shape.lineTo(p.x * MM, p.y * MM);
        });
        shape.closePath();

        const slab = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial);
        slab.rotation.x = -Math.PI / 2;
        slab.position.y = elevation + 0.01;
        slab.receiveShadow = true;
        building.add(slab);

        // Ceiling plane, so an interior view is enclosed rather than open to sky.
        const ceiling = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.95, side: THREE.BackSide }),
        );
        ceiling.rotation.x = -Math.PI / 2;
        ceiling.position.y = elevation + room.clearHeight * MM;
        building.add(ceiling);
      }

      // --- Walls, with openings cut out ---
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

        // A wall with openings is built as the solid pieces between them —
        // cheaper and far more robust than CSG subtraction, and it produces
        // clean geometry for the head and sill panels above and below.
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
          fromMmAlong: number,
          toMmAlong: number,
          baseMm: number,
          heightMm: number,
          material: THREE.Material,
        ) => {
          const segLen = toMmAlong - fromMmAlong;
          if (segLen <= 1 || heightMm <= 1) return;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(segLen * MM, heightMm * MM, wall.thickness * MM),
            material,
          );
          const midAlong = (fromMmAlong + toMmAlong) / 2;
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

        const material = wall.function === 'exterior' ? structuralMaterial : wallMaterial;
        for (const [a, b] of solids) addBox(a, b, 0, wall.height, material);

        // Head panels above each opening, sill panels below windows, and the
        // opening infill itself.
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

    // Plan Y maps to scene -Z, so the model reads north-up from above.
    building.children.forEach((child) => {
      if (child instanceof THREE.Mesh && child.rotation.x === -Math.PI / 2) {
        child.scale.z = -1;
      }
    });

    // ---- Ground ----------------------------------------------------------
    const modelBounds = boundsOf(allPoints);
    const spanX = (modelBounds.maxX - modelBounds.minX) * MM;
    const spanY = (modelBounds.maxY - modelBounds.minY) * MM;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(spanX, spanY) * 4 + 60, Math.max(spanX, spanY) * 4 + 60),
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

    // ---- Orbit state -----------------------------------------------------
    let orbitAngle = Math.PI * 0.25;
    let orbitElevation = 0.55;
    let orbitDistance = Math.max(spanX, spanY, 12) * 1.5;

    // ---- Walk state ------------------------------------------------------
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

    // ---- Input -----------------------------------------------------------
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (modeRef.current === 'orbit') {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
      } else {
        void renderer.domElement.requestPointerLock();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) {
        renderer.domElement.releasePointerCapture(e.pointerId);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (modeRef.current === 'orbit') {
        if (!dragging) return;
        orbitAngle -= (e.clientX - lastX) * 0.006;
        orbitElevation = Math.max(0.05, Math.min(1.45, orbitElevation + (e.clientY - lastY) * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        applyOrbit();
      } else if (document.pointerLockElement === renderer.domElement) {
        yaw -= e.movementX * 0.0022;
        pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.0022));
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== 'orbit') return;
      e.preventDefault();
      orbitDistance = Math.max(3, Math.min(400, orbitDistance * (1 + e.deltaY * 0.0012)));
      applyOrbit();
    };
    const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

    const el = renderer.domElement;
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
     * cheap, it never tunnels through a wall at speed, and it works on the
     * centreline data the twin already holds instead of on the render geometry.
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

    // ---- Loop ------------------------------------------------------------
    let raf = 0;
    let previous = performance.now();

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
        `${floors.reduce((n, f) => n + f.walls.length, 0)} walls extruded from the twin.`,
    );

    return () => {
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
  }, [floors]);

  const totalArea = useMemo(
    () =>
      floors.reduce(
        (sum, f: Floor) => sum + f.rooms.reduce((s, r) => s + polygonArea(r.boundary) / 92_903.04, 0),
        0,
      ),
    [floors],
  );

  return (
    <div className="viewport" ref={mountRef}>
      <div className="overlay tl">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{project.name}</div>
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className={mode === 'orbit' ? 'primary' : 'ghost'}
            onClick={() => setMode('orbit')}
          >
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
        <div className="small muted" style={{ marginTop: 8 }}>
          {mode === 'orbit' ? (
            <>Drag to orbit, scroll to zoom.</>
          ) : (
            <>
              Click to capture the mouse, then <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to
              move, <kbd>Shift</kbd> to run, <kbd>Esc</kbd> to release. Walls are solid.
            </>
          )}
        </div>
      </div>

      <div className="overlay bl">
        <div className="small mono">{totalArea.toFixed(0)} sq ft gross</div>
        <div className="small muted" style={{ marginTop: 4, maxWidth: 320 }}>
          {status}
        </div>
      </div>
    </div>
  );
}
