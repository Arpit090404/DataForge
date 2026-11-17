import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type { ReactNode } from 'react';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverTitle = PopoverPrimitive.Title;

export function PopoverContent({ children }: { children: ReactNode }) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner side="bottom" align="end" sideOffset={4} positionMethod="fixed" className="z-50">
      <PopoverPrimitive.Popup className="ui-popover-popup" onKeyDown={event => event.stopPropagation()}>{children}</PopoverPrimitive.Popup>
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>;
}
