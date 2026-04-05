import Link from 'next/link';
import { getVendors } from '@/lib/vendor-queries';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Eyebrow,
} from '@repo/ui';
import { Building2 } from 'lucide-react';

const VENDOR_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'panel_supplier', label: 'Panel Supplier' },
  { value: 'inverter_supplier', label: 'Inverter Supplier' },
  { value: 'structure_supplier', label: 'Structure Supplier' },
  { value: 'cable_supplier', label: 'Cable Supplier' },
  { value: 'electrical_supplier', label: 'Electrical Supplier' },
  { value: 'civil_contractor', label: 'Civil Contractor' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'labour_contractor', label: 'Labour Contractor' },
  { value: 'other', label: 'Other' },
];

interface VendorsPageProps {
  searchParams: Promise<{
    type?: string;
    search?: string;
  }>;
}

export default async function VendorsPage({ searchParams }: VendorsPageProps) {
  const params = await searchParams;
  const vendors = await getVendors({
    type: params.type || undefined,
    search: params.search || undefined,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow className="mb-1">VENDORS</Eyebrow>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#1A1D24]">Vendors</h1>
            <Badge variant="neutral">{vendors.length}</Badge>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex items-center gap-4">
            <Select name="type" defaultValue={params.type ?? ''} className="w-48">
              <option value="">All Types</option>
              {VENDOR_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Input
              name="search"
              defaultValue={params.search ?? ''}
              placeholder="Search company or vendor code..."
              className="w-64"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
            {(params.type || params.search) && (
              <Link href="/vendors">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor Code</TableHead>
                <TableHead>Company Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>City</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead>MSME</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-16">
                    <div className="flex flex-col items-center justify-center text-center">
                      <Building2 className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
                      <h2 className="text-lg font-heading font-bold text-[#1A1D24]">
                        No Vendors Found
                      </h2>
                      <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
                        {params.type || params.search
                          ? 'Try adjusting your filters.'
                          : 'No vendors have been added yet.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell>
                      <span className="text-[#00B050] font-medium">
                        {vendor.vendor_code ?? '---'}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {vendor.company_name}
                    </TableCell>
                    <TableCell className="capitalize">
                      {vendor.vendor_type?.replace(/_/g, ' ') ?? '---'}
                    </TableCell>
                    <TableCell>{vendor.city ?? '---'}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {vendor.gstin ?? '---'}
                    </TableCell>
                    <TableCell>
                      {vendor.is_msme ? (
                        <Badge variant="success">MSME</Badge>
                      ) : (
                        <span className="text-sm text-[#7C818E]">---</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {vendor.phone ?? '---'}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            vendor.is_active ? 'bg-[#00B050]' : 'bg-[#DC2626]'
                          }`}
                        />
                        <span className="text-sm text-[#7C818E]">
                          {vendor.is_active ? 'Yes' : 'No'}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
