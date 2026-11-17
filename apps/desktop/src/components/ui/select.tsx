import { cn } from 'cn';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { fieldStyles } from './field-styles';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...props }, ref) {
  return <select ref={ref} data-slot="select" className={cn(fieldStyles, 'ui-select h-[var(--control-height-default)] px-[var(--space-3)]', className)} {...props} />;
});
