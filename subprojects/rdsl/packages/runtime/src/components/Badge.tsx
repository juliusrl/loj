import React from 'react';

export interface BadgeProps {
  value: string;
  colors: Record<string, string>;
}

export function Badge({ value, colors }: BadgeProps) {
  const color = colors[value] ?? 'gray';
  return (
    <span className="rdsl-badge" style={{ border: `1px solid ${color}`, color, padding: '0.125rem 0.5rem', borderRadius: '0.375rem' }}>
      {value}
    </span>
  );
}
