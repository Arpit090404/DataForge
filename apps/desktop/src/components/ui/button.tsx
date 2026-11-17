import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva } from 'class-variance-authority';
import { cn } from 'cn';
import { forwardRef } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const buttonVariants = cva(
  'ui-button inline-flex shrink-0 items-center justify-center gap-[var(--space-2)] whitespace-nowrap rounded-[var(--radius-default)] border border-transparent px-[var(--space-control-x)] text-[length:var(--font-size-body)] font-[var(--font-weight-semibold)] leading-none cursor-pointer motion-safe:transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 enabled:active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-70 [&_svg]:size-[var(--icon-size-default)] [&_svg]:shrink-0 [&_svg]:stroke-[length:var(--icon-stroke)]',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-action)] text-[var(--color-action-text)] enabled:hover:bg-[var(--color-action-hover)]',
        secondary: 'border-[var(--color-input-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] enabled:hover:bg-[var(--color-hover)]',
        ghost: 'bg-transparent text-[var(--color-text-secondary)] enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]',
        destructive: 'border-[var(--color-error-border)] bg-[var(--color-error-surface)] text-[var(--color-destructive)] enabled:hover:bg-[var(--color-error-border)]',
        icon: 'ui-button--icon border-0 bg-transparent text-[var(--color-text-muted)] enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]',
      },
      size: {
        small: 'h-[var(--control-height-small)] px-[var(--space-2)] text-[length:var(--font-size-secondary)]',
        default: 'h-[var(--control-height-default)]',
        large: 'h-[var(--control-height-large)] px-[var(--space-4)] text-[length:var(--font-size-component)]',
        icon: 'size-[var(--control-height-icon)] p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

type ButtonProps = ButtonPrimitive.Props & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'text' | 'icon';
  size?: 'small' | 'default' | 'large';
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'default', className, loading = false, disabled, ...props }, ref,
) {
  const style = variant === 'text' ? 'ghost' : variant;
  return <ButtonPrimitive ref={ref} data-slot="button" className={cn(buttonVariants({ variant: style, size: variant === 'icon' ? 'icon' : size }), className)} aria-busy={loading || undefined} disabled={disabled || loading} {...props} />;
});

type IconButtonProps = Omit<ButtonProps, 'variant' | 'aria-label'> & { label: string };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, title, disabled, ...props }, ref,
) {
  const button = <Button ref={ref} variant="icon" aria-label={label} disabled={disabled} {...props} />;
  return <Tooltip>
    {disabled ? <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger> : <TooltipTrigger render={button} />}
    <TooltipContent>{title ?? label}</TooltipContent>
  </Tooltip>;
});
