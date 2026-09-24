export const meta = {
  name: "summarize-values",
  description: "Summarize a bounded list of numbers without provider calls.",
  args: {
    type: "object",
    properties: {
      values: { type: "array", items: { type: "number" }, maxItems: 100 },
    },
    required: ["values"],
    additionalProperties: false,
  },
  providers: [],
  limits: { maxCalls: 1, maxConcurrency: 1, timeoutMs: 5000 },
};

export async function run() {
  return {
    count: args.values.length,
    total: args.values.reduce((sum, value) => sum + value, 0),
  };
}
