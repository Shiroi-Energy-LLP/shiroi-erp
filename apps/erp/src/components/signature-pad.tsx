'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Eraser, Undo2 } from 'lucide-react';

interface SignaturePadProps {
  label: string;
  width?: number;
  height?: number;
  onSignatureChange: (dataUrl: string | null) => void;
  initialDataUrl?: string | null;
}

export function SignaturePad({
  label,
  width = 300,
  height = 150,
  onSignatureChange,
  initialDataUrl,
}: SignaturePadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [hasSignature, setHasSignature] = React.useState(!!initialDataUrl);
  const strokesRef = React.useRef<ImageData[]>([]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#1A1D24';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Load initial signature if provided
    if (initialDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = initialDataUrl;
    }
  }, [width, height, initialDataUrl]);

  function getPosition(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      if (!touch) return { x: 0, y: 0 };
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDrawing(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    // Save current state for undo
    strokesRef.current.push(ctx.getImageData(0, 0, width, height));

    setIsDrawing(true);
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDrawing() {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasSignature(true);
    const canvas = canvasRef.current;
    if (canvas) {
      onSignatureChange(canvas.toDataURL('image/png'));
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    strokesRef.current = [];
    setHasSignature(false);
    onSignatureChange(null);
  }

  function handleUndo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || strokesRef.current.length === 0) return;
    const prev = strokesRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    if (strokesRef.current.length === 0) {
      setHasSignature(false);
      onSignatureChange(null);
    } else {
      onSignatureChange(canvas.toDataURL('image/png'));
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-n-700">{label}</label>
      <div className="relative border border-n-200 rounded-md overflow-hidden" style={{ width, height }}>
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-n-300">Sign here</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width, height, touchAction: 'none' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={handleUndo} className="h-7 text-xs">
          <Undo2 className="h-3 w-3 mr-1" /> Undo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleClear} className="h-7 text-xs">
          <Eraser className="h-3 w-3 mr-1" /> Clear
        </Button>
      </div>
    </div>
  );
}
