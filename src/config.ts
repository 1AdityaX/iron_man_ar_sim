/**
 * Every tunable in one place. Distances are metres in camera space unless noted;
 * times are milliseconds unless noted.
 */
export const CONFIG = {
  camera: {
    idealWidth: 1280,
    idealHeight: 720,
    /** Horizontal field of view assumed for the webcam; only affects absolute depth readouts. */
    assumedHFovDeg: 63,
  },

  assets: {
    localWasm: 'mediapipe/wasm',
    cdnWasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
    localModel: 'models/hand_landmarker.task',
    cdnModel:
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },

  tracking: {
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
    /** Keep a hand "alive" this long after the tracker drops it, so grabs survive blips. */
    lostGraceMs: 260,
    /**
     * Matching detections to hands across frames. Distances are in hand sizes (wrist to middle
     * knuckle) per nominal frame; a hand rarely moves more than ~0.7 of its size between frames.
     */
    nominalFrameMs: 1000 / 30,
    /** What starting a new hand costs; a detection nearer than this to a tracked hand stays with it. */
    spawnCost: 2,
    /** Penalty for going against a fully confident left/right label. */
    labelWeight: 0.6,
    /** How fast a hand's running label agreement follows each new label (per frame). */
    labelTrustRate: 0.15,
    /** Below this agreement the hand is handed over to the side its labels keep naming. */
    labelHandover: -0.5,
    /**
     * Re-finding a tracked hand the full-frame pass lost, usually because it is far away: the
     * palm detector sees the whole frame shrunk to 192 px, where a distant hand is a few pixels
     * wide. The tracker looks again in a zoomed square crop around where the hand just was.
     * Sizes are in hand lengths (wrist to middle knuckle).
     */
    refind: {
      enabled: true,
      /** Crop side in hand lengths, growing by `growPerFrame` for each frame the hand was missed. */
      cropHands: 5,
      growPerFrame: 0.2,
      /** Smallest crop side in video pixels. */
      minCropPx: 160,
      /** Palm detection threshold inside the crop, where a hand was just seen. */
      minDetectionConfidence: 0.5,
      /** The crop is scaled into a square canvas this size before detection. */
      canvasPx: 256,
      /**
       * How far from where it was a re-found hand may be (plus 15% per missed frame). A fast hand
       * moves about one hand length per frame at 30 fps.
       */
      reach: 1.5,
      /** A re-found hand this close to one the full-frame pass already has is that same hand. */
      duplicateDist: 0.5,
    },
    /** One Euro filter for normalized image landmarks (units: image fractions). */
    imageFilter: { minCutoff: 1.6, beta: 9, dCutoff: 1.0 },
    /** One Euro filter for world landmarks (units: metres). */
    worldFilter: { minCutoff: 1.2, beta: 6, dCutoff: 1.0 },
    /** One Euro filter for the estimated hand distance (units: metres). */
    depthFilter: { minCutoff: 0.6, beta: 1.5, dCutoff: 1.0 },
    minDepth: 0.2,
    maxDepth: 3.0,
  },

  // Thresholds calibrated against MediaPipe output on real footage.
  hand: {
    /** thumb-tip to index-tip distance divided by palm length. */
    pinchEnter: 0.3,
    pinchExit: 0.48,
    /**
     * Index-tip extension (tip-to-wrist / palm length) separates a pinch, where the index reaches
     * out to the thumb, from a fist, where it is tucked in (fists measured 0.72-1.01, pinches 1.1+).
     */
    pinchMinIndexExt: 1.06,
    pinchHoldIndexExt: 0.95,
    fistEnter: 0.6,
    fistExit: 0.42,
    fistMaxIndexExt: 1.12,
    fistHoldIndexExt: 1.3,
    pointIndexMaxCurl: 0.42,
    pointIndexMinExt: 1.55,
    pointOthersMinCurl: 0.5,
    openMax: 0.3,
    /** A state must hold this long before it flips (debounce). */
    debounceMs: 45,
  },

  gestures: {
    pinchHoldMs: 650,
    /** Pinch-hold is cancelled if the pinch drifts further than this fraction of screen height. */
    pinchHoldMoveTolerance: 0.06,
    /**
     * The hand that opened a menu steers it only after sliding this far with a firm pinch
     * (fraction of screen height). A menu pushed off the hand by a screen edge or the gesture
     * guide would otherwise select whatever option landed under the pinch on release.
     */
    menuArmMove: 0.04,
    partInfoHoldMs: 700,
    flickMinSpeed: 1.15, // screen heights per second
    flickEndSpeed: 0.45,
    flickMaxMs: 260,
    flickCooldownMs: 380,
    twistDeg: 62,
    twistWindowMs: 900,
    twistCooldownMs: 900,
    twistMaxTravel: 0.22, // screen heights the fist may wander while twisting
    pullApartGain: 0.16, // metres the fists must separate
    pullApartRatio: 1.5,
    pullApartWindowMs: 700,
    palmsTogetherDist: 0.15,
    palmsTogetherMinMs: 180,
    palmsApartDist: 0.32,
    palmsApartWindowMs: 1100,
    clapFromDist: 0.24,
    clapToDist: 0.13,
    clapWindowMs: 380,
    clapCooldownMs: 1000,
    twoHandCooldownMs: 1200,
  },

  objects: {
    spawnScale: 0.5,
    minScale: 0.15,
    maxScale: 2.5,
    spawnDepthMin: 0.45,
    spawnDepthMax: 1.3,
    /** How strongly hand depth changes push grabbed objects. */
    depthGain: 1.6,
    minDepth: 0.25,
    maxDepth: 4.0,
    spinDamping: 0.55,
    maxSpin: 14,
    flickSpinGain: 5.5, // rad/s per (screen heights / s)
  },

  render: {
    maxPixelRatio: 1.5,
    bloomStrength: 0.8,
    bloomRadius: 0.45,
    bloomThreshold: 0.24,
  },
} as const;

export type Config = typeof CONFIG;
