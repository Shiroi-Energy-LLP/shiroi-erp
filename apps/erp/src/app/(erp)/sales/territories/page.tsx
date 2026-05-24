/**
 * /sales/territories — Sales Territory Management
 *
 * Admin page for founder and marketing_manager roles only.
 * Lists all sales_territories with inline add / edit / toggle / deactivate actions.
 * Territories drive AI lead routing (S12 — F5).
 */

import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { listTerritories, listEmployeesForSelect } from '@/lib/sales-territories-queries';
import { TerritoriesTable } from './territories-table';

export const dynamic = 'force-dynamic';

export default async function TerritoriesPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'founder' && profile.role !== 'marketing_manager') {
    redirect('/dashboard');
  }

  const [territories, employees] = await Promise.all([
    listTerritories(),
    listEmployeesForSelect(),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-n-900">Sales Territories</h1>
        <p className="text-sm text-n-500 mt-1">
          Territory definitions drive AI lead routing. New leads are automatically assigned to the
          matching territory&apos;s default rep.
        </p>
      </div>

      <TerritoriesTable territories={territories} employees={employees} />
    </div>
  );
}
