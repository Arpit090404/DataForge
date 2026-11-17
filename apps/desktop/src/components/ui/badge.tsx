import { cn } from 'cn';
import { forwardRef, type ComponentPropsWithRef } from 'react';

type BadgeProps = ComponentPropsWithRef<'span'> & { status: 'ready' | 'changed' | 'missing' };

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ status, className, ...props }, ref) {
  const tone = status === 'ready' ? 'border-[var(--color-success-border)] text-[var(--color-success)]' : status === 'changed' ? 'border-[var(--color-warning-border)] text-[var(--color-warning)]' : 'border-[var(--color-error-border)] text-[var(--color-error)]';
  return <span ref={ref} data-slot="badge" className={cn('inline-flex items-center rounded-[var(--radius-small)] border px-[7px] py-[3px] text-[length:var(--font-size-meta)] capitalize', tone, className)} {...props} />;
});
