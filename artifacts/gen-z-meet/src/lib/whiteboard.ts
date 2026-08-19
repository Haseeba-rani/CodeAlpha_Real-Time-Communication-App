import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

export type Point = {
  x: number; // Normalized coordinate 0.0 to 1.0
  y: number; // Normalized coordinate 0.0 to 1.0
};

export type WhiteboardTool = 'pen' | 'eraser';

export type WhiteboardStroke = {
  id: string;
  meetingId: string;
  userId: string;
  userName: string;
  tool: WhiteboardTool;
  color: string;
  size: number; // Normalized stroke thickness (relative to canvas width, or base pixel width)
  points: Point[];
  createdAt: number;
};

export type WhiteboardMeta = {
  clearedAt?: number;
  clearedBy?: string;
};

/**
 * Save a completed stroke to Firestore
 */
export async function saveWhiteboardStroke({
  meetingId,
  stroke,
}: {
  meetingId: string;
  stroke: WhiteboardStroke;
}): Promise<void> {
  if (!meetingId || !stroke || stroke.points.length === 0) return;
  try {
    const strokeRef = doc(db, 'rooms', meetingId, 'strokes', stroke.id);
    await setDoc(strokeRef, {
      ...stroke,
      serverTime: serverTimestamp(),
    });
  } catch (err) {
    console.error('[Whiteboard] Failed to save stroke:', err);
  }
}

/**
 * Delete a stroke (for Undo)
 */
export async function deleteWhiteboardStroke(meetingId: string, strokeId: string): Promise<void> {
  if (!meetingId || !strokeId) return;
  try {
    const strokeRef = doc(db, 'rooms', meetingId, 'strokes', strokeId);
    await deleteDoc(strokeRef);
  } catch (err) {
    console.error('[Whiteboard] Failed to delete stroke:', err);
  }
}

/**
 * Clear the entire whiteboard for all participants
 */
export async function clearWhiteboard(meetingId: string, userName: string): Promise<void> {
  if (!meetingId) return;
  try {
    // 1. Update whiteboard meta document to signal immediate clear
    const metaRef = doc(db, 'rooms', meetingId, 'whiteboard_state', 'meta');
    await setDoc(metaRef, {
      clearedAt: Date.now(),
      clearedBy: userName || 'Host',
      updatedAt: serverTimestamp(),
    });

    // 2. Batch-delete stroke documents in the background
    const strokesCol = collection(db, 'rooms', meetingId, 'strokes');
    const snapshot = await getDocs(strokesCol);
    if (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.docs.forEach((docItem) => {
        batch.delete(docItem.ref);
      });
      await batch.commit();
    }
  } catch (err) {
    console.error('[Whiteboard] Failed to clear whiteboard:', err);
  }
}

/**
 * Subscribe to real-time whiteboard strokes and clear events
 */
export function subscribeWhiteboard(
  meetingId: string,
  callbacks: {
    onStrokes: (strokes: WhiteboardStroke[]) => void;
    onClear?: (clearedBy: string) => void;
  }
): () => void {
  if (!meetingId) return () => {};

  let lastClearedTime = 0;

  // 1. Listen for clear events
  const metaRef = doc(db, 'rooms', meetingId, 'whiteboard_state', 'meta');
  const unsubscribeMeta = onSnapshot(metaRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data() as WhiteboardMeta;
      if (data.clearedAt && data.clearedAt > lastClearedTime) {
        lastClearedTime = data.clearedAt;
        callbacks.onClear?.(data.clearedBy || 'Participant');
      }
    }
  });

  // 2. Listen for strokes collection
  const strokesCol = collection(db, 'rooms', meetingId, 'strokes');
  const strokesQuery = query(strokesCol, orderBy('createdAt', 'asc'));

  const unsubscribeStrokes = onSnapshot(
    strokesQuery,
    (snapshot) => {
      const strokes: WhiteboardStroke[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as WhiteboardStroke;
        if (data.createdAt >= lastClearedTime) {
          strokes.push({
            ...data,
            id: docSnap.id,
          });
        }
      });
      callbacks.onStrokes(strokes);
    },
    (err) => {
      console.warn('[Whiteboard] Real-time stroke subscription warning:', err);
    }
  );

  return () => {
    unsubscribeMeta();
    unsubscribeStrokes();
  };
}

/**
 * Render a single stroke onto a 2D canvas context using normalized coordinates
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WhiteboardStroke,
  canvasWidth: number,
  canvasHeight: number
) {
  if (!stroke.points || stroke.points.length === 0) return;

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

  const pts = stroke.points;
  const firstX = pts[0].x * canvasWidth;
  const firstY = pts[0].y * canvasHeight;

  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(firstX, firstY, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.fill();
  } else {
    ctx.moveTo(firstX, firstY);
    for (let i = 1; i < pts.length; i++) {
      const currX = pts[i].x * canvasWidth;
      const currY = pts[i].y * canvasHeight;
      // Midpoint quadratic curve for smoother lines
      const prevX = pts[i - 1].x * canvasWidth;
      const prevY = pts[i - 1].y * canvasHeight;
      const midX = (prevX + currX) / 2;
      const midY = (prevY + currY) / 2;
      ctx.quadraticCurveTo(prevX, prevY, midX, midY);
    }
    const lastX = pts[pts.length - 1].x * canvasWidth;
    const lastY = pts[pts.length - 1].y * canvasHeight;
    ctx.lineTo(lastX, lastY);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Redraw all strokes onto the canvas
 */
export function redrawCanvas(
  canvas: HTMLCanvasElement,
  strokes: WhiteboardStroke[],
  activeStroke?: WhiteboardStroke | null
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  // Render saved strokes
  for (const stroke of strokes) {
    renderStroke(ctx, stroke, width, height);
  }

  // Render current in-progress stroke
  if (activeStroke) {
    renderStroke(ctx, activeStroke, width, height);
  }
}
