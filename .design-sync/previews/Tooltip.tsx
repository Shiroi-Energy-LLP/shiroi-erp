import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Button } from '@repo/ui';

export function Hint() {
  return (
    <TooltipProvider>
      <div style={{ padding: '48px 24px', display: 'flex', justifyContent: 'center' }}>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button variant="outline">Net metering</Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Export–import billing with TNEB — surplus units offset your bill
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
