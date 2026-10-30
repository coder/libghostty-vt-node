# Dogfood Proof Bundle

`dogfood/bootstrap/` records the commands and local outputs from the repository bootstrap, rerun after each Ghostty pin change. The bundle is intentionally plain text so a reviewer can inspect what was attempted without reproducing the environment first.

To rerun it, run `dogfood/regenerate.sh` from a checkout with the `mise.toml` toolchain. It runs `commands.sh` step by step and rewrites the output files and `environment.txt`.

Expected files:

- `commands.sh`
- `environment.txt`
- `native-info.json`
- `smoke-output.txt`
- `test-output.txt`
- `npm-pack-output.txt`
- optional terminal recording or screenshot when local tooling is available
