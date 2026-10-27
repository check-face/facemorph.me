// A raw face is painted before its lossy download is ready. During the single Undo window,
// retain only already allocated, mounted canvases so restoring them cannot change their pixels.
// Remove also retains remounted siblings (at most two); Start over stays bounded by the DOM,
// including its virtual window. Expiry, replacement, Undo and unmount release unused references.
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
