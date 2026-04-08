'use client';

import * as React from 'react';
import { BoqCategoryFilter } from './boq-variance-form';

export function BoqCategoryFilterWrapper({ categories }: { categories: string[] }) {
  const [currentCategory, setCurrentCategory] = React.useState('');

  function handleChange(cat: string) {
    setCurrentCategory(cat);
    // Filter rows in the DOM by toggling display
    const rows = document.querySelectorAll('.boq-row');
    rows.forEach((row) => {
      const el = row as HTMLElement;
      if (!cat || el.dataset.category === cat) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }

  if (categories.length <= 1) return null;

  return (
    <BoqCategoryFilter
      currentCategory={currentCategory}
      onChange={handleChange}
      categories={categories}
    />
  );
}
