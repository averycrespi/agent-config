export const meta = {
  name: "launch-worker",
  description:
    "Prepare or submit one authorized coordinated Pi worker; never accept its assignment.",
  args: {
    type: "object",
    properties: {
      phase: { type: "string", enum: ["prepare", "submit"] },
      repo: {
        type: "string",
        pattern: "^/[^\\u0000-\\u001f]+$",
        maxLength: 1024,
      },
      index_id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" },
      launch_id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" },
      helper_path: {
        type: "string",
        pattern: "^/[^\\u0000-\\u001f]+/launch-worker.js$",
        maxLength: 1024,
      },
    },
    required: ["phase", "repo", "index_id", "launch_id", "helper_path"],
    additionalProperties: false,
  },
  providers: ["builtins"],
  limits: { maxCalls: 1, maxConcurrency: 1, timeoutMs: 120000 },
};

export async function run() {
  const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  const command = [
    "node",
    args.helper_path,
    args.phase,
    args.repo,
    args.index_id,
    args.launch_id,
  ]
    .map(quote)
    .join(" ");
  const r = await builtins.bash({ command, timeout: 110 });
  if (
    r.isError ||
    r.details?.truncation?.truncated ||
    r.details?.fullOutputPath ||
    !Array.isArray(r.content) ||
    r.content.some((b) => b.type !== "text")
  )
    throw Error(
      "launch result unavailable; reconcile existing index, never replay",
    );
  const result = JSON.parse(r.content.map((b) => b.text).join(""));
  if (
    result.launchId !== args.launch_id ||
    ![
      "prepared",
      "execution-confirmed",
      "blocked",
      "submitted-unconfirmed",
      "failed",
    ].includes(result.status)
  )
    throw Error("invalid launch receipt; reconcile existing index");
  return result;
}
