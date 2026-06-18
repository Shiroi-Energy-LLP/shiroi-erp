'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, Pen } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui';
import { signDcCertificate } from '@/lib/dc-certificate-actions';
import {
  CERTIFICATE_TYPE_LABELS,
  CERTIFICATE_TYPE_ORDER,
  type CertificateType,
} from '@/lib/dc-certificate-constants';
import type { DcCertificateWithEmployee } from '@/lib/dc-certificate-queries';

// ---------------------------------------------------------------------------
// Signature Dialog
// ---------------------------------------------------------------------------

interface SignDialogProps {
  projectId: string;
  certificateType: CertificateType;
  onClose: () => void;
  onSigned: () => void;
}

function SignDialog({ projectId, certificateType, onClose, onSigned }: SignDialogProps) {
  const [customerName, setCustomerName] = React.useState('');
  const [customerPhone, setCustomerPhone] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerName.trim()) { setError('Customer name is required'); return; }
    if (!customerPhone.trim()) { setError('Customer phone is required'); return; }

    setBusy(true);
    setError(null);

    const res = await signDcCertificate({
      projectId,
      certificateType,
      customerName,
      customerPhone,
      notes: notes || undefined,
    });

    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    onSigned();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{CERTIFICATE_TYPE_LABELS[certificateType]}</DialogTitle>
          <DialogDescription>
            Collect the customer&apos;s name and phone to record their acknowledgement.
            OTP verification will be added in a future phase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-n-600 mb-1">
              Customer Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Full name as per KYC"
              className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-n-600 mb-1">
              Customer Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+91 99999 99999"
              className="w-full h-9 rounded-md border border-n-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-n-600 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional remarks"
              className="w-full rounded-md border border-n-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-shiroi-gold/30 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <DialogFooter className="pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Recording…' : 'Record Signature'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface DcCertificatesPanelProps {
  projectId: string;
  certificates: DcCertificateWithEmployee[];
  viewerRole: string | null;
}

export function DcCertificatesPanel({ projectId, certificates, viewerRole }: DcCertificatesPanelProps) {
  const router = useRouter();
  const [signingType, setSigningType] = React.useState<CertificateType | null>(null);

  const canSign = !!viewerRole && ['founder', 'project_manager', 'site_supervisor'].includes(viewerRole);

  // Build a map for O(1) lookup
  const certMap = Object.fromEntries(certificates.map((c) => [c.certificate_type, c]));

  function formatSignedAt(iso: string) {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="rounded-lg border border-n-200 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900">DC Certificates</h3>
        <p className="text-xs text-n-500 mt-0.5">Digital sign-off for completion, handover, and net metering</p>
      </div>

      <div className="space-y-3">
        {CERTIFICATE_TYPE_ORDER.map((type) => {
          const cert = certMap[type];
          const isSigned = !!cert?.signed_at;

          return (
            <div
              key={type}
              className={`flex items-start gap-3 p-3 rounded-lg border ${
                isSigned ? 'border-green-200 bg-green-50' : 'border-n-200 bg-n-50'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isSigned ? (
                  <CheckCircle2 className="h-4.5 w-4.5 text-green-600" />
                ) : (
                  <Clock className="h-4.5 w-4.5 text-n-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-n-800">
                  {CERTIFICATE_TYPE_LABELS[type]}
                </p>

                {isSigned && cert ? (
                  <div className="text-xs text-n-500 mt-1 space-y-0.5">
                    <p>
                      Signed by <span className="font-medium text-n-700">{cert.signed_by_customer_name}</span>
                      {' '}({cert.signed_by_customer_phone})
                    </p>
                    <p>
                      Witnessed by{' '}
                      <span className="font-medium text-n-700">
                        {cert.profiles?.full_name ?? 'Shiroi team'}
                      </span>
                      {' '}· {formatSignedAt(cert.signed_at!)}
                    </p>
                    {cert.notes && <p className="text-n-400 italic">{cert.notes}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-n-400 mt-0.5">Pending customer signature</p>
                )}
              </div>

              <div className="flex-shrink-0">
                {isSigned ? (
                  <Badge variant="success" className="text-[10px]">Signed</Badge>
                ) : canSign ? (
                  <button
                    onClick={() => setSigningType(type)}
                    className="flex items-center gap-1 text-xs text-shiroi-gold-dark hover:underline font-medium"
                  >
                    <Pen className="h-3 w-3" />
                    Sign
                  </button>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-n-400">Pending</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {signingType && (
        <SignDialog
          projectId={projectId}
          certificateType={signingType}
          onClose={() => setSigningType(null)}
          onSigned={() => router.refresh()}
        />
      )}
    </div>
  );
}
