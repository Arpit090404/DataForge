import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Portal>
    <TooltipPrimitive.Positioner side="top" sideOffset={4} positionMethod="fixed" className="z-[70]">
      <TooltipPrimitive.Popup className="ui-tooltip-popup">{children}</TooltipPrimitive.Popup>
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>;
}
