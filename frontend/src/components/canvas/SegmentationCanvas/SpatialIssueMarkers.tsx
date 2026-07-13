import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AnnotationReview } from '@/types';

interface SpatialIssue {
  id: string;
  frame_id?: string;
  x: number;
  y: number;
  z: number;
  issueTypes: string[];
  notes?: string;
  reviewedAt?: string;
  annotator_resolved?: boolean;
}

interface SpatialIssueMarkersProps {
  issues: SpatialIssue[];
  visible?: boolean;
}

function IssueMarker({ issue, index }: { issue: SpatialIssue; index: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useFrame((state) => {
    if (meshRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 3 + index) * 0.15;
      meshRef.current.scale.setScalar(scale);
    }
  });

  const issueLabel = issue.issueTypes.length > 0
    ? issue.issueTypes.join(', ')
    : 'Issue';

  return (
    <group position={[issue.x, issue.y, issue.z]}>
      {/* Main sphere */}
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip(!showTooltip);
        }}
      >
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial
          color={hovered ? '#ff4444' : '#ff0000'}
          emissive={hovered ? '#ff2222' : '#aa0000'}
          emissiveIntensity={0.5}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Outer ring for visibility */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshBasicMaterial color="#ff0000" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Issue number label - hide when tooltip is open */}
      {!showTooltip && (
        <Html
          position={[0, 0.6, 0]}
          center
          zIndexRange={[0, 10]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-lg whitespace-nowrap">
            #{index + 1}
          </div>
        </Html>
      )}

      {/* Tooltip on click */}
      {showTooltip && (
        <Html
          position={[0, 1, 0]}
          center
          zIndexRange={[0, 50]}
          style={{ pointerEvents: 'auto' }}
        >
          <div
            className="bg-gray-900 border border-red-500 rounded-lg p-3 shadow-xl min-w-[200px] max-w-[300px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-red-400 font-semibold text-sm">Issue #{index + 1}</span>
              <button
                onClick={() => setShowTooltip(false)}
                className="text-gray-400 hover:text-white text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="text-white text-sm font-medium mb-1">
              {issueLabel}
            </div>
            {issue.notes && (
              <div className="text-gray-300 text-xs mt-2 border-t border-gray-700 pt-2">
                {issue.notes}
              </div>
            )}
            <div className="text-gray-500 text-xs mt-2">
              Click marker to close
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

export function SpatialIssueMarkers({ issues, visible = true }: SpatialIssueMarkersProps) {
  if (!visible || issues.length === 0) return null;

  return (
    <group>
      {/* Ambient light for markers */}
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />

      {issues.map((issue, index) => (
        <IssueMarker key={issue.id} issue={issue} index={index} />
      ))}
    </group>
  );
}

export function extractSpatialIssues(reviews: AnnotationReview[] | undefined): SpatialIssue[] {
  if (!reviews) return [];

  return reviews
    .filter(r =>
      r.annotation_id.startsWith('spatial-') &&
      r.location_x !== undefined &&
      r.location_x !== null &&
      r.location_y !== undefined &&
      r.location_y !== null &&
      r.location_z !== undefined &&
      r.location_z !== null
    )
    .map(r => ({
      id: r.id,
      frame_id: r.frame_id,
      x: r.location_x!,
      y: r.location_y!,
      z: r.location_z!,
      issueTypes: r.issue_types || [],
      notes: r.notes,
      reviewedAt: r.reviewed_at,
      annotator_resolved: r.annotator_resolved ?? false,
    }));
}
