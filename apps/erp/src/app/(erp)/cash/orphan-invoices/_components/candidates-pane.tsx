'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, Tabs, TabsList, TabsTrigger, TabsContent, Input, Skeleton } from '@repo/ui';
import { CandidateCard } from './candidate-card';
import { fetchCandidatesClient, fetchAllProjectsClient } from './_client-fetchers';
import type { CandidateProject } from '@/lib/orphan-triage-queries';

interface Props {
  zohoCustomerName: string | null;
}

export function CandidatesPane({ zohoCustomerName }: Props) {
  const [likely, setLikely] = useState<CandidateProject[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<CandidateProject[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!zohoCustomerName) { setLikely([]); return; }
    setLoading(true);
    fetchCandidatesClient(zohoCustomerName).then((c) => { setLikely(c); setLoading(false); });
  }, [zohoCustomerName]);

  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      fetchAllProjectsClient(search).then(setSearchResults);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  if (!zohoCustomerName) {
    return <Card><CardContent className="py-8 text-center text-[#7C818E] text-xs">Pick a customer →</CardContent></Card>;
  }

  return (
    <div className="space-y-2" style={{ height: '70vh', overflowY: 'auto' }}>
      <Tabs defaultValue="likely">
        <TabsList className="w-full">
          <TabsTrigger value="likely" className="flex-1">Likely ({likely.length})</TabsTrigger>
          <TabsTrigger value="all" className="flex-1">Search all</TabsTrigger>
        </TabsList>

        <TabsContent value="likely" className="space-y-2">
          {loading ? (
            <Skeleton className="h-32" />
          ) : likely.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-xs text-[#7C818E]">
              No likely matches. Try &quot;Search all&quot; or mark these invoices as &quot;No ERP match&quot;.
            </CardContent></Card>
          ) : (
            likely.map((p) => <CandidateCard key={p.project_id} project={p} />)
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-2">
          <Input
            placeholder="Search project number or customer name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searchResults.map((p) => <CandidateCard key={p.project_id} project={p} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
