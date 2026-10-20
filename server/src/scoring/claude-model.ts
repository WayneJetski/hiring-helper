/**
 * The Claude model used for scoring runs and criteria suggestions. Both run
 * through the host's Claude Code CLI; the app holds no API key.
 *
 * Override with the SCORING_MODEL env var (for example an Opus id for a tricky
 * job). Without an explicit model the headless CLI would inherit the caller's
 * default.
 */
export const SCORING_MODEL = process.env.SCORING_MODEL || 'claude-sonnet-5-5';
