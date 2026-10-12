/** MediaPipe hand landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const NUM_LANDMARKS = 21;

/** Joint chains per finger: thumb, index, middle, ring, pinky. */
export const FINGERS: readonly (readonly [number, number, number, number])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

export const FINGERTIPS = [4, 8, 12, 16, 20] as const;

/** Rigid-ish palm points used for depth estimation. */
export const PALM_POINTS = [0, 1, 2, 5, 9, 13, 17] as const;

/** Bones as landmark index pairs (fingers + palm outline). */
export const HAND_BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
  [0, 5], [5, 9], [9, 13], [13, 17], [0, 17],
];

/** Approximate finger thickness (radius, metres) per landmark, used for occlusion. */
export const LANDMARK_RADIUS: readonly number[] = [
  0.022, // wrist
  0.016, 0.013, 0.011, 0.0095, // thumb
  0.0115, 0.0095, 0.0085, 0.0078, // index
  0.0115, 0.0098, 0.0088, 0.008, // middle
  0.011, 0.0092, 0.0082, 0.0075, // ring
  0.0105, 0.0085, 0.0075, 0.007, // pinky
];
