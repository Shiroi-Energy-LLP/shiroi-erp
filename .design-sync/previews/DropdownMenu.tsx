import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
  Button,
} from '@repo/ui';

export function RowActions() {
  return (
    <div style={{ padding: '16px 24px 200px', display: 'flex', justifyContent: 'center' }}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          <DropdownMenuItem>View project</DropdownMenuItem>
          <DropdownMenuItem>Edit BOM</DropdownMenuItem>
          <DropdownMenuItem>Download proposal</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
