import { cn } from 'cn';
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { fieldStyles } from './field-styles';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} data-slot="textarea" className={cn(fieldStyles, 'ui-textarea block w-full max-w-full p-[var(--space-3)] leading-[1.6]', className)} {...props} />;
});
