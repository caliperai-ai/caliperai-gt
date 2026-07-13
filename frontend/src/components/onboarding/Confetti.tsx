import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  color: string;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  shape: 'square' | 'circle' | 'triangle' | 'star';
}

interface ConfettiProps {
  isActive: boolean;
  duration?: number;
  particleCount?: number;
  onComplete?: () => void;
}

const COLORS = [
  '#06b6d4',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#f43f5e',
  '#84cc16',
];

const createConfettiPiece = (id: number): ConfettiPiece => {
  const shapes: ConfettiPiece['shape'][] = ['square', 'circle', 'triangle', 'star'];
  return {
    id,
    x: 50 + (Math.random() - 0.5) * 40,
    y: 30,
    rotation: Math.random() * 360,
    scale: 0.5 + Math.random() * 0.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    velocityX: (Math.random() - 0.5) * 15,
    velocityY: -Math.random() * 20 - 10,
    rotationSpeed: (Math.random() - 0.5) * 20,
    shape: shapes[Math.floor(Math.random() * shapes.length)],
  };
};

const ConfettiShape: React.FC<{ piece: ConfettiPiece }> = ({ piece }) => {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${piece.x}%`,
    top: `${piece.y}%`,
    transform: `rotate(${piece.rotation}deg) scale(${piece.scale})`,
    backgroundColor: piece.color,
    opacity: Math.max(0, 1 - piece.y / 150),
    pointerEvents: 'none',
  };

  switch (piece.shape) {
    case 'circle':
      return (
        <div
          style={{
            ...baseStyle,
            width: '12px',
            height: '12px',
            borderRadius: '50%',
          }}
        />
      );
    case 'triangle':
      return (
        <div
          style={{
            ...baseStyle,
            width: 0,
            height: 0,
            backgroundColor: 'transparent',
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: `12px solid ${piece.color}`,
          }}
        />
      );
    case 'star':
      return (
        <div
          style={{
            ...baseStyle,
            width: '12px',
            height: '12px',
            clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
          }}
        />
      );
    default:
      return (
        <div
          style={{
            ...baseStyle,
            width: '10px',
            height: '10px',
            borderRadius: '2px',
          }}
        />
      );
  }
};

export const Confetti: React.FC<ConfettiProps> = ({
  isActive,
  duration = 3000,
  particleCount = 50,
  onComplete,
}) => {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  // Initialize confetti on activation
  useEffect(() => {
    if (isActive) {
      const initialPieces = Array.from({ length: particleCount }, (_, i) =>
        createConfettiPiece(i)
      );
      setPieces(initialPieces);
    } else {
      setPieces([]);
    }
  }, [isActive, particleCount]);

  // Animate confetti physics
  useEffect(() => {
    if (!isActive || pieces.length === 0) return;

    const gravity = 0.5;
    const friction = 0.99;

    const animationFrame = requestAnimationFrame(function animate() {
      setPieces(prev =>
        prev
          .map(piece => ({
            ...piece,
            x: piece.x + piece.velocityX * 0.1,
            y: piece.y + piece.velocityY * 0.1,
            velocityY: piece.velocityY + gravity,
            velocityX: piece.velocityX * friction,
            rotation: piece.rotation + piece.rotationSpeed,
          }))
          .filter(piece => piece.y < 150) // Remove pieces that fall off screen
      );
      requestAnimationFrame(animate);
    });

    // Complete callback after duration
    const timeout = setTimeout(() => {
      onComplete?.();
    }, duration);

    return () => {
      cancelAnimationFrame(animationFrame);
      clearTimeout(timeout);
    };
  }, [isActive, pieces.length > 0]);

  if (!isActive || pieces.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 99999,
        overflow: 'hidden',
      }}
    >
      {pieces.map(piece => (
        <ConfettiShape key={piece.id} piece={piece} />
      ))}
    </div>,
    document.body
  );
};

export default Confetti;
