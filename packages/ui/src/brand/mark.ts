/**
 * The mark, as geometry.
 *
 * A house whose roofline continues into the numeral 1: the flag of the 1 is cut at exactly the
 * pitch of the left roof slope, so the two read as one stroke. Drawn as a single path with an
 * even-odd hole, in `currentColor`, on a 24-unit grid.
 *
 * No `<text>` element anywhere near it. The favicon it replaces was SVG text in a system font
 * stack, which is why it rasterised differently on every machine and, in a few places, not at
 * all. Geometry renders the same everywhere.
 *
 * `mark.svg` in this folder carries the identical path for the raster icon pipeline, which
 * needs a file rather than a module.
 */

/** The house: rounded apex, two symmetric roof slopes, rounded base corners. */
const HOUSE =
  'M11.06 2.62Q12 1.82 12.94 2.62L21.44 9.86Q22 10.34 22 11.08V20.2Q22 22 20.2 22H3.8Q2 22 2 20.2V11.08Q2 10.34 2.56 9.86Z';

/** The numeral, in negative space. Its flag runs parallel to the left roof slope. */
const NUMERAL = 'M6.2 8.04L10 4.8H15V21H10V10.05L8.79 11.08Z';

export const MARK_PATH = `${HOUSE}${NUMERAL}`;

export const MARK_VIEW_BOX = '0 0 24 24';

/** The product name, spelled one way, in one place. */
export const WORDMARK = 'OneResi';
