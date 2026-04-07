'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Eraser, Check } from 'lucide-react';

interface SignaturePadProps {
  label: string;
  name: string;
  defaultValue?: string | null;
  width?: number;
  height?: number;
}

export function SignaturePad({
  label,
  name,
  defaultValue,
  width = 400,
  height = 150,
}: SignaturePadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [isEmpty, setIsEmpty] = React.useState(!defaultValue);
  const [dataUrl, setDataUrl] = React.useState(defaultValue ?? '');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas resolution for retina
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Style
    ctx.strokeStyle = '#1A1D24';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Load existing signature if provided
    if (defaultValue) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = defaultValue;
    }
  }, [defaultValue, width, height]);

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0]!;
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    setIsEmpty(false);
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw() {
    if (!isDrawing) return;
    setIsDrawing(false);
    // Save to data URL
    const canvas = canvasRef.current;
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      setDataUrl(url);
    }
  }

  function clearPad() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setIsEmpty(true);
    setDataUrl('');
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-n-700">{label}</label>
      <div className="relative border border-n-300 rounded-md bg-white overflow-hidden" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          className="cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-n-400">Sign here</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={clearPad} className="h-7 text-xs gap-1">
          <Eraser className="h-3 w-3" /> Clear
        </Button>
        {!isEmpty && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <Check className="h-3 w-3" /> Captured
          </span>
        )}
      </div>
      {/* Hidden input to submit the data URL with the form */}
      <input type="hidden" name={name} value={dataUrl} />
    </div>
  );
}
