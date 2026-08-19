import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Pen,
  Eraser,
  Undo2,
  Trash2,
  Download,
  X,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  WhiteboardStroke,
  WhiteboardTool,
  subscribeWhiteboard,
  saveWhiteboardStroke,
  deleteWhiteboardStroke,
  clearWhiteboard,
  redrawCanvas,
  renderStroke,
} from '../lib/whiteboard';

const PRESET_COLORS = [
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Neon Green', value: '#10b981' },
  { name: 'Hot Pink', value: '#ec4899' },
  { name: 'Sunset Orange', value: '#f97316' },
  { name: 'Electric Violet', value: '#a855f7' },
  { name: 'Solar Yellow', value: '#eab308' },
  { name: 'Pure White', value: '#ffffff' },
  { name: 'Midnight Dark', value: '#1e293b' },
];

const BRUSH_SIZES = [
  { label: 'Fine', value: 2 },
  { label: 'Medium', value: 5 },
  { label: 'Thick', value: 10 },
  { label: 'Jumbo', value: 18 },
];

interface WhiteboardModalProps {
  meetingId: string;
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
  collaboratorsCount?: number;
}

export function WhiteboardModal({
  meetingId,
  userId,
  userName,
  isOpen,
  onClose,
  collaboratorsCount = 1,
}: WhiteboardModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState<string>('#06b6d4');
  const [size, setSize] = useState<number>(5);

  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentStrokeRef = useRef<WhiteboardStroke | null>(null);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // Notify transient banner
  const showToast = (msg: string) => {
    setStatusNotification(msg);
    setTimeout(() => {
      setStatusNotification((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  // 1. Subscribe to Firestore real-time strokes & clear events
  useEffect(() => {
    if (!isOpen || !meetingId) return;

    const unsubscribe = subscribeWhiteboard(meetingId, {
      onStrokes: (remoteStrokes) => {
        setStrokes(remoteStrokes);
      },
      onClear: (clearedBy) => {
        setStrokes([]);
        showToast(`${clearedBy} cleared the whiteboard`);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, meetingId]);

  // 2. Adjust canvas resolution & handle high-DPI scaling
  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Use internal coordinate resolution matching display size
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      redrawCanvas(canvas, strokes, currentStrokeRef.current);
    }
  }, [strokes]);

  useEffect(() => {
    if (!isOpen) return;
    syncCanvasSize();

    const handleResize = () => {
      syncCanvasSize();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen, syncCanvasSize]);

  // Redraw when strokes state updates
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    redrawCanvas(canvas, strokes, currentStrokeRef.current);
  }, [strokes]);

  // 3. Pointer event handlers for drawing (Mouse, Pen/Stylus, Touch)
  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    return {
      x: Math.max(0, Math.min(1, clientX / canvas.width)),
      y: Math.max(0, Math.min(1, clientY / canvas.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.setPointerCapture(e.pointerId);
    setIsDrawing(true);

    const pt = getNormalizedPoint(e);
    const newStroke: WhiteboardStroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      meetingId,
      userId,
      userName: userName || 'Participant',
      tool,
      color,
      size,
      points: [pt],
      createdAt: Date.now(),
    };

    currentStrokeRef.current = newStroke;

    // Immediate local render
    const ctx = canvas.getContext('2d');
    if (ctx) {
      renderStroke(ctx, newStroke, canvas.width, canvas.height);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStrokeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pt = getNormalizedPoint(e);
    const stroke = currentStrokeRef.current;
    stroke.points.push(pt);

    // Render new segment smoothly
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const len = stroke.points.length;
      if (len >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (stroke.tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0,0,0,1)';
          ctx.lineWidth = stroke.size * 2.5;
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.size;
        }

        const p1 = stroke.points[len - 2];
        const p2 = stroke.points[len - 1];
        ctx.beginPath();
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  const handlePointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStrokeRef.current) return;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    }

    setIsDrawing(false);
    const finishedStroke = currentStrokeRef.current;
    currentStrokeRef.current = null;

    if (finishedStroke && finishedStroke.points.length > 0) {
      // Optimistic local state
      setStrokes((prev) => [...prev, finishedStroke]);
      // Persist & broadcast to room via Firestore
      await saveWhiteboardStroke({ meetingId, stroke: finishedStroke });
    }
  };

  const handlePointerCancel = () => {
    setIsDrawing(false);
    currentStrokeRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      redrawCanvas(canvas, strokes);
    }
  };

  // 4. Undo action: Delete the user's most recent stroke
  const handleUndo = async () => {
    const userStrokes = strokes.filter((s) => s.userId === userId);
    if (userStrokes.length === 0) {
      showToast('No recent drawings to undo');
      return;
    }

    const lastStroke = userStrokes[userStrokes.length - 1];
    setStrokes((prev) => prev.filter((s) => s.id !== lastStroke.id));
    await deleteWhiteboardStroke(meetingId, lastStroke.id);
    showToast('Undid last stroke');
  };

  // 5. Clear whiteboard
  const handleConfirmClear = async () => {
    setShowClearConfirm(false);
    setStrokes([]);
    await clearWhiteboard(meetingId, userName);
    showToast('Whiteboard cleared');
  };

  // 6. Export canvas as PNG
  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a temporary canvas with dark background
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return;

    // Draw dark background
    exportCtx.fillStyle = '#080e1c';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw strokes
    for (const stroke of strokes) {
      renderStroke(exportCtx, stroke, exportCanvas.width, exportCanvas.height);
    }

    const url = exportCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${meetingId}-${Date.now()}.png`;
    a.click();
    showToast('Saved PNG to Downloads');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#060b17]/95 backdrop-blur-xl animate-in fade-in duration-200">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-primary/20 bg-card/60 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-bold text-foreground sm:text-lg">Collaborative Whiteboard</h2>
              <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono-ui text-[10px] font-semibold text-primary">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" /> LIVE
              </span>
            </div>
            <p className="font-mono-ui text-xs text-muted-foreground">
              Room {meetingId.slice(0, 8)} · Real-time synchronized canvas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Active Collaborators Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 py-1 font-mono-ui text-xs text-muted-foreground">
            <Users size={13} className="text-primary" />
            <span>{collaboratorsCount} in room</span>
          </div>

          {/* Export PNG */}
          <button
            onClick={handleExportPNG}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/40 hover:text-primary transition-colors"
            title="Download whiteboard image"
            data-testid="button-whiteboard-export"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>

          {/* Close / Minimize */}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-background/80 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
            title="Close whiteboard (keeps drawing active)"
            data-testid="button-whiteboard-close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Main Canvas Area & Floating Toolbar */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Canvas Container */}
        <div ref={containerRef} className="relative h-full w-full bg-[#080e1c] cursor-crosshair touch-none select-none">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            className="absolute inset-0 h-full w-full touch-none"
            data-testid="canvas-whiteboard"
          />

          {/* Empty Canvas Hint */}
          {strokes.length === 0 && !isDrawing && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center opacity-40">
              <Pen size={32} className="mb-2 text-primary animate-pulse" />
              <p className="font-display text-sm font-semibold text-foreground">Draw anything together</p>
              <p className="font-mono-ui text-xs text-muted-foreground">Every stroke is synced in real-time across all participants</p>
            </div>
          )}

          {/* Toast Notification Banner */}
          {statusNotification && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-primary/30 bg-black/80 px-4 py-1.5 font-mono-ui text-xs font-medium text-primary shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2">
              {statusNotification}
            </div>
          )}
        </div>

        {/* Floating Bottom Toolbar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex max-w-[95vw] flex-wrap items-center gap-1.5 rounded-2xl border border-primary/25 bg-[#0d1527]/90 p-2 shadow-2xl backdrop-blur-xl sm:gap-2">
          {/* Pen / Eraser Tools */}
          <div className="flex items-center rounded-xl bg-background/80 p-0.5 border border-border">
            <button
              onClick={() => setTool('pen')}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                tool === 'pen' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Pen Tool"
              data-testid="tool-pen"
            >
              <Pen size={14} />
              <span className="hidden sm:inline">Pen</span>
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                tool === 'eraser' ? 'bg-destructive text-destructive-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Eraser Tool"
              data-testid="tool-eraser"
            >
              <Eraser size={14} />
              <span className="hidden sm:inline">Eraser</span>
            </button>
          </div>

          {/* Color Palette (Visible when pen is selected) */}
          {tool === 'pen' && (
            <div className="flex items-center gap-1 px-1 border-x border-border/50">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`h-5 w-5 rounded-full transition-transform hover:scale-110 sm:h-6 sm:w-6 ${
                    color === c.value ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-110' : ''
                  }`}
                  title={c.name}
                />
              ))}
            </div>
          )}

          {/* Brush Sizes */}
          <div className="flex items-center gap-1 rounded-xl bg-background/80 p-0.5 border border-border">
            {BRUSH_SIZES.map((b) => (
              <button
                key={b.value}
                onClick={() => setSize(b.value)}
                className={`flex h-7 items-center justify-center rounded-lg px-2 font-mono-ui text-[11px] font-bold transition-all ${
                  size === b.value ? 'bg-primary/20 text-primary border border-primary/40' : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`${b.label} (${b.value}px)`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Undo Button */}
          <button
            onClick={handleUndo}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-background/80 text-foreground hover:border-primary/40 hover:text-primary transition-colors"
            title="Undo your last stroke"
            data-testid="button-whiteboard-undo"
          >
            <Undo2 size={15} />
          </button>

          {/* Clear Board Button */}
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex h-8 items-center gap-1 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 text-xs font-bold text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
            title="Clear the entire whiteboard for everyone"
            data-testid="button-whiteboard-clear"
          >
            <Trash2 size={14} />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl border border-destructive/40 bg-[#0d1527] p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/20 text-destructive mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="font-display text-lg font-bold text-foreground">Clear entire whiteboard?</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              This will clear all drawings on this whiteboard for every participant in the meeting. This action cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-card hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClear}
                className="rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground hover:opacity-90 shadow-sm"
                data-testid="button-confirm-clear"
              >
                Clear Board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
