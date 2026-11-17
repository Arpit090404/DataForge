import { cn } from 'cn';
import { forwardRef, type ComponentPropsWithRef } from 'react';

export const Table = forwardRef<HTMLTableElement, ComponentPropsWithRef<'table'>>(function Table({ className, ...props }, ref) {
  return <table ref={ref} data-slot="table" className={cn('data-table min-w-full border-collapse text-[length:var(--font-size-secondary)]', className)} {...props} />;
});
export const TableHeader = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'thead'>>(function TableHeader({ className, ...props }, ref) {
  return <thead ref={ref} data-slot="table-header" className={className} {...props} />;
});
export const TableBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tbody'>>(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} data-slot="table-body" className={className} {...props} />;
});
export const TableFooter = forwardRef<HTMLTableSectionElement, ComponentPropsWithRef<'tfoot'>>(function TableFooter({ className, ...props }, ref) {
  return <tfoot ref={ref} data-slot="table-footer" className={cn('border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text)]', className)} {...props} />;
});
export const TableRow = forwardRef<HTMLTableRowElement, ComponentPropsWithRef<'tr'>>(function TableRow({ className, ...props }, ref) {
  return <tr ref={ref} data-slot="table-row" className={cn('hover:[&_td]:bg-[var(--color-surface-elevated)] data-[selected]:[&_td]:bg-[var(--color-selected)]', className)} {...props} />;
});
export const TableHead = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'th'>>(function TableHead({ className, ...props }, ref) {
  return <th ref={ref} data-slot="table-head" className={cn('sticky top-0 z-[1] min-w-[100px] border-b border-r border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-[var(--space-3)] py-[var(--space-2)] text-left font-medium text-[var(--color-text)] [&>span]:block [&>span]:max-w-[250px] [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>small]:mt-[3px] [&>small]:block [&>small]:text-[length:var(--font-size-meta)] [&>small]:font-normal [&>small]:text-[var(--color-text-muted)]', className)} {...props} />;
});
export const TableCell = forwardRef<HTMLTableCellElement, ComponentPropsWithRef<'td'>>(function TableCell({ className, ...props }, ref) {
  return <td ref={ref} data-slot="table-cell" className={cn('max-w-[270px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-[var(--color-hover)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--color-text-secondary)]', className)} {...props} />;
});
export const TableEmpty = forwardRef<HTMLDivElement, ComponentPropsWithRef<'div'>>(function TableEmpty({ className, ...props }, ref) {
  return <div ref={ref} data-slot="table-empty" className={cn('px-[var(--space-4)] py-[var(--space-10)] text-center text-[length:var(--font-size-body)] text-[var(--color-text-muted)]', className)} {...props} />;
});
