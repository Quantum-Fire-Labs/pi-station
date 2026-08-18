# Security Policy

## Supported versions

Security fixes are provided for the latest released version of Pi Station. Update to the latest release before you report a problem that might already be fixed.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/Quantum-Fire-Labs/pi-station/security/advisories/new).

Include:

- the affected version and operating system;
- steps to reproduce the problem;
- the expected and actual result;
- the possible impact; and
- a suggested fix, if available.

Do not include real API keys, Session files, credentials, or other private data.

## Security model

Pi Station is a local application. It starts Pi Sessions and tools with the authority of the operating-system user who runs it. A client that can connect to Pi Station can request actions that read files, change files, or run commands with that authority.

The server binds to `127.0.0.1` by default. Do not expose it directly to the public internet. If you use a tunnel or reverse proxy, you are responsible for access control, transport security, and origin configuration.

Pi owns Session history and runtime data. Pi Station stores its application settings separately. Do not copy, publish, or attach either data directory to a bug report without a careful review.

The optional OpenAI voice credential is encrypted at rest with a local key stored in the Pi Station data directory. Protect that directory with normal user-only filesystem permissions and backups.
