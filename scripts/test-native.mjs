import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env };
if (process.platform === 'darwin' && !env.DEVELOPER_DIR && existsSync('/Library/Developer/CommandLineTools')) env.DEVELOPER_DIR = '/Library/Developer/CommandLineTools';
execFileSync('cargo', ['test','--locked','--manifest-path', `${root}/rust-core/Cargo.toml`], { cwd:root, env, stdio:'inherit' });
