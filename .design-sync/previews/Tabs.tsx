import { Tabs, TabsList, TabsTrigger, TabsContent } from '@repo/ui';

export function ProjectTabs() {
  return (
    <Tabs defaultValue="overview" style={{ width: 460 }}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="bom">BOM</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="docs">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <div style={{ fontSize: 13, color: '#3F424D', lineHeight: 1.6 }}>
          <strong>Sunrise Textiles — 110 kW</strong><br />
          On-grid rooftop · Tiruppur · Net metering with TNEB · Value ₹58,20,000
        </div>
      </TabsContent>
      <TabsContent value="bom">
        <div style={{ fontSize: 13, color: '#3F424D' }}>172 line items · 2 pending purchase orders</div>
      </TabsContent>
      <TabsContent value="timeline">
        <div style={{ fontSize: 13, color: '#3F424D' }}>Installation 78% complete · commissioning 12 Apr 2025</div>
      </TabsContent>
      <TabsContent value="docs">
        <div style={{ fontSize: 13, color: '#3F424D' }}>Proposal, sanction letter, net-meter agreement</div>
      </TabsContent>
    </Tabs>
  );
}
