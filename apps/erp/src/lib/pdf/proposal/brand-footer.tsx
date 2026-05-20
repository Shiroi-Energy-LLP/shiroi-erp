// apps/erp/src/lib/pdf/proposal/brand-footer.tsx
// Role: Shared page footer — "Reference: X | SHIROI ENERGY LLP | Page X of Y".
// Mode: shared (used by both detailed and quick proposals).
// Pinned to bottom of every page via absolute positioning.
import React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';

interface BrandFooterProps {
  proposalNumber: string;
  pageNum: number;
  totalPages: number;
}

export function BrandFooter({ proposalNumber, pageNum, totalPages }: BrandFooterProps) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 20,
        left: 40,
        right: 40,
      }}
    >
      {/* Brand-green hairline */}
      <View style={{ borderTopWidth: 0.75, borderTopColor: BRAND.green, marginBottom: 4 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 8, color: BRAND.gray500 }}>
          Reference: {proposalNumber}
        </Text>
        <Text style={{ fontSize: 8, color: BRAND.gray500 }}>
          SHIROI ENERGY LLP
        </Text>
        <Text style={{ fontSize: 8, color: BRAND.gray500 }}>
          Page {pageNum} of {totalPages}
        </Text>
      </View>
    </View>
  );
}
