import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import {
  useSegmentationStore,
  useCurrentFrameLabels,
  useCurrentFrameInstanceIds,
} from '@/store/segmentationStore';
import { instanceDisplayId } from './instanceNaming';
import type { Taxonomy } from '@/types';

interface PointCloudData {
  positions: Float32Array;
  pointCount: number;
}

interface InstanceLabelsProps {
  data: PointCloudData;
  taxonomy: Taxonomy | null;
}

interface InstanceLabel {
  instanceId: number;
  displayName: string;
  position: [number, number, number];
}

export function InstanceLabels({ data, taxonomy }: InstanceLabelsProps) {
  const segmentationMode = useSegmentationStore((s) => s.segmentationMode);
  const hiddenInstances = useSegmentationStore((s) => s.hiddenInstances);
  const labels = useCurrentFrameLabels();
  const instanceIds = useCurrentFrameInstanceIds();

  const instanceLabels: InstanceLabel[] = useMemo(() => {
    if (segmentationMode !== 'instance' || !instanceIds || !labels || !taxonomy?.classes) {
      return [];
    }

    const acc = new Map<number, { sx: number; sy: number; sz: number; maxZ: number; count: number; classId: number }>();
    const { positions, pointCount } = data;
    const n = Math.min(pointCount, instanceIds.length);
    for (let i = 0; i < n; i++) {
      const inst = instanceIds[i];
      if (inst < 0) continue;
      const cls = labels[i];
      if (cls < 0) continue;
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      let a = acc.get(inst);
      if (!a) { a = { sx: 0, sy: 0, sz: 0, maxZ: z, count: 0, classId: cls }; acc.set(inst, a); }
      a.sx += x; a.sy += y; a.sz += z;
      if (z > a.maxZ) a.maxZ = z;
      a.count++;
    }

    const sorted = [...acc.entries()].sort((p, q) => p[0] - q[0]);
    const perClassCount = new Map<number, number>();
    const result: InstanceLabel[] = [];
    for (const [instanceId, a] of sorted) {
      const cls = taxonomy.classes[a.classId];
      if (!cls) continue;
      const ordinal = (perClassCount.get(a.classId) ?? 0) + 1;
      perClassCount.set(a.classId, ordinal);
      result.push({
        instanceId,
        displayName: instanceDisplayId(cls.name, ordinal, cls.instance_prefix),
        position: [a.sx / a.count, a.sy / a.count, a.maxZ + 0.4],
      });
    }
    return result;
  }, [segmentationMode, instanceIds, labels, taxonomy, data]);

  if (instanceLabels.length === 0) return null;

  return (
    <group>
      {instanceLabels.map((label) => (
        hiddenInstances.has(label.instanceId) ? null : (
          <Html
            key={label.instanceId}
            position={label.position}
            center
            zIndexRange={[0, 10]}
            style={{ pointerEvents: 'none' }}
          >
            <div className="px-1.5 py-0.5 rounded bg-black/70 border border-white/20 text-white text-[10px] font-mono font-medium whitespace-nowrap shadow">
              {label.displayName}
            </div>
          </Html>
        )
      ))}
    </group>
  );
}

export default InstanceLabels;
