import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Button, Badge,
} from '@repo/ui';

export function ProjectCard() {
  return (
    <Card style={{ maxWidth: 380 }}>
      <CardHeader>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <CardTitle>Kumar Residence — 8 kW</CardTitle>
          <Badge variant="success">Commissioned</Badge>
        </div>
        <CardDescription>On-grid rooftop · Adyar, Chennai · Net metered with TNEB</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ color: 'var(--muted-foreground, #7C818E)', fontSize: 11 }}>Project value</div>
            <div style={{ fontWeight: 600 }}>₹4,80,000</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted-foreground, #7C818E)', fontSize: 11 }}>Commissioned</div>
            <div style={{ fontWeight: 600 }}>21 Mar 2025</div>
          </div>
        </div>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button variant="outline" size="sm">View project</Button>
        <Button variant="ghost" size="sm">Download BOM</Button>
      </CardFooter>
    </Card>
  );
}

export function SimpleCard() {
  return (
    <Card style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>Payroll export</CardTitle>
        <CardDescription>Due in 3 days for 48 employees.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="default" size="sm">Run export</Button>
      </CardContent>
    </Card>
  );
}
