'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { generateHandoverPack } from '@/lib/handover-actions';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Badge,
} from '@repo/ui';
import {
  FileCheck2, Download, RefreshCw, CheckCircle2, Clock, Package,
} from 'lucide-react';

interface HandoverPackProps {
  projectId: string;
  existingPack?: {
    id: string;
    version: number;
    generated_at: string;
    metadata: any;
  } | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function HandoverPack({ projectId, existingPack }: HandoverPackProps) {
  const router = useRouter();
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pack, setPack] = React.useState(existingPack);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);

    const res = await generateHandoverPack(projectId);
    setGenerating(false);

    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to generate');
    }
  }

  const metadata = pack?.metadata as any;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-[#7C818E]" />
            Handover Pack
            {pack && (
              <Badge variant="success" className="text-[10px]">v{pack.version}</Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            className="h-7 text-xs gap-1.5"
          >
            {generating ? (
              <><RefreshCw className="h-3 w-3 animate-spin" /> Generating...</>
            ) : pack ? (
              <><RefreshCw className="h-3 w-3" /> Regenerate</>
            ) : (
              <><FileCheck2 className="h-3 w-3" /> Generate</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-[#991B1B] mb-3">{error}</p>
        )}

        {!pack && !generating ? (
          <p className="text-sm text-[#9CA0AB] text-center py-4">
            Generate a handover pack to compile all project data into a customer-ready document.
          </p>
        ) : pack && metadata ? (
          <div className="space-y-4">
            {/* Generation info */}
            <div className="flex items-center gap-2 text-[11px] text-[#9CA0AB]">
              <Clock className="h-3 w-3" />
              Generated {formatDateTime(pack.generated_at)}
            </div>

            {/* System Summary */}
            <div className="rounded-lg bg-[#F5F6F8] p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#7C818E]">System</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-[#7C818E] text-xs">Size</span>
                  <p>{metadata.project?.systemSizeKwp} kWp</p>
                </div>
                <div>
                  <span className="text-[#7C818E] text-xs">Type</span>
                  <p className="capitalize">{metadata.project?.systemType?.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <span className="text-[#7C818E] text-xs">Panels</span>
                  <p>{metadata.system?.panelBrand} × {metadata.system?.panelQuantity}</p>
                </div>
                <div>
                  <span className="text-[#7C818E] text-xs">Inverter</span>
                  <p>{metadata.system?.inverterBrand}</p>
                </div>
              </div>
            </div>

            {/* Warranty Summary */}
            <div className="rounded-lg bg-[#F0FDF4] p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#065F46]">Warranty</p>
              <div className="space-y-1 text-sm">
                {metadata.warranty && Object.entries(metadata.warranty).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-[#00B050] flex-shrink-0" />
                    <span className="text-[#3F424D]">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Checklist */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Handover Checklist</p>
              <div className="space-y-1">
                {metadata.checklist?.map((item: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-[#3F424D]">
                    <div className="h-3.5 w-3.5 rounded border border-[#DFE2E8] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Net Metering */}
            {metadata.netMetering && (
              <div className="text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7C818E] mb-1">Net Metering</p>
                <p>
                  {metadata.netMetering.discomName} — App #{metadata.netMetering.applicationNumber ?? '—'}
                  {metadata.netMetering.netMeterInstalled && ` · Serial: ${metadata.netMetering.netMeterSerial}`}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
