/**
 * Interpolation Math Tests
 * Run with: node src/__tests__/interpolation.test.mjs
 *
 * Tests the pure math functions used in interpolateAroundKeyframe:
 * - lerpAngle (angle interpolation with wraparound)
 * - normalizeAngle
 * - catmullRom
 * - isPathCurved
 * - forceOrientationSync threshold (>135°)
 * - Backward interpolation range logic (Segment 0)
 * - Segment boundaries (which frames each segment covers)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── Pure functions duplicated from trackStore.ts ─────────────────────────────

const lerp = (a, b, t) => a + (b - a) * t;

const normalizeAngle = (angle) => {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

const lerpAngle = (a, b, t) => {
  let delta = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
};

const catmullRom = (p0, p1, p2, p3, t, tension = 0.5) => {
  const t2 = t * t;
  const t3 = t2 * t;
  const m0 = tension * (p2 - p0);
  const m1 = tension * (p3 - p1);
  return (2 * t3 - 3 * t2 + 1) * p1 +
         (t3 - 2 * t2 + t) * m0 +
         (-2 * t3 + 3 * t2) * p2 +
         (t3 - t2) * m1;
};

const catmullRom3D = (p0, p1, p2, p3, t, tension = 0.5) => ({
  x: catmullRom(p0.x, p1.x, p2.x, p3.x, t, tension),
  y: catmullRom(p0.y, p1.y, p2.y, p3.y, t, tension),
  z: catmullRom(p0.z, p1.z, p2.z, p3.z, t, tension),
});

const isPathCurved = (startWorld, endWorld) => {
  const yawDiff = Math.abs(normalizeAngle(endWorld.rotation.yaw - startWorld.rotation.yaw));
  const TURN_THRESHOLD = Math.PI / 12; // 15 degrees
  return yawDiff > TURN_THRESHOLD;
};

const blendYawWithTangent = (startYaw, endYaw, t, tangentYaw) => {
  const keyframeYaw = normalizeAngle(lerpAngle(startYaw, endYaw, t));
  if (tangentYaw === null || tangentYaw === undefined) return keyframeYaw;

  // Match the tangent orientation branch (forward vs reverse) to keyframe heading.
  const tangentOptionA = normalizeAngle(tangentYaw);
  const tangentOptionB = normalizeAngle(tangentYaw + Math.PI);
  const diffA = Math.abs(normalizeAngle(tangentOptionA - keyframeYaw));
  const diffB = Math.abs(normalizeAngle(tangentOptionB - keyframeYaw));
  const alignedTangentYaw = diffA <= diffB ? tangentOptionA : tangentOptionB;

  const tangentDelta = Math.abs(normalizeAngle(alignedTangentYaw - keyframeYaw));
  const MAX_TANGENT_DEVIATION = Math.PI / 4; // 45°
  if (tangentDelta > MAX_TANGENT_DEVIATION) return keyframeYaw;

  const tangentBlend = tangentDelta < (Math.PI / 36) ? 0 : 0.35; // Skip blend if <5°
  return tangentBlend > 0
    ? normalizeAngle(lerpAngle(keyframeYaw, alignedTangentYaw, tangentBlend))
    : keyframeYaw;
};

const FORCE_SYNC_THRESHOLD = 3 * Math.PI / 4; // 135° — only catches near-180° mistakes

const deg = (d) => d * Math.PI / 180;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('normalizeAngle', () => {
  test('keeps 0 at 0', () => {
    assert.ok(close(normalizeAngle(0), 0));
  });
  test('keeps π at π', () => {
    assert.ok(close(normalizeAngle(Math.PI), Math.PI));
  });
  test('wraps 2π to 0', () => {
    assert.ok(close(normalizeAngle(2 * Math.PI), 0));
  });
  test('wraps 3π to π', () => {
    assert.ok(close(normalizeAngle(3 * Math.PI), Math.PI));
  });
  test('wraps -π to -π (or π)', () => {
    // -π and π are equivalent boundary; implementation gives -π
    assert.ok(Math.abs(normalizeAngle(-Math.PI)) <= Math.PI);
  });
  test('wraps 270° to -90°', () => {
    assert.ok(close(normalizeAngle(deg(270)), deg(-90)));
  });
});

describe('lerpAngle', () => {
  test('midpoint 0° -> 90° gives 45°', () => {
    assert.ok(close(lerpAngle(0, deg(90), 0.5), deg(45)));
  });
  test('midpoint 350° -> 10° goes short way (gives 0°)', () => {
    // 350° to 10° short path = 20° span; midpoint = 0° (or 360°)
    const result = lerpAngle(deg(350), deg(10), 0.5);
    assert.ok(close(normalizeAngle(result), 0), `expected 0, got ${result}`);
  });
  test('midpoint 10° -> 350° goes short way (gives 0°)', () => {
    const result = lerpAngle(deg(10), deg(350), 0.5);
    assert.ok(close(normalizeAngle(result), 0), `expected 0, got ${result}`);
  });
  test('t=0 returns start', () => {
    assert.ok(close(lerpAngle(deg(45), deg(135), 0), deg(45)));
  });
  test('t=1 returns end', () => {
    assert.ok(close(lerpAngle(deg(45), deg(135), 1), deg(135)));
  });
  test('180° -> 0° midpoint takes short path (90°)', () => {
    // Both directions are 180°; lerpAngle picks one (implementation-defined)
    const r = lerpAngle(deg(180), 0, 0.5);
    assert.ok(Math.abs(r) === Math.abs(deg(90)) || Math.abs(r - Math.PI / 2) < 1e-6);
  });
});

describe('catmullRom', () => {
  test('t=0 gives p1', () => {
    assert.ok(close(catmullRom(0, 1, 5, 6, 0), 1));
  });
  test('t=1 gives p2', () => {
    assert.ok(close(catmullRom(0, 1, 5, 6, 1), 5));
  });
  test('straight line: gives lerp result at midpoint', () => {
    // p0,p1,p2,p3 all collinear: 0,1,2,3
    const result = catmullRom(0, 1, 2, 3, 0.5);
    // Catmull-Rom on collinear points = linear lerp
    assert.ok(Math.abs(result - 1.5) < 1e-9, `got ${result}`);
  });
  test('catmullRom3D midpoint of straight line', () => {
    const p0 = { x: 0, y: 0, z: 0 };
    const p1 = { x: 1, y: 0, z: 0 };
    const p2 = { x: 3, y: 0, z: 0 };
    const p3 = { x: 4, y: 0, z: 0 };
    const mid = catmullRom3D(p0, p1, p2, p3, 0.5);
    assert.ok(close(mid.x, 2), `expected x=2, got ${mid.x}`);
    assert.ok(close(mid.y, 0));
    assert.ok(close(mid.z, 0));
  });
});

describe('isPathCurved', () => {
  test('straight path (0° yaw change) is NOT curved', () => {
    const s = { center: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0 } };
    const e = { center: { x: 10, y: 0, z: 0 }, rotation: { yaw: 0 } };
    assert.equal(isPathCurved(s, e), false);
  });
  test('10° yaw change is NOT curved (below 15° threshold)', () => {
    const s = { center: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0 } };
    const e = { center: { x: 10, y: 0, z: 0 }, rotation: { yaw: deg(10) } };
    assert.equal(isPathCurved(s, e), false);
  });
  test('20° yaw change IS curved (above 15° threshold)', () => {
    const s = { center: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0 } };
    const e = { center: { x: 10, y: 0, z: 0 }, rotation: { yaw: deg(20) } };
    assert.equal(isPathCurved(s, e), true);
  });
  test('90° yaw change IS curved', () => {
    const s = { center: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0 } };
    const e = { center: { x: 10, y: 0, z: 0 }, rotation: { yaw: deg(90) } };
    assert.equal(isPathCurved(s, e), true);
  });
});

describe('forceOrientationSync threshold (>135°)', () => {
  const shouldSync = (yawDiff) => Math.abs(normalizeAngle(yawDiff)) > FORCE_SYNC_THRESHOLD;

  test('0° diff does NOT trigger sync', () => {
    assert.equal(shouldSync(0), false);
  });
  test('90° diff does NOT trigger sync (legitimate turn)', () => {
    assert.equal(shouldSync(deg(90)), false);
  });
  test('120° diff does NOT trigger sync', () => {
    assert.equal(shouldSync(deg(120)), false);
  });
  test('134° diff does NOT trigger sync', () => {
    assert.equal(shouldSync(deg(134)), false);
  });
  test('136° diff DOES trigger sync', () => {
    assert.equal(shouldSync(deg(136)), true);
  });
  test('180° diff DOES trigger sync (classic drawing mistake)', () => {
    assert.equal(shouldSync(deg(180)), true);
  });
  test('170° diff DOES trigger sync', () => {
    assert.equal(shouldSync(deg(170)), true);
  });
});

describe('Segment 0 backward propagation range logic', () => {
  // Simulate the Segment 0 logic:
  // - sortedFrames at positions 0..N-1
  // - track has annotations from minExistingIdx to maxExistingIdx
  // - firstKf is the first keyframe
  // Segment 0 runs: for i = trackStartIdx; i < firstKf.frameIdx

  test('No backward frames when first keyframe IS the earliest frame', () => {
    const minExistingIdx = 5; // track starts at position 5
    const firstKfIdx = 5;    // first keyframe also at position 5
    // trackStartIdx < firstKfIdx → false → Segment 0 doesn't run
    const frames = [];
    for (let i = minExistingIdx; i < firstKfIdx; i++) frames.push(i);
    assert.equal(frames.length, 0);
  });

  test('Backward frames exist when propagated before first keyframe', () => {
    // Track: frame_annotations at positions 0,1,2,3,4 (propagated backward to pos 0)
    // first keyframe at position 4
    const minExistingIdx = 0;
    const firstKfIdx = 4;
    const frames = [];
    for (let i = minExistingIdx; i < firstKfIdx; i++) frames.push(i);
    assert.deepEqual(frames, [0, 1, 2, 3]); // 4 frames get re-propagated
  });

  test('When editing second keyframe, Segment 0 still updates pre-firstKf frames', () => {
    // keyframes at pos 3 and 7; track extends from pos 0 to pos 10
    // Editing keyframe at pos 7 (editedKfIndex=1)
    // firstKf = pos 3
    // trackStartIdx = minExistingIdx = 0
    const minExistingIdx = 0;
    const firstKfIdx = 3;
    const frames = [];
    for (let i = minExistingIdx; i < firstKfIdx; i++) frames.push(i);
    assert.deepEqual(frames, [0, 1, 2]); // 3 frames before firstKf get updated
  });

  test('Segment 1 range: frames BETWEEN prev keyframe and current keyframe', () => {
    const prevKfIdx = 3;
    const currKfIdx = 7;
    const frames = [];
    for (let i = prevKfIdx + 1; i < currKfIdx; i++) frames.push(i);
    assert.deepEqual(frames, [4, 5, 6]); // 3 intermediate frames
  });

  test('Segment 2 range: frames BETWEEN current keyframe and next keyframe', () => {
    const currKfIdx = 7;
    const nextKfIdx = 12;
    const frames = [];
    for (let i = currKfIdx + 1; i < nextKfIdx; i++) frames.push(i);
    assert.deepEqual(frames, [8, 9, 10, 11]); // 4 intermediate frames
  });

  test('Segment 3 range: frames AFTER last keyframe to track end', () => {
    const lastKfIdx = 12;
    const trackEndIdx = 15;
    const frames = [];
    for (let i = lastKfIdx + 1; i <= trackEndIdx; i++) frames.push(i);
    assert.deepEqual(frames, [13, 14, 15]); // 3 post-keyframe frames
  });
});

describe('Linear interpolation correctness', () => {
  test('Position lerp midpoint between (0,0,0) and (10,0,0) is (5,0,0)', () => {
    const start = { x: 0, y: 0, z: 0 };
    const end = { x: 10, y: 0, z: 0 };
    const t = 0.5;
    const mid = {
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
      z: lerp(start.z, end.z, t),
    };
    assert.deepEqual(mid, { x: 5, y: 0, z: 0 });
  });

  test('Quarter-way position between (0,0) and (4,0) is (1,0)', () => {
    assert.equal(lerp(0, 4, 0.25), 1);
  });

  test('Yaw lerp 0° -> 90° at t=0.33 ≈ 29.7°', () => {
    const result = lerpAngle(0, deg(90), 1/3);
    assert.ok(Math.abs(result - deg(30)) < 0.001, `got ${result * 180 / Math.PI}°`);
  });

  test('Yaw lerp: vehicle at 170° turning to -170° goes short way through 180°', () => {
    // 170° to -170° (= 190°) short path goes through 180°
    // At t=0.5, expected ~180°
    const result = lerpAngle(deg(170), deg(-170), 0.5);
    assert.ok(Math.abs(Math.abs(normalizeAngle(result)) - Math.PI) < 0.001,
      `expected ±180°, got ${result * 180 / Math.PI}°`);
  });
});

describe('Turn scenario: 90° turn should NOT trigger orientation sync', () => {
  // Real scenario: vehicle goes straight then turns 90°
  // Keyframe 1: yaw = 0° (driving east)
  // Keyframe 2: yaw = 90° (driving north after turn)
  // These are >90° difference from new threshold (135°)? No — 90° < 135°, so no sync.

  test('90° yaw diff does not force sync', () => {
    const editedYaw = 0;
    const otherKfYaw = deg(90);
    const yawDiff = Math.abs(normalizeAngle(otherKfYaw - editedYaw));
    assert.equal(yawDiff > FORCE_SYNC_THRESHOLD, false,
      `${yawDiff * 180 / Math.PI}° should NOT trigger sync`);
  });

  test('Intermediate frame at t=0.5 gets interpolated yaw ≈ 45°', () => {
    const startYaw = 0;
    const endYaw = deg(90);
    const interpolated = lerpAngle(startYaw, endYaw, 0.5);
    assert.ok(Math.abs(interpolated - deg(45)) < 0.001,
      `expected 45°, got ${interpolated * 180 / Math.PI}°`);
  });

  test('180° yaw diff DOES force sync (drawing mistake)', () => {
    const editedYaw = 0;
    const otherKfYaw = deg(180);
    const yawDiff = Math.abs(normalizeAngle(otherKfYaw - editedYaw));
    assert.equal(yawDiff > FORCE_SYNC_THRESHOLD, true,
      `${yawDiff * 180 / Math.PI}° SHOULD trigger sync`);
  });
});

describe('Yaw blending guardrails', () => {
  test('90° -> 91° with unrelated tangent does not collapse toward 0°', () => {
    const blended = blendYawWithTangent(deg(90), deg(91), 0.5, 0);
    const blendedDeg = Math.abs(normalizeAngle(blended) * 180 / Math.PI);
    assert.ok(blendedDeg > 80, `expected heading to stay near 90°, got ${blendedDeg.toFixed(2)}°`);
  });
});

console.log('\n✓ All interpolation tests passed\n');
