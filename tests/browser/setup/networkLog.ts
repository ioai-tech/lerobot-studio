import { commands } from 'vitest/browser';

// Name the network cause of a failed request (see scripts/vite/browserNetworkLog.ts).
await commands.logNetworkFailures();
