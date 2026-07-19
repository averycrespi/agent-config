# Security

Review the supplied target for exploitable vulnerabilities, unsafe trust boundaries, and security regressions. Apply the shared scope, evidence, confidence, severity, and output contract supplied before this rubric.

Focus on:

- SQL, command, XSS, template, and other injection paths
- authentication, authorization, and privilege-boundary flaws
- credentials, tokens, private data, or sensitive diagnostics exposed in code or output
- untrusted input reaching files, commands, URLs, queries, templates, or deserializers without adequate validation
- path traversal, SSRF, insecure deserialization, and unsafe redirects
- weak cryptography or incorrect secret/key/nonce handling
- unsafe CORS, security headers, or externally reachable defaults
- prompt-injection paths where external content can influence privileged tools or instructions

Trace attacker-controlled data to a meaningful sink. Do not report generic hardening advice without an evidenced path and impact.
