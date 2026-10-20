/**
 * Redirect stdout logging to stderr.
 *
 * The MCP stdio transport uses stdout as the JSON-RPC channel, so any stray
 * `console.log`/`console.info`/`console.debug` output (the ingest and repository
 * code is chatty) would corrupt the protocol. Importing this module first
 * reroutes those to stderr, which the MCP host treats as diagnostic logs.
 */

/* eslint-disable no-console */
console.log = (...args: unknown[]): void => console.error(...args);
console.info = (...args: unknown[]): void => console.error(...args);
console.debug = (...args: unknown[]): void => console.error(...args);
