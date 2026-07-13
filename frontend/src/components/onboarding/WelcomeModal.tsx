import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/store/authStore';
import { BRAND } from '@/config/branding';

const FloatingParticle: React.FC<{ delay: number; size: number; x: number; color: string }> = ({
  delay, size, x, color
}) => (
  <div
    className="absolute rounded-full opacity-60"
    style={{
      width: size,
      height: size,
      left: `${x}%`,
      background: color,
      animation: `floatUp 8s ease-in-out ${delay}s infinite`,
      filter: 'blur(1px)',
    }}
  />
);

// Animated 3D cube illustration
const AnimatedCube: React.FC = () => (
  <div className="relative w-24 h-24" style={{ perspective: '200px' }}>
    <div
      className="absolute inset-0"
      style={{
        animation: 'rotateCube 10s linear infinite',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Cube faces */}
      <div className="absolute inset-2 bg-gradient-to-br from-cyan-400/40 to-cyan-600/40 border border-cyan-400/60 rounded-lg"
           style={{ transform: 'translateZ(40px)' }} />
      <div className="absolute inset-2 bg-gradient-to-br from-purple-400/30 to-purple-600/30 border border-purple-400/50 rounded-lg"
           style={{ transform: 'rotateY(90deg) translateZ(40px)' }} />
      <div className="absolute inset-2 bg-gradient-to-br from-pink-400/20 to-pink-600/20 border border-pink-400/40 rounded-lg"
           style={{ transform: 'rotateY(-90deg) translateZ(40px)' }} />
    </div>
    {/* Glow effect */}
    <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl animate-pulse" />
  </div>
);

// Animated feature card with hover effects
const FeatureCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  delay: number;
}> = ({ icon, title, description, color, delay }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`relative p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 transition-all duration-300 cursor-pointer overflow-hidden group`}
      style={{
        animation: `cardSlideUp 0.5s ease-out ${delay}s both`,
        transform: isHovered ? 'translateY(-4px) scale(1.02)' : 'none',
        boxShadow: isHovered ? `0 20px 40px ${color}20` : 'none',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Animated background gradient on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(circle at 50% 0%, ${color}15, transparent 70%)` }}
      />

      {/* Icon with pulse animation */}
      <div
        className={`relative w-12 h-12 mb-3 rounded-xl flex items-center justify-center transition-transform duration-300`}
        style={{
          background: `${color}20`,
          transform: isHovered ? 'scale(1.1) rotate(5deg)' : 'none',
        }}
      >
        {icon}
        {/* Ring animation on hover */}
        {isHovered && (
          <div
            className="absolute inset-0 rounded-xl border-2 animate-ping"
            style={{ borderColor: color, opacity: 0.5 }}
          />
        )}
      </div>

      <h3 className="relative font-semibold text-white text-sm mb-1">{title}</h3>
      <p className="relative text-xs text-slate-400">{description}</p>
    </div>
  );
};

// Typing animation hook
const useTypingEffect = (text: string, speed: number = 50) => {
  const [displayText, setDisplayText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      setDisplayText(text.slice(0, index + 1));
      index++;
      if (index >= text.length) {
        clearInterval(timer);
        setIsComplete(true);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return { displayText, isComplete };
};

interface WelcomeModalProps {
  onClose: () => void;
  onStartTour: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose, onStartTour }) => {
  const { user } = useAuthStore();
  const firstName = user?.full_name?.split(' ')[0] || user?.username || 'there';
  const welcomeText = `Welcome to ${BRAND.name}, ${firstName}!`;
  const { displayText, isComplete } = useTypingEffect(welcomeText, 40);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (isComplete) {
      const timer = setTimeout(() => setShowContent(true), 200);
      return () => clearTimeout(timer);
    }
  }, [isComplete]);

  // Generate particles
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    delay: i * 0.5,
    size: 4 + Math.random() * 8,
    x: 5 + (i * 8) % 90,
    color: ['#06b6d4', '#8b5cf6', '#ec4899', '#10b981'][i % 4],
  }));

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      {/* Background animated gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(ellipse at 30% 20%, rgba(6, 182, 212, 0.3), transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(139, 92, 246, 0.3), transparent 50%)',
          animation: 'gradientShift 15s ease-in-out infinite',
        }}
      />

      <div
        className="relative w-full max-w-2xl bg-gradient-to-b from-slate-800/95 to-slate-900/95 rounded-2xl shadow-2xl overflow-hidden border border-slate-700/50"
        style={{ animation: 'modalEnter 0.4s ease-out' }}
      >
        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {particles.map(p => (
            <FloatingParticle key={p.id} {...p} />
          ))}
        </div>

        {/* Animated top gradient bar */}
        <div className="h-1.5 relative overflow-hidden">
          <div
            className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500"
            style={{ animation: 'shimmerBar 3s ease-in-out infinite' }}
          />
        </div>

        {/* Content */}
        <div className="relative p-8">
          {/* Header with animated cube */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <AnimatedCube />
            </div>

            {/* Typing animation header */}
            <h1 className="text-3xl font-bold text-white mb-2 min-h-[2.5rem]">
              {displayText}
              {!isComplete && (
                <span className="inline-block w-0.5 h-7 ml-1 bg-cyan-400 animate-pulse" />
              )}
            </h1>

            <p
              className="text-slate-400 text-lg transition-opacity duration-500"
              style={{ opacity: isComplete ? 1 : 0 }}
            >
              Your powerful annotation workspace for creating high-quality labeled data
            </p>
          </div>

          {/* Feature highlights with staggered animations */}
          <div
            className="grid grid-cols-2 gap-4 mb-6 transition-opacity duration-500"
            style={{ opacity: showContent ? 1 : 0 }}
          >
            <FeatureCard
              delay={0.1}
              color="#3b82f6"
              icon={
                <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                </svg>
              }
              title="3D LiDAR Annotation"
              description="Precise 3D cuboids with multi-view synchronized editing"
            />

            <FeatureCard
              delay={0.2}
              color="#8b5cf6"
              icon={
                <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              }
              title="AI-Powered Tools"
              description="AI Segmentation & intelligent auto-tracking"
            />

            <FeatureCard
              delay={0.3}
              color="#10b981"
              icon={
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              title="QA Workflow"
              description="Built-in review process with 18+ quality checks"
            />

            <FeatureCard
              delay={0.4}
              color="#f59e0b"
              icon={
                <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
              title="Real-Time Tracking"
              description="Live productivity monitoring with gamification & leaderboards"
            />
          </div>

          {/* Quick start section with animated border */}
          <div
            className="relative p-4 rounded-xl mb-6 overflow-hidden transition-all duration-500"
            style={{
              opacity: showContent ? 1 : 0,
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(139, 92, 246, 0.1))',
            }}
          >
            {/* Animated border */}
            <div
              className="absolute inset-0 rounded-xl"
              style={{
                background: 'linear-gradient(90deg, #06b6d4, #8b5cf6, #ec4899, #06b6d4)',
                backgroundSize: '300% 100%',
                animation: 'borderGradient 4s linear infinite',
                padding: '1px',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
              }}
            />

            <h3 className="text-cyan-400 font-semibold text-sm mb-2 flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
              Quick Start Recommendation
            </h3>
            <p className="text-slate-300 text-sm">
              Take a 2-minute guided tour to master the platform basics.
              Access tours anytime from the <span className="text-cyan-400 font-medium">❓ help button</span> in the corner.
            </p>
          </div>

          {/* Action buttons with enhanced hover effects */}
          <div
            className="flex gap-4 transition-opacity duration-500"
            style={{ opacity: showContent ? 1 : 0 }}
          >
            <button
              onClick={onStartTour}
              className="group relative flex-1 px-6 py-3.5 overflow-hidden rounded-xl font-semibold text-white transition-all duration-300"
              style={{
                background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
                boxShadow: '0 10px 40px rgba(6, 182, 212, 0.3)',
              }}
            >
              {/* Shine effect on hover */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                  animation: 'shine 1.5s ease-in-out infinite',
                }}
              />
              <span className="relative flex items-center justify-center gap-2">
                <svg className="w-5 h-5 group-hover:animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Start Guided Tour
              </span>
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3.5 bg-slate-700/80 text-slate-300 font-medium rounded-xl hover:bg-slate-600 hover:text-white transition-all duration-300 hover:scale-105"
            >
              Explore on My Own
            </button>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white hover:rotate-90 transition-all duration-300"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Enhanced animation keyframes */}
      <style>{`
        @keyframes modalEnter {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes floatUp {
          0%, 100% {
            transform: translateY(100vh) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 0.6;
          }
          90% {
            opacity: 0.6;
          }
          100% {
            transform: translateY(-20px) rotate(360deg);
            opacity: 0;
          }
        }
        @keyframes rotateCube {
          0% {
            transform: rotateX(-20deg) rotateY(0deg);
          }
          100% {
            transform: rotateX(-20deg) rotateY(360deg);
          }
        }
        @keyframes cardSlideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shimmerBar {
          0%, 100% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(100%);
          }
        }
        @keyframes borderGradient {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 300% 50%;
          }
        }
        @keyframes gradientShift {
          0%, 100% {
            transform: scale(1) translate(0, 0);
          }
          50% {
            transform: scale(1.1) translate(5%, 5%);
          }
        }
        @keyframes shine {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default WelcomeModal;
