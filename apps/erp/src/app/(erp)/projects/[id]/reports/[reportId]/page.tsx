import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ id: string; reportId: string }>;
}

export default async function ReportDetailRedirect({ params }: Props) {
  const { id, reportId } = await params;
  redirect(`/projects/${id}/reports`);
}
