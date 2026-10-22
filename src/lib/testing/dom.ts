// Component tests: a jsdom document for React Testing Library under node:test.
// Import this module first in any *.test.tsx that renders.
import "global-jsdom/register";

// React 19 act() support outside a bundler.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
