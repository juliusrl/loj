import React from 'react';

export interface TagProps {
  value: string;
  colors: Record<string, string>;
}

export function Tag({ value, colors }: TagProps) {
  const color = colors[value] ?? 'gray';
  return (
    <span className="rdsl-tag" style={{ backgroundColor: color, color: 'white', padding: '0.125rem 0.5rem', borderRadius: '999px' }}>
      {value}
    </span>
  );
}
