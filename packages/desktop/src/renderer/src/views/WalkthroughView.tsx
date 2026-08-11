import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  boundsOf,
  centroid,
  findEntrances,
  findFurniture,
  findMaterial,
  justInside,
  landingFor,
  PAKISTAN_LOCATIONS,
  polygonArea,
  sunPosition,
  transportNear,
  transportPoints,
  type Design,
  type Floor,
  type Project,
  type TransportPoint,
} from '@adp/core';
import { cacheFrame, registerCanvas } from '../state/view-capture.js';

interface Props {
  readonly project: Project;
  readonly floors: readonly Floor[];
  readonly design: Design | undefined;
}

type Mode = 'orbit' | 'walk';

/**
 * The two presentation animations.
 *
 * `assemble` raises the storeys into place one after another, which is how a
 * building is explained to someone who has not seen it: the stack of floors and
 * how each one sits on the last. `flyaround` orbits it at a steady rate for a
 * walk-round without anyone having to drag the mouse. Both are presentation
 * tools and neither touches the model.
 */
type Cinematic = 'none' | 'assemble' | 'flyaround';

/** Seconds each storey takes to rise, and the overlap between consecutive ones. */
const ASSEMBLE_RISE_S = 0.9;
const ASSEMBLE_STAGGER_S = 0.45;
/** Seconds for one full orbit. Slow enough to read the elevations as they pass. */
const FLYAROUND_PERIOD_S = 26;

const EYE_HEIGHT_MM = 1650;
const WALK_SPEED_MM_PER_S = 3000;
const COLLISION_RADIUS_MM = 300;
/**
 * Shortest wall fragment that is allowed to block the walker.
 *
 * Narrower than a doorway. A traced plan produces hundreds of stubs a few
 * hundred millimetres long — corners, hatch remnants, furniture outlines — and
 * treating each as solid turns a floor into a minefield of invisible posts you
 * cannot see, cannot walk round and cannot understand. A real wall shorter than
 * this blocks nothing worth blocking.
 */
const MIN_OBSTACLE_MM = 700;
const MM = 0.001; // millimetres to scene metres

/**
 * Lift timings, in seconds.
 *
 * A passenger lift in a low-rise building runs at about 1 m/s and its doors
 * take a second or so each way. Using the real figures rather than snapping
 * instantly between floors is not decoration: the time a lift takes is the
 * reason a building needs two of them, and a ride that takes no time hides that
 * completely.
 */
const LIFT_SPEED_M_PER_S = 1.2;
const LIFT_DOOR_S = 1.1;
const LIFT_MIN_TRAVEL_S = 1.0;
/** How long a flight of stairs takes to climb. Slower than a lift, as it is. */
const STAIR_CLIMB_S = 2.4;

/** A stack of lift landings that share a shaft, and the car that runs in it. */
interface Shaft {
  readonly at: { x: number; y: number };
  readonly levels: readonly number[];
  readonly car: THREE.Group;
  /** Which level the car is parked at when nobody is riding. */
  current: number;
}

/** A journey in progress: a lift ride or a flight of stairs. */
interface Ride {
  readonly kind: 'lift' | 'stair';
  readonly shaft: Shaft | null;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly fromY: number;
  readonly toY: number;
  readonly at: { x: number; y: number };
  readonly startedAt: number;
  readonly travelS: number;
}

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
  const [prompt, setPrompt] = useState<{ label: string; up: boolean; down: boolean } | null>(null);
  const [cinematic, setCinematic] = useState<Cinematic>('none');
  /** Show only the selected storey, so a floor can be read on its own. */
  const [isolate, setIsolate] = useState(false);
  /** Wayfinding signs over the entrance, the stairs and the lifts. */
  const [showSigns, setShowSigns] = useState(true);
  /** What the lift is doing right now, for the on-screen indicator. */
  const [riding, setRiding] = useState('');

  /**
   * Cinematic state, read by the render loop each frame.
   *
   * A ref rather than state: these advance sixty times a second, and a re-render
   * per frame would cost more than the animation does.
   */
  const cinematicRef = useRef<{ kind: Cinematic; startedAt: number; elapsed: number }>({
    kind: 'none',
    startedAt: 0,
    elapsed: 0,
  });
  cinematicRef.current.kind = cinematic;

  const cores = useMemo(() => transportPoints(floors), [floors]);
  const coresRef = useRef(cores);
  coresRef.current = cores;

  const entrances = useMemo(() => findEntrances(floors), [floors]);
  const entrancesRef = useRef(entrances);
  entrancesRef.current = entrances;

  // Set by the render loop when the walker should be moved to another floor.
  const teleportRef = useRef<{ level: number; at: { x: number; y: number } } | null>(null);
  /** A lift ride or a stair climb in progress. Null when standing still. */
  const rideRef = useRef<Ride | null>(null);
  /** Set from the UI to send the walker to the front door. */
  const goToEntranceRef = useRef(false);
  /** Set from the UI to stand the walker in the stair or the lift. */
  const goToCoreRef = useRef<'stair' | 'lift' | null>(null);
  /** Walk through walls. The escape hatch when the geometry is approximate. */
  const [ghost, setGhost] = useState(false);
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  /** True when the walker began the frame already inside geometry. */
  const stuckRef = useRef(false);
  const [stuck, setStuck] = useState(false);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const floorIndexRef = useRef(floorIndex);
  floorIndexRef.current = floorIndex;
  const isolateRef = useRef(isolate);
  isolateRef.current = isolate;
  const signsRef = useRef(showSigns);
  signsRef.current = showSigns;

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

    // One group per storey. Everything a floor owns goes in its own group so a
    // floor can be moved, faded or hidden as a unit — which is what makes the
    // assemble animation and the exploded view possible without rebuilding the
    // scene each time.
    const floorGroups = new Map<number, THREE.Group>();

    for (const floor of floors) {
      const elevation = floor.elevation * MM;
      const floorGroup = new THREE.Group();
      floorGroups.set(floor.level, floorGroup);
      building.add(floorGroup);

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
        floorGroup.add(slab);

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
        floorGroup.add(ceiling);

        // ---- Stairs, drawn as real steps ---------------------------------
        // A box labelled "stair" is useless in a walkthrough: you cannot tell
        // whether the flight actually fits the core or lands on the floor above.
        // Drawing the treads from the derived riser count shows both.
        if (room.use === 'stair') {
          const stair = floor.stairs.find((st) => {
            const sx = st.footprint.map((q) => q.x);
            const rx = room.boundary.map((q) => q.x);
            return Math.abs(Math.min(...sx) - Math.min(...rx)) < 500;
          });
          if (stair) {
            const rb = boundsOf(room.boundary);
            const count = Math.max(1, Math.round(stair.floorToFloorRise / stair.riserHeight));
            const stepMaterial = new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 });
            for (let i = 0; i < count; i++) {
              const step = new THREE.Mesh(
                new THREE.BoxGeometry(
                  stair.width * MM,
                  stair.riserHeight * MM,
                  stair.treadDepth * MM,
                ),
                stepMaterial,
              );
              step.position.set(
                (rb.minX + stair.width / 2) * MM,
                elevation + (i + 0.5) * stair.riserHeight * MM,
                -(rb.minY + 1200 + i * stair.treadDepth) * MM,
              );
              step.castShadow = true;
              step.receiveShadow = true;
              floorGroup.add(step);
            }
          }
        }

        // The lift car is deliberately NOT built here. One car per floor gives
        // nine cars in a nine-storey shaft, all of them solid, none of them
        // moving — you cannot ride a lift that is already on every floor. The
        // car belongs to the shaft, not to the storey, and is built once below.

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
          floorGroup.add(mesh);
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
          floorGroup.add(mesh);
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
          floorGroup.add(infill);
        }
      }
    }

    // ---- Wayfinding ------------------------------------------------------
    //
    // Standing inside a building you have never been in, the two things you need
    // to be told are where the way out is and where the stairs are. A model that
    // renders every wall perfectly and answers neither is unusable — which is
    // what this was: the lift was a solid block repeated on every floor, the
    // stair was unmarked, and the entrance was one dark rectangle among sixty.
    //
    // Signs are drawn with `depthTest: false`, so they read THROUGH the walls
    // between you and them. That is not a rendering mistake; it is the whole
    // point. In a real building the sign is round the corner and you find it by
    // walking; in a model you are trying to understand a plan, and being able to
    // see that the lift is behind that wall is the thing you came for.
    const signGroup = new THREE.Group();
    scene.add(signGroup);
    const signsForLevel = new Map<number, THREE.Object3D[]>();

    /**
     * Signs to hide when you are standing on top of them.
     *
     * Everything here draws with `depthTest: false`, which is what lets a sign
     * be seen through a wall — and which means a marker the camera is *inside*
     * paints over the entire frame. Walking into the staircase filled the screen
     * with flat green and walking into the lift filled it with flat blue: the
     * beacon, at zero distance, covering the building. A marker you are standing
     * in has also finished its job, so it is hidden.
     */
    const nearHide: Array<{ object: THREE.Object3D; at: { x: number; y: number } }> = [];
    const HIDE_WITHIN_M = 3;

    const makeSign = (text: string, background: string, foreground: string): THREE.Sprite => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 160;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 512, 160);
      ctx.strokeStyle = foreground;
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, 502, 150);
      ctx.fillStyle = foreground;
      ctx.font = '700 82px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 84);

      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthTest: false,
          depthWrite: false,
          transparent: true,
          // Constant size on screen, not in the world.
          //
          // A 3 m-wide world-space sign is a readable plate from across the
          // floor and a wall of colour from three metres away — standing at the
          // foot of the stairs, STAIR and LIFT covered half the building. A
          // wayfinding label wants the opposite behaviour from a wall: the same
          // size wherever you are, so it stays legible far off and stays out of
          // the way close to.
          sizeAttenuation: false,
        }),
      );
      // Drawn after everything else so it is never overpainted by geometry.
      sprite.renderOrder = 10;
      // Fractions of the viewport, at the canvas's 3.2 : 1 aspect.
      sprite.scale.set(0.17, 0.053, 1);
      return sprite;
    };

    /** A column of light marking a spot from across the floor. */
    const makeBeacon = (hex: number, heightM: number): THREE.Mesh => {
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, heightM, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: hex,
          transparent: true,
          opacity: 0.4,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beacon.renderOrder = 9;
      return beacon;
    };

    const addSign = (level: number, object: THREE.Object3D) => {
      signGroup.add(object);
      const list = signsForLevel.get(level);
      if (list) list.push(object);
      else signsForLevel.set(level, [object]);
    };

    const elevationOf = new Map(floors.map((f) => [f.level, f.elevation * MM]));
    const cores = transportPoints(floors);

    for (const core of cores) {
      const base = elevationOf.get(core.level) ?? 0;
      const sign = makeSign(
        core.kind === 'stair' ? 'STAIRS' : 'LIFT',
        core.kind === 'stair' ? '#1d7a3f' : '#0f5f9e',
        '#ffffff',
      );
      sign.position.set(core.at.x * MM, base + 2.35, -core.at.y * MM);
      addSign(core.level, sign);
      nearHide.push({ object: sign, at: core.at });

      const beacon = makeBeacon(core.kind === 'stair' ? 0x39d97a : 0x4fb8ff, 2.6);
      beacon.position.set(core.at.x * MM, base + 1.3, -core.at.y * MM);
      addSign(core.level, beacon);
      nearHide.push({ object: beacon, at: core.at });
    }

    // ---- The way in ------------------------------------------------------
    // The entrance gets a sign on both sides of the door — one facing the
    // street so you can find the building, one inside so you can find your way
    // back out — and a mat on the ground, because from an orbit view a sign
    // edge-on is a line and the mat is what you actually see.
    const entranceList = findEntrances(floors);
    const mainEntrance = entranceList[0];
    const entranceSigns: THREE.Object3D[] = [];
    const addEntranceSign = (object: THREE.Object3D) => {
      signGroup.add(object);
      entranceSigns.push(object);
    };
    for (const entrance of entranceList.slice(0, 3)) {
      const base = elevationOf.get(entrance.level) ?? 0;
      const isMain = entrance === mainEntrance;
      const sign = makeSign(
        isMain ? 'ENTRANCE' : 'EXIT',
        isMain ? '#b8860b' : '#8e2f2c',
        '#ffffff',
      );
      if (isMain) sign.scale.set(0.24, 0.075, 1);
      sign.position.set(entrance.at.x * MM, base + 2.9, -entrance.at.y * MM);
      addEntranceSign(sign);
      nearHide.push({ object: sign, at: entrance.at });

      const outside = {
        x: entrance.at.x - entrance.inward.x * 1400,
        y: entrance.at.y - entrance.inward.y * 1400,
      };
      const mat = new THREE.Mesh(
        new THREE.PlaneGeometry((entrance.widthMm + 1200) * MM, 2600 * MM),
        new THREE.MeshBasicMaterial({
          color: isMain ? 0xe6a72c : 0xd05a55,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      mat.rotation.x = -Math.PI / 2;
      mat.rotation.z = Math.atan2(entrance.inward.x, entrance.inward.y);
      mat.position.set(outside.x * MM, base + 0.02, -outside.y * MM);
      addEntranceSign(mat);

      // A frame round the opening itself, so the doorway reads as a doorway
      // from outside rather than as a slightly darker patch of wall.
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry((entrance.widthMm + 300) * MM, 2.6, 0.12),
        new THREE.MeshBasicMaterial({
          color: isMain ? 0xffc14d : 0xff6f6a,
          transparent: true,
          opacity: 0.28,
        }),
      );
      frame.position.set(entrance.at.x * MM, base + 1.3, -entrance.at.y * MM);
      frame.rotation.y = Math.atan2(entrance.inward.x, entrance.inward.y);
      addEntranceSign(frame);
    }

    // ---- Lift cars, one per shaft ----------------------------------------
    // Landings within two metres of each other on different floors are the same
    // shaft. One car is built for it and parked at its lowest landing; the ride
    // below moves that car, so from outside the building you watch it travel.
    const shafts: Shaft[] = [];
    for (const core of cores) {
      if (core.kind !== 'lift') continue;
      const existing = shafts.find((s) => Math.hypot(s.at.x - core.at.x, s.at.y - core.at.y) < 2000);
      if (existing) {
        (existing.levels as number[]).push(core.level);
        continue;
      }
      shafts.push({ at: core.at, levels: [core.level], car: new THREE.Group(), current: core.level });
    }

    const carShell = new THREE.MeshStandardMaterial({
      color: 0xb9c2cc,
      roughness: 0.25,
      metalness: 0.65,
      side: THREE.DoubleSide,
    });
    for (const shaft of shafts) {
      (shaft.levels as number[]).sort((a, b) => a - b);
      shaft.current = shaft.levels[0]!;

      const w = 1.6;
      const d = 1.8;
      const h = 2.2;
      // Floor, ceiling, three walls: the fourth side (+Z, which is the doorway
      // wall in plan) is left open, so the car reads as something you step into
      // rather than a solid block.
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.06, d),
        new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.85 }),
      );
      plate.position.y = 0.03;
      shaft.car.add(plate);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), carShell);
      roof.position.y = h;
      shaft.car.add(roof);
      for (const [x, z, rot] of [
        [0, -d / 2, 0],
        [-w / 2, 0, Math.PI / 2],
        [w / 2, 0, Math.PI / 2],
      ] as const) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(rot === 0 ? w : d, h), carShell);
        panel.position.set(x, h / 2, z);
        panel.rotation.y = rot;
        shaft.car.add(panel);
      }

      // A handrail on the back wall. Without it the interior is three untextured
      // planes, and a flat grey field at arm's length is indistinguishable from
      // a rendering failure — which is exactly how it read before.
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, w * 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.2, metalness: 0.8 }),
      );
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 0.95, -d / 2 + 0.07);
      shaft.car.add(rail);

      // The car light, so you can tell from outside which floor the car is on.
      const lamp = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.7, d * 0.7),
        new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.9 }),
      );
      lamp.rotation.x = Math.PI / 2;
      lamp.position.y = h - 0.08;
      shaft.car.add(lamp);

      // And a light that actually lights it. The sun cannot reach inside a
      // shaft, so without this the interior is lit by hemisphere ambient alone
      // and every surface returns the same value: a uniform wash with no edges,
      // no shading and no way to tell you are in a lift at all.
      const bulb = new THREE.PointLight(0xfff0d0, 6, 6, 2);
      bulb.position.set(0, h - 0.2, 0);
      shaft.car.add(bulb);

      shaft.car.position.set(
        shaft.at.x * MM,
        elevationOf.get(shaft.current) ?? 0,
        -shaft.at.y * MM,
      );
      building.add(shaft.car);
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
    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.code);
      // E goes up, Q goes down. Handled on key-down rather than in the movement
      // loop so a single press moves exactly one floor instead of racing up the
      // whole building while the key is held.
      if (modeRef.current !== 'walk') return;
      if (e.code !== 'KeyE' && e.code !== 'KeyQ') return;

      if (rideRef.current) return; // already travelling

      const floor = floors[floorIndexRef.current];
      if (!floor) return;
      const here = { x: walkPos.x / MM, y: -walkPos.z / MM };
      const core = transportNear(here, floor.level, coresRef.current);
      if (!core) return;

      const targetLevel = core.level + (e.code === 'KeyE' ? 1 : -1);
      const landing = landingFor(core, targetLevel, coresRef.current);
      if (!landing) return;

      const targetIndex = floors.findIndex((f) => f.level === targetLevel);
      if (targetIndex < 0) return;

      // ---- Ride it, do not teleport ----------------------------------------
      // Snapping between floors made the lift indistinguishable from a cheat
      // key. Travelling takes the time it takes: the car moves, you move with
      // it, and the floor you arrive on is the one the doors open onto.
      const fromY = (floor.elevation ?? 0) * MM;
      const toY = (floors[targetIndex]!.elevation ?? 0) * MM;
      const shaft =
        core.kind === 'lift'
          ? shafts.find((s) => Math.hypot(s.at.x - core.at.x, s.at.y - core.at.y) < 2000) ?? null
          : null;

      rideRef.current = {
        kind: core.kind,
        shaft,
        fromIndex: floorIndexRef.current,
        toIndex: targetIndex,
        fromY,
        toY,
        at: core.kind === 'lift' ? core.at : landing.at,
        startedAt: performance.now(),
        travelS:
          core.kind === 'lift'
            ? Math.max(LIFT_MIN_TRAVEL_S, Math.abs(toY - fromY) / LIFT_SPEED_M_PER_S)
            : STAIR_CLIMB_S,
      };
    };
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
    /**
     * How deep the walker is inside the worst wall at this point, and which one.
     *
     * Only the DEEPEST overlap is returned, because resolving every wall in one
     * sweep is what made walking through an imported building impossible. The old
     * loop pushed out of each wall in turn, so a walker in a corner was shoved
     * out of wall A into wall B, out of B back into A, and ended the frame
     * somewhere neither of them agreed on. In a traced plan — hundreds of wall
     * fragments, many of them overlapping — that reliably ended with the camera
     * wedged inside geometry with no way out.
     */
    const worstOverlap = (p: THREE.Vector2, level: number) => {
      let worst: { push: THREE.Vector2; depth: number } | null = null;
      for (const seg of wallSegments) {
        if (seg.level !== level) continue;
        const ab = new THREE.Vector2().subVectors(seg.b, seg.a);
        const lenSq = ab.lengthSq();
        // A fragment shorter than a doorway is trace noise, not an obstacle.
        // Colliding with them turns a floor into a minefield of invisible posts.
        if (lenSq < MIN_OBSTACLE_MM * MIN_OBSTACLE_MM) continue;
        let t = new THREE.Vector2().subVectors(p, seg.a).dot(ab) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closest = new THREE.Vector2().copy(seg.a).addScaledVector(ab, t);
        const away = new THREE.Vector2().subVectors(p, closest);
        const dist = away.length();
        const minDist = seg.halfThickness + COLLISION_RADIUS_MM;
        if (dist >= minDist) continue;
        const depth = minDist - dist;
        if (worst !== null && depth <= worst.depth) continue;
        // Dead centre on the line gives no direction to push in; use the wall's
        // normal rather than dividing by zero.
        const push =
          dist > 1
            ? away.clone().multiplyScalar(depth / dist)
            : new THREE.Vector2(-ab.y, ab.x).normalize().multiplyScalar(depth);
        worst = { push, depth };
      }
      return worst;
    };

    /**
     * Push the walker out of whatever it has walked into.
     *
     * Returns false when it could not be resolved — the caller then leaves the
     * walker where it was instead of committing a move into a wall, which is
     * what turns "you cannot walk here" into "you are stuck here forever".
     */
    const resolveCollisions = (position: THREE.Vector3, level: number): boolean => {
      const p = new THREE.Vector2(position.x / MM, -position.z / MM);
      for (let attempt = 0; attempt < 4; attempt++) {
        const worst = worstOverlap(p, level);
        if (!worst) {
          position.x = p.x * MM;
          position.z = -p.y * MM;
          return true;
        }
        p.add(worst.push);
      }
      return false;
    };

    /**
     * Which storeys and which signs are on screen.
     *
     * "Isolate" is the answer to looking at a nine-storey stack and being able
     * to read none of it: everything but the selected storey is hidden, so the
     * floor you picked is the floor you see, on its own, from any angle. It is
     * one function rather than three because floor visibility, sign visibility
     * and the entrance markers all have to agree — a LIFT sign floating over a
     * hidden storey is worse than no sign.
     */
    /** Hide any through-wall marker the camera is standing inside. */
    const hideMarkersUnderfoot = (position: THREE.Vector3) => {
      if (!signsRef.current) return;
      const here = { x: position.x / MM, y: -position.z / MM };
      for (const marker of nearHide) {
        if (!marker.object.visible && marker.object.userData.nearHidden !== true) continue;
        const close = Math.hypot(marker.at.x - here.x, marker.at.y - here.y) * MM < HIDE_WITHIN_M;
        // Remember that *this* rule hid it, so the floor rule can still show it
        // again when you walk away — and cannot be overridden by it either.
        if (close) {
          marker.object.visible = false;
          marker.object.userData.nearHidden = true;
        } else if (marker.object.userData.nearHidden === true) {
          marker.object.userData.nearHidden = false;
          marker.object.visible = true;
        }
      }
    };

    const applyFloorVisibility = () => {
      const selected = floors[floorIndexRef.current];
      const only = isolateRef.current ? selected?.level : undefined;

      for (const [level, group] of floorGroups) {
        group.visible = only === undefined || level === only;
      }
      for (const shaft of shafts) {
        // The car is hidden with its storey only when isolating; otherwise it
        // travels the full height of the building and belongs to all of them.
        shaft.car.visible = only === undefined || shaft.levels.includes(only);
      }

      const signsOn = signsRef.current;
      // Signs for the storey you are on. Showing all nine at once — and they
      // draw through walls — turns the model into a wall of labels.
      for (const [level, list] of signsForLevel) {
        for (const object of list) object.visible = signsOn && level === selected?.level;
      }
      for (const object of entranceSigns) {
        object.visible =
          signsOn && (only === undefined || only === (mainEntrance?.level ?? 0));
      }
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

      // ---- Cinematics -----------------------------------------------------
      // Both run only in orbit mode: interrupting someone who is walking the
      // building by taking the camera off them would be worse than useless.
      const cine = cinematicRef.current;
      if (cine.kind === 'none') {
        cine.startedAt = 0;
        for (const [, group] of floorGroups) group.position.y = 0;
        applyFloorVisibility();
      } else if (modeRef.current === 'orbit') {
        // Wall clock, not accumulated `dt`.
        //
        // `dt` is deliberately clamped so that a stalled frame cannot teleport a
        // walker through a wall — right for movement, wrong for a timed
        // animation. Accumulating a clamped step makes the duration depend on
        // frame rate: on a machine rendering at 10 fps a 3-second sequence takes
        // three times as long and looks broken. Reading the clock directly makes
        // it take three seconds everywhere, however many frames that is.
        if (cine.startedAt === 0) cine.startedAt = now;
        cine.elapsed = (now - cine.startedAt) / 1000;

        if (cine.kind === 'assemble') {
          const levels = [...floorGroups.keys()].sort((a, b) => a - b);
          levels.forEach((level, index) => {
            const group = floorGroups.get(level)!;
            const start = index * ASSEMBLE_STAGGER_S;
            const t = Math.max(0, Math.min(1, (cine.elapsed - start) / ASSEMBLE_RISE_S));
            // Cubic ease-out: fast away, settling gently, which reads as weight
            // rather than as a linear slide.
            const eased = 1 - Math.pow(1 - t, 3);
            // Each storey drops in from a height proportional to its own level,
            // so the whole stack separates before it closes up.
            const dropFrom = (index + 1) * 6;
            group.position.y = (1 - eased) * dropFrom;
            group.visible = t > 0;
          });

          const total = (levels.length - 1) * ASSEMBLE_STAGGER_S + ASSEMBLE_RISE_S + 1.2;
          if (cine.elapsed > total) {
            // Settle exactly, then stop: an animation that ends near-but-not-at
            // its target leaves the model a few centimetres out of place.
            for (const [, group] of floorGroups) group.position.y = 0;
            applyFloorVisibility();
            cinematicRef.current.kind = 'none';
            setCinematic('none');
          }
        }

        if (cine.kind === 'flyaround') {
          const angle = (cine.elapsed / FLYAROUND_PERIOD_S) * Math.PI * 2;
          const radius = Math.max(spanX, spanY, 30) * 1.15;
          camera.position.set(
            target.x + Math.sin(angle) * radius,
            target.y + Math.max(spanX, spanY, 30) * 0.55,
            target.z + Math.cos(angle) * radius,
          );
          camera.lookAt(target);
        }
      }

      if (modeRef.current === 'walk') {
        // A pending floor change, requested by the E or Q key handler.
        const jump = teleportRef.current;
        if (jump) {
          teleportRef.current = null;
          setFloorIndex(jump.level);
          floorIndexRef.current = jump.level;
          walkPos.x = jump.at.x * MM;
          walkPos.z = -jump.at.y * MM;
          applyFloorVisibility();
        }

        // ---- Standing at the front door ------------------------------------
        if (goToEntranceRef.current) {
          goToEntranceRef.current = false;
          const entrance = entrancesRef.current[0];
          if (entrance) {
            const index = floors.findIndex((f) => f.level === entrance.level);
            if (index >= 0) {
              setFloorIndex(index);
              floorIndexRef.current = index;
            }
            const spot = justInside(entrance);
            walkPos.x = spot.x * MM;
            walkPos.z = -spot.y * MM;
            // Face into the building rather than at the door you just came
            // through. Scene Z is -plan Y, so the plan's inward vector becomes
            // this yaw.
            yaw = Math.atan2(entrance.inward.x, -entrance.inward.y);
            pitch = 0;
            applyFloorVisibility();
          }
        }

        // ---- Standing in the stair or the lift -----------------------------
        // "Where are the stairs?" is not a question you should have to answer by
        // wandering a nine-storey model. The sign says where they are; this
        // stands you in them.
        const wanted = goToCoreRef.current;
        if (wanted) {
          goToCoreRef.current = null;
          const floor = floors[floorIndexRef.current];
          const core =
            coresRef.current.find((c) => c.kind === wanted && c.level === floor?.level) ??
            coresRef.current.find((c) => c.kind === wanted);
          if (core) {
            const index = floors.findIndex((f) => f.level === core.level);
            if (index >= 0) {
              setFloorIndex(index);
              floorIndexRef.current = index;
            }
            walkPos.x = core.at.x * MM;
            // In a lift you stand in the middle of the car. On a stair you stand
            // at the bottom of the flight, not half way up it — the centre of a
            // stair core is inside the treads, which puts the camera in the
            // middle of a staircase looking at the underside of a step.
            const halfDepth = core.radiusMm - 900;
            const y = core.kind === 'stair' ? core.at.y - halfDepth + 900 : core.at.y;
            walkPos.z = -y * MM;
            // Face the way the core is used, not wherever you happened to be
            // looking. A core's doorway is on its low-y wall, which is scene +Z,
            // so yaw 0 looks out of the lift; a stair flight runs the other way,
            // so yaw π looks up it. Arriving nose-first against a blank panel
            // makes a working lift look like a rendering failure.
            yaw = core.kind === 'lift' ? 0 : Math.PI;
            pitch = core.kind === 'stair' ? 0.25 : 0;
            applyFloorVisibility();
          }
        }

        // ---- A ride in progress --------------------------------------------
        // While travelling, the walker is a passenger: WASD does nothing, the
        // camera is carried, and the floor index changes when the doors open —
        // not when the button was pressed.
        const ride = rideRef.current;
        if (ride) {
          const elapsed = (now - ride.startedAt) / 1000;
          const doorS = ride.kind === 'lift' ? LIFT_DOOR_S : 0;
          const total = doorS + ride.travelS + doorS;
          const travelT = Math.max(0, Math.min(1, (elapsed - doorS) / ride.travelS));
          // Ease in and out: a lift accelerates away and decelerates in, and a
          // linear ramp is the one thing that reads as fake.
          const eased = travelT < 0.5 ? 2 * travelT * travelT : 1 - Math.pow(-2 * travelT + 2, 2) / 2;
          const y = ride.fromY + (ride.toY - ride.fromY) * eased;

          if (ride.shaft) ride.shaft.car.position.y = y;
          walkPos.x = ride.at.x * MM;
          walkPos.z = -ride.at.y * MM;
          walkPos.y = y + EYE_HEIGHT_MM * MM;

          if (sunFrame % 6 === 0) {
            setRiding(
              ride.kind === 'lift'
                ? elapsed < doorS
                  ? 'Doors closing…'
                  : travelT < 1
                    ? `Lift — ${floors[ride.toIndex]?.name ?? ''}`
                    : 'Doors opening…'
                : `Climbing to ${floors[ride.toIndex]?.name ?? ''}`,
            );
          }

          if (elapsed >= total) {
            if (ride.shaft) ride.shaft.current = floors[ride.toIndex]?.level ?? ride.shaft.current;
            rideRef.current = null;
            setRiding('');
            setFloorIndex(ride.toIndex);
            floorIndexRef.current = ride.toIndex;
            applyFloorVisibility();
          }

          hideMarkersUnderfoot(walkPos);
          camera.position.copy(walkPos);
          camera.lookAt(
            walkPos.x + Math.sin(yaw) * Math.cos(pitch),
            walkPos.y + Math.sin(pitch),
            walkPos.z + Math.cos(yaw) * Math.cos(pitch),
          );
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
          return;
        }

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

          if (ghostRef.current) {
            walkPos.add(move);
          } else {
            const from = walkPos.clone();
            const level = floor?.level ?? 0;
            const stuckToStart =
              worstOverlap(new THREE.Vector2(from.x / MM, -from.z / MM), level) !== null;

            walkPos.add(move);
            if (!resolveCollisions(walkPos, level) && !stuckToStart) {
              // The move ended somewhere unresolvable and the walker was fine
              // where it started, so refuse the move rather than commit to it.
              walkPos.copy(from);
            }

            // Already inside something when the frame began — a spawn point in a
            // wall, or geometry that overlaps itself, both of which a traced plan
            // produces. Moving is the only way out, so it is allowed, and the
            // prompt below offers the way out that always works.
            stuckRef.current = stuckToStart;
          }
        }
        walkPos.y = elevation + EYE_HEIGHT_MM * MM;

        if (sunFrame % 6 === 0 && stuck !== stuckRef.current) setStuck(stuckRef.current);

        // Offer the core the walker is standing in, and only the directions
        // that actually lead somewhere.
        if (sunFrame % 6 === 0) {
          const here = { x: walkPos.x / MM, y: -walkPos.z / MM };
          const core = transportNear(here, floor?.level ?? 0, coresRef.current);
          if (core) {
            const up = coresRef.current.some((p) => p.kind === core.kind && p.level === core.level + 1);
            const down = coresRef.current.some((p) => p.kind === core.kind && p.level === core.level - 1);
            setPrompt(up || down ? { label: core.name, up, down } : null);
          } else {
            setPrompt(null);
          }
        }

        hideMarkersUnderfoot(walkPos);
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

    const stairCount = new Set(cores.filter((c) => c.kind === 'stair').map((c) => c.level)).size;
    setStatus(
      `${floors.length} floor(s), ${floors.reduce((n, f) => n + f.rooms.length, 0)} rooms, ` +
        `${floors.reduce((n, f) => n + f.walls.length, 0)} walls, ` +
        `${furnitureMeshes.length} furniture item(s) from the design layer. ` +
        (shafts.length > 0
          ? `${shafts.length} lift shaft(s) and a stair on ${stairCount} storey(s) — walk into one and press E or Q to ride it.`
          : 'No stair or lift is modelled, so the walkthrough cannot change floor.'),
    );

    // Expose the toggles to the outer component without rebuilding the scene.
    const applyVisibility = (ceilings: boolean, furniture: boolean) => {
      for (const m of ceilingMeshes) m.visible = ceilings;
      for (const m of furnitureMeshes) m.visible = furniture;
    };
    visibilityRef.current = applyVisibility;
    applyVisibility(showCeilings, showFurniture);
    refreshRef.current = applyFloorVisibility;
    applyFloorVisibility();

    return () => {
      cacheFrame('model');
      registerCanvas('model', null);
      visibilityRef.current = null;
      refreshRef.current = null;
      rideRef.current = null;
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

  /** Re-apply floor isolation and signage without rebuilding the scene. */
  const refreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    refreshRef.current?.();
  }, [isolate, showSigns, floorIndex]);

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

        {floors.length > 1 && (
          <>
            <label>Floor — one click</label>
            <div className="floor-buttons">
              {[...floors]
                .map((f, i) => ({ f, i }))
                .reverse()
                .map(({ f, i }) => (
                  <button
                    key={f.id}
                    className={i === floorIndex ? 'primary' : 'ghost'}
                    onClick={() => {
                      setFloorIndex(i);
                      // In walk mode, land on that floor's core rather than
                      // hanging in space wherever the previous floor left you.
                      const core = coresRef.current.find((p) => p.level === floors[i]!.level);
                      if (core) teleportRef.current = { level: i, at: core.at };
                    }}
                    title={f.purpose ?? f.name}
                  >
                    {f.level === 0 ? 'G' : f.level > 0 ? String(f.level) : `B${Math.abs(f.level)}`}
                  </button>
                ))}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {floors[floorIndex]?.name}
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={isolate}
                onChange={(e) => setIsolate(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <span className="small">Only this floor</span>
            </label>
            <div className="small muted">
              {isolate
                ? `Showing ${floors[floorIndex]?.name ?? 'one storey'} on its own. Every other storey is hidden.`
                : 'The whole stack is shown. Tick to read one storey at a time.'}
            </div>
          </>
        )}

        <label style={{ marginTop: 10 }}>Presentation</label>
        <div className="row">
          <button
            className={cinematic === 'assemble' ? 'primary' : 'ghost'}
            onClick={() => {
              // Restarting means restarting: reset the clock, or pressing it a
              // second time would resume a finished animation and do nothing.
              cinematicRef.current.startedAt = 0;
              setMode('orbit');
              setCinematic(cinematic === 'assemble' ? 'none' : 'assemble');
            }}
            title="Raise the storeys into place, one after another"
          >
            Assemble
          </button>
          <button
            className={cinematic === 'flyaround' ? 'primary' : 'ghost'}
            onClick={() => {
              cinematicRef.current.startedAt = 0;
              setMode('orbit');
              setCinematic(cinematic === 'flyaround' ? 'none' : 'flyaround');
            }}
            title="Orbit the building slowly, for a walk-round without dragging"
          >
            Fly around
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {cinematic === 'assemble'
            ? 'Building the stack…'
            : cinematic === 'flyaround'
              ? 'Orbiting — drag or switch to Walk to take back control.'
              : 'Presentation only; neither changes the model.'}
        </div>

        <label style={{ marginTop: 10 }}>Finding your way</label>
        <div className="row">
          <button
            className="ghost"
            disabled={entrances.length === 0}
            onClick={() => {
              setMode('walk');
              goToEntranceRef.current = true;
            }}
            title={
              entrances.length > 0
                ? `Stand just inside the main entrance, facing in — ${entrances[0]!.basis}`
                : 'No door on the perimeter of the lowest storey, so there is no entrance to go to'
            }
          >
            Go to entrance
          </button>
          <button
            className="ghost"
            disabled={!cores.some((c) => c.kind === 'stair')}
            onClick={() => {
              setMode('walk');
              goToCoreRef.current = 'stair';
            }}
            title="Stand in the staircase. Press E to go up, Q to go down."
          >
            Go to stairs
          </button>
          <button
            className="ghost"
            disabled={!cores.some((c) => c.kind === 'lift')}
            onClick={() => {
              setMode('walk');
              goToCoreRef.current = 'lift';
            }}
            title="Stand in the lift car. Press E to go up, Q to go down — it takes the time it takes."
          >
            Go to lift
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {entrances.length > 0
            ? `${entrances.length} way(s) in. The widest is marked ENTRANCE; the rest are marked EXIT.`
            : 'No entrance could be identified: no door sits on the perimeter of the lowest storey.'}
        </div>

        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={ghost}
            onChange={(e) => setGhost(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span className="small">Walk through walls</span>
        </label>
        <div className="small muted">
          {ghost
            ? 'Walls are not solid. Use this to get out of anywhere you are stuck.'
            : 'Walls are solid. Tick this if a room traps you — an imported plan’s walls are ' +
              'approximate, and some of them overlap.'}
        </div>

        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={showSigns}
            onChange={(e) => setShowSigns(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span className="small">Show signs (STAIRS, LIFT, ENTRANCE)</span>
        </label>

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
              {cores.length > 0 && (
                <>
                  {' '}
                  Stand in a staircase or lift and press <kbd>E</kbd> to go up or <kbd>Q</kbd> to go
                  down.
                </>
              )}
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

      {stuck && mode === 'walk' && !ghost && !riding && (
        <div className="transport-prompt" style={{ borderColor: 'var(--err)' }}>
          <strong>You are inside a wall</strong>
          <div className="small" style={{ marginTop: 4 }}>
            Tick <em>Walk through walls</em> to step out, or use <em>Go to entrance</em>.
          </div>
        </div>
      )}

      {riding && mode === 'walk' && (
        <div className="transport-prompt">
          <strong>{riding}</strong>
        </div>
      )}

      {prompt && mode === 'walk' && !riding && (
        <div className="transport-prompt">
          <strong>{prompt.label}</strong>
          <div className="small" style={{ marginTop: 4 }}>
            {prompt.up && (
              <>
                <kbd>E</kbd> go up
              </>
            )}
            {prompt.up && prompt.down && <span className="muted"> · </span>}
            {prompt.down && (
              <>
                <kbd>Q</kbd> go down
              </>
            )}
          </div>
        </div>
      )}

      <div className="overlay bl">
        <div className="small mono">{totalArea.toFixed(0)} sq ft gross</div>
        <div className="small muted" style={{ marginTop: 4, maxWidth: 360 }}>
          {status}
        </div>
      </div>
    </div>
  );
}
