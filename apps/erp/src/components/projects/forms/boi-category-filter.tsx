'use client';

import * as React from 'react';
import { BOI_CATEGORIES } from '@/lib/boi-constants';

interface BoiCategoryFilterProps {
  categories: string[];
  boiId: string;
}

/**
 * Client-side category filter for BOI item rows.
 * Uses DOM-based filtering to toggle row visibility by data-category attribute.
 * Scoped to rows matching the specific BOI ID via `.boi-row-{boiId}` class.
 */
export function BoiCategoryFilter({ categories, boiId }: BoiCategoryFilterProps) {
  const [current, setCurrent] = React.useState('');

  function handleChange(cat: string) {
    setCurrent(cat);
    const rows = document.querySelectorAll(`.boi-row-${boiId}`);
    rows.forEach((row) => {
      const el = row as HTMLElement;
      if (!cat || el.dataset.category === cat) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }

  // Build label map from BOI_CATEGORIES
  const labelMap = Object.fromEntries(BOI_CATEGORIES.map(c => [c.value, c.label]));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-medium text-[#7C818E] uppercase tracking-wide">Filter:</span>
      <button
        onClick={() => handleChange('')}
        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
          current === ''
            ? 'bg-[#1A1D24] text-white'
            : 'bg-[#F5F6F8] text-[#7C818E] hover:bg-[#ECEEF2]'
        }`}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => handleChange(cat)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            current === cat
              ? 'bg-[#1A1D24] text-white'
              : 'bg-[#F5F6F8] text-[#7C818E] hover:bg-[#ECEEF2]'
          }`}
        >
          {labelMap[cat] ?? cat.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}
