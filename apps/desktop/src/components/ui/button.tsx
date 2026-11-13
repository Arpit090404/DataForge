import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text' | 'icon'; size?: 'default' | 'small' };

// Small customized shadcn-style primitive; variants use DataForge's CSS tokens.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'default', className = '', ...props }, ref,
) {
  return <button ref={ref} className={`${variant}-button ${size === 'small' ? 'small' : ''} ${className}`.trim()} {...props} />;
});
