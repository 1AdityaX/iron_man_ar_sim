import { App } from './app/app';
import type { Settings } from './settings';
import './styles.css';

// URL parameters (all optional):
//   ?video=<url>      play a video file instead of the webcam
//   ?premirrored=1    that video is already mirrored (e.g. a screen recording of a selfie view)
//   ?autostart=1      skip the start screen
//   ?delegate=CPU     run hand tracking on the CPU instead of the GPU
//   ?clock=video      time gestures by the video file's timeline (deterministic replays)
//   ?mirror=0 ?debug=1 ?labels=0 ?occlusion=1 ?depthInvert=0   force a setting for this session
const params = new URLSearchParams(location.search);
const flag = (key: string): boolean | undefined =>
  params.has(key) ? !['0', 'false', 'off'].includes(params.get(key) ?? '') : undefined;

const overrides: Partial<Settings> = {};
for (const key of ['mirror', 'debug', 'labels', 'occlusion', 'depthInvert'] as const) {
  const v = flag(key);
  if (v !== undefined) overrides[key] = v;
}

const app = new App({
  videoUrl: params.get('video'),
  autostart: flag('autostart') ?? false,
  premirrored: flag('premirrored') ?? false,
  delegate: params.get('delegate')?.toUpperCase() === 'CPU' ? 'CPU' : undefined,
  videoClock: params.get('clock') === 'video',
  overrides,
});
app.boot();

// Handy for poking at the scene from the devtools console.
(window as unknown as { holo: App }).holo = app;
