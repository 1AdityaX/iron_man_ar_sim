import { describe, expect, it } from 'vitest';
import { shortCameraLabel } from '../src/input/camera';

describe('shortCameraLabel', () => {
  it('trims generic words and device ids', () => {
    expect(shortCameraLabel('MacBook Pro Camera')).toBe('MACBOOK PRO');
    expect(shortCameraLabel('FaceTime HD Camera (Built-in)')).toBe('FACETIME HD');
    expect(shortCameraLabel('Logitech BRIO (046d:085e)')).toBe('LOGITECH BRIO');
  });

  it('falls back when nothing is left', () => {
    expect(shortCameraLabel('')).toBe('WEBCAM');
    expect(shortCameraLabel('Integrated Webcam')).toBe('WEBCAM');
  });
});
