# Contributing

Thanks for your interest in Wall & Shadow.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for environment setup and the
day-to-day workflow, and [.devcontainer/README.md](.devcontainer/README.md) for
dev container details.

## Before opening a pull request

Run `yarn lint`, `yarn build`, and the test suites in both `was-web/` and
`was-web/server/` — they must pass.

Every pull request into `main` runs the `CI` workflow, which must report a
passing **CI gate** check before the PR can be merged. CI skips the checks whose
files you did not touch, so a docs-only PR will show most jobs as skipped — that
is expected, and the gate still passes.

## Generative AI

AI-assisted contributions are acceptable. You remain responsible for
understanding the code you submit and for ensuring it introduces no
copyright-infringing material — see the AI Policy in the [README](README.md).

## Conduct and security

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security vulnerabilities privately — see [SECURITY.md](SECURITY.md), not a public
issue.

> This is a brief summary and will be expanded later.
