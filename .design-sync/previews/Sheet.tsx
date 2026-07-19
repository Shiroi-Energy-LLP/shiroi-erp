import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
  Label, Select, Button,
} from '@repo/ui';

export function FilterSheet() {
  return (
    <Sheet open modal={false}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filter projects</SheetTitle>
          <SheetDescription>Narrow the list by stage and location.</SheetDescription>
        </SheetHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label htmlFor="s-stage">Stage</Label>
            <Select id="s-stage" defaultValue="installation">
              <option value="all">All stages</option>
              <option value="installation">Installation</option>
              <option value="handover">Handover</option>
            </Select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label htmlFor="s-city">City</Label>
            <Select id="s-city" defaultValue="chennai">
              <option value="chennai">Chennai</option>
              <option value="tiruppur">Tiruppur</option>
            </Select>
          </div>
        </div>
        <SheetFooter>
          <Button variant="ghost">Reset</Button>
          <Button variant="default">Apply filters</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
