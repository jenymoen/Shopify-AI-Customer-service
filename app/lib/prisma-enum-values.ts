// Plain copies of Prisma enum values that components need to render.
// Importing the enums from "@prisma/client" into component code drags Prisma into the browser bundle,
// whose bare module imports cannot be loaded and make client-side navigation to the page fail.
// The server still validates against the real enums.
export const AI_INSTRUCTION_TYPES = [
  "GENERAL",
  "TONE",
  "RETURNS",
  "SHIPPING",
  "COMPLAINTS",
  "PRODUCTS",
  "ESCALATION",
  "PROHIBITED_BEHAVIOR",
  "CUSTOM",
] as const;

export const ACTION_CATEGORY_WRITE = "WRITE";
