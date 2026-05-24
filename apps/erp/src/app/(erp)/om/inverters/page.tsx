import * as React from 'react';
import { redirect } from 'next/navigation';
import {
  listInverters,
  listRecentPollFailures,
  listInverterMonitoringCredentials,
  getAllProjectsForInverters,
  getCurrentUserRole,
} from '@/lib/inverters-queries';
import { InverterTable } from './_components/inverter-table';
import { AddInverterDialog } from './_components/add-inverter-dialog';
import { RecentFailures } from './_components/recent-failures';

const ALLOWED_ROLES = ['founder', 'om_technician', 'project_manager'];

export default async function InvertersPage() {
  const { userId, role } = await getCurrentUserRole();

  if (!userId) redirect('/login');
  if (!role || !ALLOWED_ROLES.includes(role)) redirect('/dashboard');

  const [inverters, failures, allProjects, monitoringCredentials] = await Promise.all([
    listInverters(),
    listRecentPollFailures(20),
    getAllProjectsForInverters(),
    listInverterMonitoringCredentials(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Inverters{' '}
            <span className="text-sm font-normal text-n-500">({inverters.length} total)</span>
          </h1>
          <p className="text-xs text-n-500 mt-0.5">
            Manage inverter master records, polling configuration, and health status.
          </p>
        </div>
        <AddInverterDialog
          projects={allProjects}
          monitoringCredentials={monitoringCredentials}
        />
      </div>

      <React.Suspense fallback={<div className="text-xs text-n-500 py-4">Loading…</div>}>
        <InverterTable inverters={inverters} />
      </React.Suspense>

      {failures.length > 0 && <RecentFailures failures={failures} />}
    </div>
  );
}
