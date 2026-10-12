export interface Settings {
  mirror: boolean;
  /** Pushing your hand toward the screen pushes held holograms away (and vice versa). */
  depthInvert: boolean;
  grayscale: boolean;
  /** Camera feed dimming, 0..0.9. */
  dim: number;
  labels: boolean;
  occlusion: boolean;
  debug: boolean;
  help: boolean;
  cameraId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  mirror: true,
  depthInvert: true,
  grayscale: false,
  dim: 0.4,
  labels: true,
  occlusion: false,
  debug: false,
  help: true,
  cameraId: null,
};

const KEY = 'holo-explorer:settings:v1';

/** Settings persist per browser; storage can be unavailable (private mode), which is fine. */
export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    const out = s as unknown as Record<string, unknown>;
    // Only accept stored values whose type matches the default (guards against stale shapes).
    for (const key of Object.keys(defaults)) {
      if (saved[key] !== null && typeof saved[key] === typeof defaults[key]) out[key] = saved[key];
    }
    if (typeof saved.cameraId === 'string') s.cameraId = saved.cameraId;
  } catch {
    // ignore unreadable storage
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore unavailable storage
  }
}
