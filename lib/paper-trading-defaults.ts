// Fallback sizing for a bot that's deployed and paper trading but hasn't
// cleared Go Live yet — BotConfiguration.totalBudget/maxStakePercentage
// are null until then (see prisma/schema.prisma), but the dry-run wallet,
// custom_stake_amount, and the dashboard's own budget summary still need
// real numbers for paper-trading results to mean anything. Kept in its
// own module (no server-only imports) so both server code (lib/deploy-bot.ts,
// lib/train-cloud.ts) and client components (components/BotCard.tsx) can
// import it without pulling crypto/Prisma into a client bundle.
export const DEFAULT_PAPER_TOTAL_BUDGET = 1000;
export const DEFAULT_PAPER_MAX_STAKE_PERCENTAGE = 20;
