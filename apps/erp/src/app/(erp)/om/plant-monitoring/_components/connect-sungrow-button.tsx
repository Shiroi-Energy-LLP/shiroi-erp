'use client';

import { Button } from '@repo/ui';
import { CheckCircle, Zap } from 'lucide-react';

interface ConnectSungrowButtonProps {
  /** Current OAuth status from inverter_monitoring_credentials.config.oauth_status */
  oauthStatus: string | null;
}

/**
 * "Authorize Sungrow" CTA button.
 *
 * Renders as an anchor wrapping a Button so browser navigation handles the
 * redirect through our GET /api/integrations/sungrow/authorize route.
 *
 * Label and variant change based on current authorization status:
 *   - not_authorized (or null) → "Authorize Sungrow" (default variant)
 *   - authorized → "Sungrow connected — re-authorize" (outline variant)
 */
export function ConnectSungrowButton({ oauthStatus }: ConnectSungrowButtonProps) {
  const isAuthorized = oauthStatus === 'authorized';

  return (
    <a href="/api/integrations/sungrow/authorize">
      <Button
        variant={isAuthorized ? 'outline' : 'default'}
        size="sm"
        className="h-8 text-xs gap-1.5"
      >
        {isAuthorized ? (
          <>
            <CheckCircle className="h-3.5 w-3.5" />
            Sungrow connected — re-authorize
          </>
        ) : (
          <>
            <Zap className="h-3.5 w-3.5" />
            Authorize Sungrow
          </>
        )}
      </Button>
    </a>
  );
}
