/** The mounted 3D view registers a function that renders one frame and returns it as a PNG data URL. */
let capture: (() => string) | null = null;
export const register3dCapture = (fn: (() => string) | null) => { capture = fn; };
export const capture3d = () => capture?.() ?? null;
