import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button,
} from '@repo/ui';

export function ConfirmDialog() {
  return (
    <Dialog open modal={false}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Approve this proposal?</DialogTitle>
          <DialogDescription>
            This sends the ₹4,80,000 quote to Kumar Residence and moves the lead to Won. You can’t undo this.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter style={{ marginTop: 20, gap: 8 }}>
          <Button variant="ghost">Cancel</Button>
          <Button variant="default">Approve &amp; send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
