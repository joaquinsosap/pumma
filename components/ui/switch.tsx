"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Off has to be visibly OFF. It was surface2 behind a hairline border,
      // which on a white panel is white on white: you could not tell a
      // switch from a gap. A filled track and a firmer edge make the control
      // findable, and the thumb keeps a shadow so the two states differ in
      // shape as well as colour, not by colour alone.
      "peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border-[1.5px] border-faint2/70 bg-chip transition-colors hover:border-faint data-[state=checked]:border-primary data-[state=checked]:bg-primary",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[16px] w-[16px] rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.28)] ring-1 ring-black/5 transition-transform data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-[2px]",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
