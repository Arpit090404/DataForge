import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from 'cn';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { fieldStyles } from './field-styles';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...props }, ref) {
  return <InputPrimitive ref={ref} data-slot="input" className={cn(fieldStyles, 'ui-input h-[var(--control-height-default)] px-[var(--space-3)]', className)} {...props} />;
});
