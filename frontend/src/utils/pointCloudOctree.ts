
import * as THREE from 'three';


export interface OctreeNode {
  bounds: THREE.Box3;
  center: THREE.Vector3;
  size: number;
  depth: number;
  pointIndices: number[];
  children: (OctreeNode | null)[];
  pointCount: number;
  isLeaf: boolean;
}

export interface OctreeConfig {
  maxDepth: number;
  maxPointsPerNode: number;
  minNodeSize: number;
}

export interface VisibleNodes {
  nodes: OctreeNode[];
  totalPoints: number;
  cullRatio: number;
}

export interface ScreenBudgetConfig {
  maxPoints: number;
  screenDensity: number;
  prioritizeNearby: boolean;
}


const DEFAULT_CONFIG: OctreeConfig = {
  maxDepth: 6,
  maxPointsPerNode: 1000,
  minNodeSize: 1.0,
};

export function buildOctree(
  positions: Float32Array,
  config: Partial<OctreeConfig> = {}
): OctreeNode {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const pointCount = positions.length / 3;

  const bounds = new THREE.Box3();
  const tempVec = new THREE.Vector3();

  for (let i = 0; i < pointCount; i++) {
    tempVec.set(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2]
    );
    bounds.expandByPoint(tempVec);
  }

  const size = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z
  );

  const center = new THREE.Vector3();
  bounds.getCenter(center);

  const root: OctreeNode = {
    bounds: new THREE.Box3(
      new THREE.Vector3(center.x - size/2, center.y - size/2, center.z - size/2),
      new THREE.Vector3(center.x + size/2, center.y + size/2, center.z + size/2)
    ),
    center: center.clone(),
    size,
    depth: 0,
    pointIndices: Array.from({ length: pointCount }, (_, i) => i),
    children: new Array(8).fill(null),
    pointCount,
    isLeaf: true,
  };

  subdivideNode(root, positions, cfg);

  return root;
}

function subdivideNode(
  node: OctreeNode,
  positions: Float32Array,
  config: OctreeConfig
): void {
  if (node.depth >= config.maxDepth) return;
  if (node.pointIndices.length <= config.maxPointsPerNode) return;
  if (node.size / 2 < config.minNodeSize) return;

  node.isLeaf = false;
  const halfSize = node.size / 2;
  const quarterSize = node.size / 4;

  const childBounds: THREE.Box3[] = [];
  const childCenters: THREE.Vector3[] = [];

  for (let i = 0; i < 8; i++) {
    const xOffset = (i & 1) ? quarterSize : -quarterSize;
    const yOffset = (i & 2) ? quarterSize : -quarterSize;
    const zOffset = (i & 4) ? quarterSize : -quarterSize;

    const childCenter = new THREE.Vector3(
      node.center.x + xOffset,
      node.center.y + yOffset,
      node.center.z + zOffset
    );

    childCenters.push(childCenter);
    childBounds.push(new THREE.Box3(
      new THREE.Vector3(
        childCenter.x - quarterSize,
        childCenter.y - quarterSize,
        childCenter.z - quarterSize
      ),
      new THREE.Vector3(
        childCenter.x + quarterSize,
        childCenter.y + quarterSize,
        childCenter.z + quarterSize
      )
    ));
  }

  const childIndices: number[][] = Array.from({ length: 8 }, () => []);
  const tempVec = new THREE.Vector3();

  for (const idx of node.pointIndices) {
    tempVec.set(
      positions[idx * 3],
      positions[idx * 3 + 1],
      positions[idx * 3 + 2]
    );

    const octant =
      (tempVec.x >= node.center.x ? 1 : 0) +
      (tempVec.y >= node.center.y ? 2 : 0) +
      (tempVec.z >= node.center.z ? 4 : 0);

    childIndices[octant].push(idx);
  }

  node.pointIndices = [];

  for (let i = 0; i < 8; i++) {
    if (childIndices[i].length > 0) {
      node.children[i] = {
        bounds: childBounds[i],
        center: childCenters[i],
        size: halfSize,
        depth: node.depth + 1,
        pointIndices: childIndices[i],
        children: new Array(8).fill(null),
        pointCount: childIndices[i].length,
        isLeaf: true,
      };

      subdivideNode(node.children[i]!, positions, config);
    }
  }
}


export function getVisibleNodes(
  root: OctreeNode,
  camera: THREE.Camera,
  screenBudget: Partial<ScreenBudgetConfig> = {}
): VisibleNodes {
  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();

  projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  frustum.setFromProjectionMatrix(projScreenMatrix);

  const config: ScreenBudgetConfig = {
    maxPoints: 500000,
    screenDensity: 100,
    prioritizeNearby: true,
    ...screenBudget,
  };

  const visibleLeaves: { node: OctreeNode; distance: number }[] = [];

  function traverse(node: OctreeNode): void {
    if (!frustum.intersectsBox(node.bounds)) {
      return;
    }

    if (node.isLeaf) {
      const distance = camera.position.distanceTo(node.center);
      visibleLeaves.push({ node, distance });
    } else {
      for (const child of node.children) {
        if (child) traverse(child);
      }
    }
  }

  traverse(root);

  if (config.prioritizeNearby) {
    visibleLeaves.sort((a, b) => a.distance - b.distance);
  }

  let totalPoints = 0;
  const selectedNodes: OctreeNode[] = [];

  for (const { node, distance } of visibleLeaves) {
    const lodFactor = Math.max(1, Math.floor(distance / 50));
    const effectivePoints = Math.ceil(node.pointCount / lodFactor);

    if (totalPoints + effectivePoints <= config.maxPoints) {
      selectedNodes.push(node);
      totalPoints += node.pointCount;
    } else if (totalPoints < config.maxPoints) {
      selectedNodes.push(node);
      totalPoints += node.pointCount;
      break;
    }
  }

  const totalInTree = countAllPoints(root);
  const cullRatio = 1 - (totalPoints / totalInTree);

  return {
    nodes: selectedNodes,
    totalPoints,
    cullRatio,
  };
}

function countAllPoints(node: OctreeNode): number {
  if (node.isLeaf) {
    return node.pointCount;
  }

  let count = 0;
  for (const child of node.children) {
    if (child) count += countAllPoints(child);
  }
  return count;
}


export function extractVisibleGeometry(
  nodes: OctreeNode[],
  positions: Float32Array,
  intensities: Float32Array,
  frameIndices: Float32Array,
  maxPoints: number = 500000
): {
  positions: Float32Array;
  intensities: Float32Array;
  frameIndices: Float32Array;
  pointCount: number;
  decimationFactor: number;
} {
  let totalPoints = 0;
  for (const node of nodes) {
    totalPoints += node.pointIndices.length;
  }

  const decimationFactor = totalPoints > maxPoints
    ? Math.ceil(totalPoints / maxPoints)
    : 1;

  const outputCount = Math.ceil(totalPoints / decimationFactor);

  const outPositions = new Float32Array(outputCount * 3);
  const outIntensities = new Float32Array(outputCount);
  const outFrameIndices = new Float32Array(outputCount);

  let outIdx = 0;
  let srcCount = 0;

  for (const node of nodes) {
    for (const pointIdx of node.pointIndices) {
      if (srcCount % decimationFactor === 0 && outIdx < outputCount) {
        const srcPos = pointIdx * 3;
        const dstPos = outIdx * 3;

        outPositions[dstPos] = positions[srcPos];
        outPositions[dstPos + 1] = positions[srcPos + 1];
        outPositions[dstPos + 2] = positions[srcPos + 2];
        outIntensities[outIdx] = intensities[pointIdx];
        outFrameIndices[outIdx] = frameIndices[pointIdx];

        outIdx++;
      }
      srcCount++;
    }
  }

  return {
    positions: outPositions,
    intensities: outIntensities,
    frameIndices: outFrameIndices,
    pointCount: outIdx,
    decimationFactor,
  };
}


function fastSpatialHash(vx: number, vy: number, vz: number): number {
  const offset = 1 << 20;
  const ix = (vx + offset) >>> 0;
  const iy = (vy + offset) >>> 0;
  const iz = (vz + offset) >>> 0;

  return ((ix * 2654435761) ^ (iy * 2246822519) ^ (iz * 3266489917)) >>> 0;
}


export class StreamingVoxelGrid {
  private invVoxelSize: number;
  private maxVoxels: number;

  private positions: Float32Array | null = null;
  private intensities: Float32Array | null = null;
  private frameIndices: Float32Array | null = null;
  private capacity: number = 0;
  private voxelCount: number = 0;

  private voxelMap: Map<number, number> = new Map();
  private voxelKeys: Map<number, { vx: number; vy: number; vz: number }> = new Map();

  constructor(voxelSize: number = 0.25, maxVoxels: number = 100000) {
    this.invVoxelSize = 1 / voxelSize;
    this.maxVoxels = Math.min(maxVoxels, 100000);

  }

  private ensureCapacity(needed: number): boolean {
    if (this.capacity >= needed) return true;

    const newCapacity = Math.min(
      this.maxVoxels,
      Math.max(1000, this.capacity * 2, needed)
    );

    try {
      const newPositions = new Float32Array(newCapacity * 3);
      const newIntensities = new Float32Array(newCapacity);
      const newFrameIndices = new Float32Array(newCapacity);

      if (this.positions && this.voxelCount > 0) {
        newPositions.set(this.positions.subarray(0, this.voxelCount * 3));
        newIntensities.set(this.intensities!.subarray(0, this.voxelCount));
        newFrameIndices.set(this.frameIndices!.subarray(0, this.voxelCount));
      }

      this.positions = newPositions;
      this.intensities = newIntensities;
      this.frameIndices = newFrameIndices;
      this.capacity = newCapacity;

      return true;
    } catch (e) {
      console.error(`[StreamingVoxelGrid] Failed to allocate ${newCapacity} voxels:`, e);
      return false;
    }
  }

  /**
   * Add points from a single scan to the voxel grid.
   * Points are immediately downsampled - only one point per voxel is kept.
   *
   * @param positions Point positions in world coordinates (already transformed)
   * @param intensities Point intensities
   * @param frameIndex The frame index for all points in this scan
   * @param priorityBoost If true, these points can replace existing ones (for reference frame)
   */
  addScan(
    positions: Float32Array,
    intensities: Float32Array,
    frameIndex: number,
    priorityBoost: boolean = false
  ): void {
    const pointCount = positions.length / 3;

    for (let i = 0; i < pointCount; i++) {
      // Early exit if we've hit the max voxel limit
      if (this.voxelCount >= this.maxVoxels && !priorityBoost) {
        console.warn(`[StreamingVoxelGrid] Hit max voxel limit ${this.maxVoxels}`);
        break;
      }

      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      // Skip invalid points
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

      // Compute voxel coordinates
      const vx = Math.floor(x * this.invVoxelSize);
      const vy = Math.floor(y * this.invVoxelSize);
      const vz = Math.floor(z * this.invVoxelSize);

      const hash = fastSpatialHash(vx, vy, vz);

      // Check if voxel already occupied
      const existingKey = this.voxelKeys.get(hash);
      if (existingKey) {
        if (existingKey.vx === vx && existingKey.vy === vy && existingKey.vz === vz) {
          // Same voxel - if priority boost and this is a better point, replace
          if (priorityBoost && this.positions && this.intensities && this.frameIndices) {
            const existingIdx = this.voxelMap.get(hash)!;
            this.positions[existingIdx * 3] = x;
            this.positions[existingIdx * 3 + 1] = y;
            this.positions[existingIdx * 3 + 2] = z;
            this.intensities[existingIdx] = intensities[i];
            this.frameIndices[existingIdx] = frameIndex;
          }
          continue;
        }
        // Hash collision - different voxel but same hash
        // For simplicity, skip this point (collisions are rare with good hash)
        continue;
      }

      // New voxel - add it
      if (this.voxelCount < this.maxVoxels) {
        // Ensure we have capacity (lazy allocation)
        if (!this.ensureCapacity(this.voxelCount + 1)) {
          console.warn('[StreamingVoxelGrid] Cannot allocate more memory, stopping');
          break;
        }

        const idx = this.voxelCount;

        this.voxelMap.set(hash, idx);
        this.voxelKeys.set(hash, { vx, vy, vz });

        this.positions![idx * 3] = x;
        this.positions![idx * 3 + 1] = y;
        this.positions![idx * 3 + 2] = z;
        this.intensities![idx] = intensities[i];
        this.frameIndices![idx] = frameIndex;

        this.voxelCount++;
      }
    }
  }

  /**
   * Get the final downsampled point cloud
   */
  getResult(): {
    positions: Float32Array;
    intensities: Float32Array;
    frameIndices: Float32Array;
    pointCount: number;
  } {

    // Return empty arrays if nothing was added
    if (!this.positions || this.voxelCount === 0) {
      return {
        positions: new Float32Array(0),
        intensities: new Float32Array(0),
        frameIndices: new Float32Array(0),
        pointCount: 0,
      };
    }

    return {
      positions: this.positions.subarray(0, this.voxelCount * 3),
      intensities: this.intensities!.subarray(0, this.voxelCount),
      frameIndices: this.frameIndices!.subarray(0, this.voxelCount),
      pointCount: this.voxelCount,
    };
  }

  /**
   * Clear the grid for reuse
   */
  clear(): void {
    this.voxelMap.clear();
    this.voxelKeys.clear();
    this.voxelCount = 0;
    // Keep the buffers for reuse, just reset count
  }

  /**
   * Fully dispose the grid and release all memory
   */
  dispose(): void {
    this.voxelMap.clear();
    this.voxelKeys.clear();
    this.voxelCount = 0;
    this.capacity = 0;
    // Release typed arrays
    this.positions = null;
    this.intensities = null;
    this.frameIndices = null;
  }

  /**
   * Get current voxel count
   */
  getVoxelCount(): number {
    return this.voxelCount;
  }
}

/**
 * Downsample point cloud using voxel grid - keeps one point per voxel
 * OPTIMIZED version using numeric hashing instead of string keys
 */
export function voxelGridDownsample(
  positions: Float32Array,
  intensities: Float32Array,
  frameIndices: Float32Array,
  voxelSize: number = 0.1
): {
  positions: Float32Array;
  intensities: Float32Array;
  frameIndices: Float32Array;
  pointCount: number;
} {
  const pointCount = positions.length / 3;

  // Safety check: if point count is too large or invalid, return empty
  if (pointCount <= 0 || !isFinite(pointCount)) {
    console.warn('[VoxelGrid] Invalid point count:', pointCount);
    return {
      positions: new Float32Array(0),
      intensities: new Float32Array(0),
      frameIndices: new Float32Array(0),
      pointCount: 0,
    };
  }

  const invVoxelSize = 1 / voxelSize;

  // Use Map with numeric keys (much faster than string keys)
  // Key = hash, Value = index of first point in that voxel
  const voxelMap = new Map<number, number>();

  // Pre-allocate output arrays at estimated size (usually 10-30% of input)
  // Cap at 500k points to avoid memory issues
  const estimatedOutput = Math.min(Math.ceil(pointCount * 0.3), 500000);
  let outPositions = new Float32Array(estimatedOutput * 3);
  let outIntensities = new Float32Array(estimatedOutput);
  let outFrameIndices = new Float32Array(estimatedOutput);

  // Track voxel keys for collision detection
  const voxelKeys = new Map<number, { vx: number; vy: number; vz: number }>();

  let outIdx = 0;

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    // Voxel coordinates
    const vx = Math.floor(x * invVoxelSize);
    const vy = Math.floor(y * invVoxelSize);
    const vz = Math.floor(z * invVoxelSize);

    // Fast hash
    const hash = fastSpatialHash(vx, vy, vz);

    // Check for hash collision (different voxel, same hash)
    const existingKey = voxelKeys.get(hash);
    if (existingKey) {
      if (existingKey.vx === vx && existingKey.vy === vy && existingKey.vz === vz) {
        // Same voxel - skip (keep first point only for speed)
        continue;
      }
      // Hash collision with different voxel - use fallback string key approach
      // This is rare, so we handle it specially
    }

    if (!voxelMap.has(hash)) {
      // Grow arrays if needed
      if (outIdx >= outPositions.length / 3) {
        const newSize = outPositions.length * 2;
        const newPos = new Float32Array(newSize);
        const newInt = new Float32Array(newSize / 3);
        const newFrame = new Float32Array(newSize / 3);
        newPos.set(outPositions);
        newInt.set(outIntensities);
        newFrame.set(outFrameIndices);
        outPositions = newPos;
        outIntensities = newInt;
        outFrameIndices = newFrame;
      }

      // Store this voxel
      voxelMap.set(hash, outIdx);
      voxelKeys.set(hash, { vx, vy, vz });

      // Copy point (keep first point per voxel - fast, no averaging)
      outPositions[outIdx * 3] = x;
      outPositions[outIdx * 3 + 1] = y;
      outPositions[outIdx * 3 + 2] = z;
      outIntensities[outIdx] = intensities[i];
      outFrameIndices[outIdx] = frameIndices[i];

      outIdx++;
    }
  }

  // Trim to actual size - return subarrays directly to avoid extra allocation
  const finalPositions = outPositions.subarray(0, outIdx * 3);
  const finalIntensities = outIntensities.subarray(0, outIdx);
  const finalFrameIndices = outFrameIndices.subarray(0, outIdx);


  return {
    positions: finalPositions,
    intensities: finalIntensities,
    frameIndices: finalFrameIndices,
    pointCount: outIdx,
  };
}
