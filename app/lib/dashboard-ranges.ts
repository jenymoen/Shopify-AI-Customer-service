// Shared by the dashboard loader (server) and the range picker (browser), so it must not live in a .server module.
export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
