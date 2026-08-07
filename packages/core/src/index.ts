/**
 * @adp/core — domain model and calculation engines.
 *
 * This package has no dependency on Electron, the DOM, or any renderer. It runs
 * unchanged in the Electron main process, in the renderer, and under plain Node
 * in tests. Every number that reaches a user passes through here.
 */

export * from './units.js';
export * from './geometry.js';

export * from './model/ids.js';
export * from './model/architecture.js';
export * from './model/design.js';
export * from './model/guard.js';

export * from './catalogue/materials.js';
export * from './catalogue/furniture.js';

export * from './themes/theme.js';

export * from './design/clearance.js';

export * from './takeoff/takeoff.js';

export * from './pricing/source.js';
export * from './pricing/price.js';

export * from './estimate/labour.js';
export * from './estimate/estimate.js';

export * from './sourcing/landed-cost.js';

export * from './boq/boq.js';

export * from './ai/contracts.js';

export * from './project.js';
