/**
 * A QR encoder, in full, because a pass has to be scannable and the alternative is a network
 * request to somebody else's chart service for a code that identifies a resident's visitor.
 *
 * Byte mode, versions 1 to 10, all four error-correction levels — which covers every code this
 * product produces: a six-digit gate code, a receipt number, a short verification URL. Larger
 * payloads throw rather than silently producing something a scanner cannot read.
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Modules per side, including no quiet zone. */
  readonly size: number;
  /** Row-major, `true` is dark. */
  readonly modules: readonly boolean[];
  readonly version: number;
  readonly level: QrLevel;
}

/** Total codewords per version, 1 to 10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346] as const;

/** [error-correction codewords per block, blocks in group 1, data per block in group 1,
 *   blocks in group 2, data per block in group 2] */
type BlockPlan = readonly [number, number, number, number, number];

const PLANS: Readonly<Record<QrLevel, readonly BlockPlan[]>> = {
  L: [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
  ],
/* __APPEND__ */
};
