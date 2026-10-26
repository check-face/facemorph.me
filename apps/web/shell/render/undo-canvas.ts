// A raw face is painted before its lossy download is ready. Retain only the removed, already
// allocated canvas during the single Undo window so restoring it cannot change its pixels.
// Crossing the strip/pair/single boundary also remounts its siblings (at most two).
export function createUndoCanvas() {
  const held = new Map<string, { revision: number; canvas: HTMLCanvasElement }>();
  return {
    retain(id: string, revision: number, canvas: HTMLCanvasElement | null) {
      if (canvas?.dataset.faceDrawn === 'true') held.set(id, { revision, canvas });
    },
    release() {
      held.clear();
    },
    draw(canvas: HTMLCanvasElement, id: string, revision: number): boolean {
      if (canvas.dataset.undoFaceRevision === String(revision)) return true;
      const saved = held.get(id);
      if (!saved || saved.revision !== revision) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      if (canvas !== saved.canvas) {
        canvas.width = saved.canvas.width;
        canvas.height = saved.canvas.height;
        context.drawImage(saved.canvas, 0, 0);
      }
      canvas.dataset.faceDrawn = 'true';
      canvas.dataset.undoFaceRevision = String(revision);
      held.delete(id);
      return true;
    },
  };
}
