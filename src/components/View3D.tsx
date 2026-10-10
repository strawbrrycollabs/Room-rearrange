import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { activeLayout, useRoom, useStore } from '../store';
import { bounds, findProblems, itemCorners, pointInPolygon, rad, snapItem, walls, type Wall } from '../geometry';
import type { Furniture, Pt, Room } from '../types';
import { register3dCapture } from '../capture3d';

const WALL_T = 10;
const EYE = 160;

const PALETTE = {
  light: { bg: '#eef0f3', floor: '#e6e1d8', wall: '#f6f5f2', accent: '#4f46e5' },
  dark: { bg: '#0f1115', floor: '#2b2f37', wall: '#474d59', accent: '#8b87ff' },
};

export type Joy = { x: number; y: number };

export default function View3D({ walk, dark }: { walk: boolean; dark: boolean }) {
  const room = useRoom()!;
  const joy = useRef<Joy>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const b = useMemo(() => bounds(room.corners), [room.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = Math.max(b.w, b.h);
  // Back the camera off on narrow (portrait) screens so the whole room fits.
  const camK = 1.3 * Math.max(1, 1 / ((innerWidth / innerHeight) * 1.2));
  const pal = dark ? PALETTE.dark : PALETTE.light;

  return (
    <div className="canvas-wrap">
      <Canvas
        key={room.id}
        shadows
        dpr={[1, 2]}
        camera={{ fov: 50, near: 5, far: 20000, position: [b.minX + b.w / 2, size * camK, b.minY + b.h / 2 + size * (camK + 0.1)] }}
        onPointerMissed={() => !walk && useStore.getState().select(null)}
        style={{ touchAction: 'none' }}
      >
        <color attach="background" args={[pal.bg]} />
        <hemisphereLight args={['#ffffff', dark ? '#222530' : '#b9b4aa', dark ? 0.7 : 1.0]} />
        <directionalLight
          castShadow
          intensity={dark ? 1.1 : 1.6}
          position={[b.minX + b.w / 2 + size * 0.4, size * 1.5, b.minY + b.h / 2 + size * 0.3]}
          target-position={[b.minX + b.w / 2, 0, b.minY + b.h / 2]}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size}
          shadow-camera-near={10} shadow-camera-far={size * 5}
          shadow-bias={-0.0004}
        />
        <CaptureBridge />
        <Shell room={room} walk={walk} pal={pal} />
        <Furnishings room={room} interactive={!walk} setDragging={setDragging} accent={pal.accent} />
        {walk ? (
          <Walk room={room} joy={joy} />
        ) : (
          <OrbitControls
            makeDefault
            enabled={!dragging}
            target={[b.minX + b.w / 2, 0, b.minY + b.h / 2]}
            maxPolarAngle={Math.PI / 2 - 0.03}
            minDistance={60}
            maxDistance={size * 4}
            enableDamping
          />
        )}
      </Canvas>
      {walk && <Joystick joy={joy} />}
    </div>
  );
}

function CaptureBridge() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    register3dCapture(() => { gl.render(scene, camera); return gl.domElement.toDataURL('image/png'); });
    return () => register3dCapture(null);
  }, [gl, scene, camera]);
  return null;
}

/* ---------------- Room shell: floor, walls, openings ---------------- */

function Shell({ room, walk, pal }: { room: Room; walk: boolean; pal: typeof PALETTE.light }) {
  const floorGeo = useMemo(() => {
    const s = new THREE.Shape(room.corners.map((p) => new THREE.Vector2(p.x, p.y)));
    return new THREE.ShapeGeometry(s);
  }, [room.corners]);
  const ws = useMemo(() => walls(room.corners), [room.corners]);
  const n = ws.length;
  return (
    <group>
      <mesh geometry={floorGeo} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color={pal.floor} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {ws.map((w) => {
        const prev = ws[(w.index - 1 + n) % n];
        const next = ws[(w.index + 1) % n];
        const convex = (a: Wall, b: Wall) => a.dir.x * b.dir.y - a.dir.y * b.dir.x > 0;
        return (
          <WallMesh
            key={w.index}
            room={room}
            wall={w}
            ext0={convex(prev, w) ? WALL_T : 0}
            ext1={convex(w, next) ? WALL_T : 0}
            walk={walk}
            color={pal.wall}
          />
        );
      })}
    </group>
  );
}

function WallMesh({ room, wall, ext0, ext1, walk, color }: { room: Room; wall: Wall; ext0: number; ext1: number; walk: boolean; color: string }) {
  const H = room.ceilingHeight;
  const L = wall.length;
  const openings = room.openings.filter((o) => o.wall === wall.index);
  const sig = JSON.stringify([openings, H, L, ext0, ext1]);
  const geo = useMemo(() => {
    const total = L + ext0 + ext1;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(total, 0); shape.lineTo(total, H); shape.lineTo(0, H); shape.closePath();
    for (const o of openings) {
      if (o.kind === 'radiator') continue;
      const u0 = ext0 + o.offset, u1 = u0 + o.width;
      const v0 = Math.max(0, o.sill), v1 = Math.min(H - 1, o.sill + o.height);
      if (v1 <= v0 + 1) continue;
      const hole = new THREE.Path();
      hole.moveTo(u0, v0); hole.lineTo(u1, v0); hole.lineTo(u1, v1); hole.lineTo(u0, v1); hole.closePath();
      shape.holes.push(hole);
    }
    return new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => () => geo.dispose(), [geo]);

  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const deco = useRef<THREE.Group>(null);
  const mid = useMemo(() => new THREE.Vector3(wall.a.x + wall.dir.x * L / 2, 0, wall.a.y + wall.dir.y * L / 2), [wall, L]);
  useFrame(({ camera }) => {
    const facing = (camera.position.x - mid.x) * wall.normal.x + (camera.position.z - mid.z) * wall.normal.y;
    const hidden = !walk && facing < 0;
    if (mat.current) { mat.current.opacity = hidden ? 0.07 : 1; mat.current.depthWrite = !hidden; }
    if (deco.current) deco.current.visible = !hidden;
  });

  return (
    <group position={[wall.a.x, 0, wall.a.y]} rotation={[0, -rad(wall.angle), 0]}>
      <group position={[-ext0, 0, 0]}>
        <mesh geometry={geo} position={[0, 0, -WALL_T]} receiveShadow>
          <meshStandardMaterial ref={mat} color={color} roughness={0.95} transparent />
        </mesh>
      </group>
      <group ref={deco}>
        {openings.map((o) => <Opening key={o.id} o={o} H={H} />)}
      </group>
    </group>
  );
}

function Opening({ o, H }: { o: Room['openings'][number]; H: number }) {
  const cx = o.offset + o.width / 2;
  const h = Math.min(o.height, H - o.sill - 1);
  if (o.kind === 'radiator') {
    return (
      <mesh position={[cx, o.sill + o.height / 2, 4]} castShadow>
        <boxGeometry args={[o.width, o.height, 8]} />
        <meshStandardMaterial color="#f1f1f1" roughness={0.5} metalness={0.2} />
      </mesh>
    );
  }
  const t = 4; // frame thickness
  const frame = '#d9d6cf';
  const bars: [number, number, number, number][] = [
    [cx, o.sill + t / 2, o.width, t],
    [cx, o.sill + h - t / 2, o.width, t],
    [o.offset + t / 2, o.sill + h / 2, t, h],
    [o.offset + o.width - t / 2, o.sill + h / 2, t, h],
  ];
  if (o.kind === 'window') {
    return (
      <group>
        {bars.map((b, i) => (
          <mesh key={i} position={[b[0], b[1], -WALL_T / 2]}>
            <boxGeometry args={[b[2], b[3], 6]} />
            <meshStandardMaterial color={frame} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[cx, o.sill + h / 2, -WALL_T / 2]}>
          <planeGeometry args={[o.width - 2 * t, h - 2 * t]} />
          <meshStandardMaterial color="#a9d6f0" transparent opacity={0.28} roughness={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>
    );
  }
  return (
    <group>
      {bars.slice(1).map((b, i) => (
        <mesh key={i} position={[b[0], b[1], -WALL_T / 2]}>
          <boxGeometry args={[b[2], b[3], 6]} />
          <meshStandardMaterial color={frame} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[cx, h / 2 - 1, -WALL_T / 2]} castShadow>
        <boxGeometry args={[o.width - 2 * t, h - t - 2, 4]} />
        <meshStandardMaterial color="#c9a77c" roughness={0.6} />
      </mesh>
      <mesh position={[cx + (o.hinge === 'start' ? 1 : -1) * (o.width / 2 - 12), h * 0.45, -WALL_T / 2 + 4]}>
        <sphereGeometry args={[2.5, 12, 12]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

/* ---------------- Furniture ---------------- */

const MATERIAL: Record<Furniture['material'], { roughness: number; metalness: number; opacity?: number }> = {
  matte: { roughness: 0.9, metalness: 0 },
  wood: { roughness: 0.6, metalness: 0.05 },
  metal: { roughness: 0.3, metalness: 0.8 },
  fabric: { roughness: 1, metalness: 0 },
  glass: { roughness: 0.1, metalness: 0.1, opacity: 0.35 },
};

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function Furnishings({ room, interactive, setDragging, accent }: { room: Room; interactive: boolean; setDragging: (v: boolean) => void; accent: string }) {
  const items = activeLayout(room).items;
  const selectedId = useStore((s) => s.selectedId);
  const problems = useMemo(() => findProblems(items, room.corners), [items, room.corners]);
  const drag = useRef<{ id: string; dx: number; dz: number; moved: boolean } | null>(null);
  const hit = useRef(new THREE.Vector3());
  const bb = useMemo(() => bounds(room.corners), [room.corners]);

  const onItemDown = (e: ThreeEvent<PointerEvent>, it: Furniture) => {
    if (!interactive) return;
    e.stopPropagation();
    useStore.getState().select(it.id);
    if (it.locked) return;
    const p = e.ray.intersectPlane(floorPlane, hit.current);
    if (!p) return;
    drag.current = { id: it.id, dx: it.x - p.x, dz: it.y - p.z, moved: false };
    setDragging(true);
  };

  const endDrag = () => { drag.current = null; setDragging(false); };
  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => { window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag); };
  });

  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    const st = useStore.getState();
    const cur = st.rooms.find((r) => r.id === room.id);
    const item = cur && activeLayout(cur).items.find((i) => i.id === d.id);
    if (!item) return;
    if (!d.moved) { d.moved = true; st.checkpoint(); }
    let next = { x: e.point.x + d.dx, y: e.point.z + d.dz, rotation: item.rotation };
    if (!e.nativeEvent.altKey) {
      const sn = snapItem({ ...item, ...next }, activeLayout(cur).items, room.corners, 10);
      next = { x: sn.x, y: sn.y, rotation: sn.rotation };
    }
    st.live((r) => ({
      ...r,
      layouts: r.layouts.map((l) => (l.id === r.activeLayoutId
        ? { ...l, items: l.items.map((i) => (i.id === d.id ? { ...i, x: Math.round(next.x * 10) / 10, y: Math.round(next.y * 10) / 10, rotation: next.rotation } : i)) }
        : l)),
    }));
  };

  return (
    <group>
      {interactive && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bb.minX + bb.w / 2, 0.2, bb.minY + bb.h / 2]} onPointerMove={onFloorMove}>
          <planeGeometry args={[bb.w * 4 + 2000, bb.h * 4 + 2000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {items.map((it) => {
        const p = problems.get(it.id);
        const bad = !!p && (p.overlaps.length > 0 || p.outside);
        return <FurnitureMesh key={it.id} it={it} selected={it.id === selectedId} bad={bad} accent={accent} onDown={(e) => onItemDown(e, it)} />;
      })}
    </group>
  );
}

function FurnitureMesh({ it, selected, bad, accent, onDown }: { it: Furniture; selected: boolean; bad: boolean; accent: string; onDown: (e: ThreeEvent<PointerEvent>) => void }) {
  const m = MATERIAL[it.material];
  const geo = useMemo(() => (it.shape === 'round' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 40) : new THREE.BoxGeometry(1, 1, 1)), [it.shape]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  useEffect(() => () => { geo.dispose(); edges.dispose(); }, [geo, edges]);
  const h = Math.max(it.height, 0.5);
  return (
    <group position={[it.x, h / 2, it.y]} rotation={[0, -rad(it.rotation), 0]} scale={[it.width, h, it.depth]}>
      <mesh geometry={geo} castShadow={!it.flat} receiveShadow onPointerDown={onDown}>
        <meshStandardMaterial
          color={bad ? '#ef4444' : it.color}
          emissive={bad ? '#7f1d1d' : selected ? accent : '#000000'}
          emissiveIntensity={bad ? 0.5 : selected ? 0.25 : 0}
          roughness={m.roughness}
          metalness={m.metalness}
          transparent={m.opacity !== undefined}
          opacity={m.opacity ?? 1}
        />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={selected ? accent : '#000000'} transparent opacity={selected ? 1 : 0.18} />
      </lineSegments>
    </group>
  );
}

/* ---------------- First-person walk ---------------- */

function canStand(p: Pt, room: Room, items: Furniture[]): boolean {
  const r = 22;
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    if (!pointInPolygon({ x: p.x + dx, y: p.y + dz }, room.corners)) return false;
  }
  for (const it of items) {
    if (it.flat) continue;
    if (pointInPolygon(p, itemCorners({ ...it, width: it.width + 30, depth: it.depth + 30 }))) return false;
  }
  return true;
}

function Walk({ room, joy }: { room: Room; joy: React.MutableRefObject<Joy> }) {
  const { camera, gl } = useThree();
  const state = useRef({ yaw: 0, pitch: 0, keys: new Set<string>() });
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const oldFov = cam.fov;
    cam.fov = 72; cam.near = 5; cam.updateProjectionMatrix();
    cam.rotation.order = 'YXZ';
    // Start at the free point nearest the room centre, looking across the room.
    const r = roomRef.current;
    const items = activeLayout(r).items;
    const b = bounds(r.corners);
    let best: Pt = { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
    let bestD = Infinity;
    for (let x = b.minX; x <= b.maxX; x += 20) for (let y = b.minY; y <= b.maxY; y += 20) {
      const d = Math.hypot(x - (b.minX + b.w / 2), y - (b.minY + b.h / 2));
      if (d < bestD && canStand({ x, y }, r, items)) { bestD = d; best = { x, y }; }
    }
    cam.position.set(best.x, EYE, best.y);
    state.current.yaw = 0; state.current.pitch = 0;
    return () => { cam.fov = oldFov; cam.updateProjectionMatrix(); cam.rotation.order = 'XYZ'; };
  }, [camera]);

  useEffect(() => {
    const el = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!last) return;
      state.current.yaw -= (e.clientX - last.x) * 0.005;
      state.current.pitch = Math.max(-1.3, Math.min(1.3, state.current.pitch - (e.clientY - last.y) * 0.005));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => { last = null; };
    const kd = (e: KeyboardEvent) => { if (!(e.target as HTMLElement).closest('input, textarea, select')) state.current.keys.add(e.key.toLowerCase()); };
    const ku = (e: KeyboardEvent) => state.current.keys.delete(e.key.toLowerCase());
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const s = state.current;
    const k = s.keys;
    let f = joy.current.y, r = joy.current.x;
    if (k.has('w') || k.has('arrowup')) f += 1;
    if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('d') || k.has('arrowright')) r += 1;
    if (k.has('a') || k.has('arrowleft')) r -= 1;
    if (k.has('q')) s.yaw += dt * 1.6;
    if (k.has('e')) s.yaw -= dt * 1.6;
    camera.rotation.set(s.pitch, s.yaw, 0);
    if (!f && !r) return;
    const speed = (k.has('shift') ? 320 : 160) * Math.min(dt, 0.05);
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const mx = (-sin * f + cos * r) * speed;
    const mz = (-cos * f - sin * r) * speed;
    const rm = roomRef.current;
    const items = activeLayout(rm).items;
    const p = camera.position;
    if (canStand({ x: p.x + mx, y: p.z + mz }, rm, items)) { p.x += mx; p.z += mz; }
    else if (canStand({ x: p.x + mx, y: p.z }, rm, items)) p.x += mx;
    else if (canStand({ x: p.x, y: p.z + mz }, rm, items)) p.z += mz;
  });
  return null;
}

function Joystick({ joy }: { joy: React.MutableRefObject<Joy> }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const R = 48;
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) { x = (x / d) * R; y = (y / d) * R; }
    setKnob({ x, y });
    joy.current = { x: x / R, y: -y / R };
  };
  const reset = () => { setKnob({ x: 0, y: 0 }); joy.current = { x: 0, y: 0 }; };
  useEffect(() => () => { joy.current = { x: 0, y: 0 }; }, [joy]);
  return (
    <div
      className="joystick"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e) => e.buttons && set(e)}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
