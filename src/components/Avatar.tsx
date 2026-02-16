import { useMemo } from 'react';

const GRADIENT_PAIRS = [
  ['#7c5cfc', '#22d3ee'],
  ['#f472b6', '#fbbf24'],
  ['#4ade80', '#22d3ee'],
  ['#f87171', '#fb923c'],
  ['#a78bfa', '#f472b6'],
  ['#22d3ee', '#4ade80'],
  ['#fbbf24', '#f87171'],
  ['#fb923c', '#a78bfa'],
  ['#34d399', '#818cf8'],
  ['#f97316', '#ec4899'],
  ['#06b6d4', '#8b5cf6'],
  ['#84cc16', '#06b6d4'],
  ['#e879f9', '#38bdf8'],
  ['#fb7185', '#c084fc'],
  ['#2dd4bf', '#a855f7'],
  ['#facc15', '#f43f5e'],
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

interface AvatarProps {
  pubkey: string;
  name?: string;
  picture?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showBorder?: boolean;
  online?: boolean;
  className?: string;
}

const SIZE_MAP = {
  xs: { outer: 'w-7 h-7', inner: 'w-6 h-6', text: 'text-[10px]', dot: 'w-2 h-2 -bottom-0 -right-0', border: '2px' },
  sm: { outer: 'w-9 h-9', inner: 'w-8 h-8', text: 'text-xs', dot: 'w-2.5 h-2.5 -bottom-0 -right-0', border: '2px' },
  md: { outer: 'w-11 h-11', inner: 'w-10 h-10', text: 'text-sm', dot: 'w-3 h-3 -bottom-0.5 -right-0.5', border: '2px' },
  lg: { outer: 'w-16 h-16', inner: 'w-14 h-14', text: 'text-xl', dot: 'w-3.5 h-3.5 bottom-0 right-0', border: '3px' },
  xl: { outer: 'w-24 h-24', inner: 'w-[86px] h-[86px]', text: 'text-3xl', dot: 'w-4 h-4 bottom-0.5 right-0.5', border: '3px' },
};

export default function Avatar({ pubkey, name, picture, size = 'md', showBorder = true, online, className = '' }: AvatarProps) {
  const gradient = useMemo(() => {
    const idx = hashCode(pubkey) % GRADIENT_PAIRS.length;
    return GRADIENT_PAIRS[idx];
  }, [pubkey]);

  const s = SIZE_MAP[size];
  const initial = (name || pubkey || '?')[0].toUpperCase();

  const gradientStyle = showBorder ? {
    background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
    padding: s.border,
  } : {};

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`${s.outer} rounded-full flex items-center justify-center`}
        style={showBorder ? gradientStyle : {}}
      >
        <div
          className={`${s.inner} rounded-full flex items-center justify-center overflow-hidden ${
            showBorder ? 'bg-bg-secondary' : 'bg-bg-tertiary'
          }`}
          style={!showBorder ? {
            background: `linear-gradient(135deg, ${gradient[0]}22, ${gradient[1]}22)`,
            border: `1px solid ${gradient[0]}33`,
          } : {}}
        >
          {picture ? (
            <img
              src={picture}
              alt={name || ''}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span
              className={`${s.text} font-bold`}
              style={{ color: gradient[0] }}
            >
              {initial}
            </span>
          )}
        </div>
      </div>
      {online !== undefined && (
        <div
          className={`absolute ${s.dot} rounded-full border-2 border-bg-secondary ${
            online ? 'bg-green' : 'bg-text-muted'
          }`}
        />
      )}
    </div>
  );
}

export function AvatarGradient({ pubkey }: { pubkey: string }) {
  const gradient = useMemo(() => {
    const idx = hashCode(pubkey) % GRADIENT_PAIRS.length;
    return GRADIENT_PAIRS[idx];
  }, [pubkey]);
  return gradient;
}
