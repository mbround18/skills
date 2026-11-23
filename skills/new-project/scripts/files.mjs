// The files new-project writes itself. Upstream generators (cargo new,
// create-vite, pnpm init) own the code; these are only our conventions on
// top: workspace roots, the gc-aware Makefile, Docker, compose, licence and
// docs. Each takes the project facts and returns the file's text.

import { readFileSync } from "node:fs";

export const DISCORD = "https://discord.gg/xpkrjV3dRJ";

export const LICENSES = {
  "bsd-3-clause": "BSD-3-Clause",
  mit: "MIT",
  "apache-2.0": "Apache-2.0",
};

export function licenseText({ license, author, year }) {
  if (license === "apache-2.0") {
    return readFileSync(new URL("../assets/licenses/Apache-2.0.txt", import.meta.url), "utf8");
  }
  if (license === "mit") {
    return `MIT License

Copyright (c) ${year} ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  }
  return `BSD 3-Clause License

Copyright (c) ${year}, ${author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;
}

export const gitignore = (p) =>
  [
    p.rust && "target/",
    p.web && "node_modules/",
    p.web && "dist/",
    ".env",
    ".env.*",
    "!.env.example",
    "*.log",
    "",
  ]
    .filter((l) => l !== false)
    .join("\n");

export const dockerignore = () => [".git", "target", "**/node_modules", "**/dist", ".env", ".env.*", "*.log", ""].join("\n");

export const cargoWorkspace = (p = {}) => `[workspace]
resolver = "3"
members = ["apps/*", "crates/*"]
${p.web ? 'exclude = ["apps/web"]\n' : ""}`;

export const pnpmWorkspace = () => `packages:
  - "apps/*"
  - "packages/*"
`;

/** Makefile: build depends on gc, so target/ and the BuildKit cache never grow unbounded. */
export function makefile(p) {
  const tab = "\t";
  const lines = ["GC_DAYS ?= 14", p.docker && "GC_DOCKER_KEEP ?= 40GB", "", ".PHONY: build check test gc", ""];
  lines.push("build: gc");
  if (p.web) lines.push(`${tab}pnpm install --frozen-lockfile`, `${tab}pnpm -r build`);
  if (p.rust) lines.push(`${tab}cargo build --workspace`);
  lines.push("", "check:");
  if (p.rust) {
    lines.push(`${tab}cargo fmt --all --check`, `${tab}cargo clippy --workspace --all-targets -- -D warnings`);
  }
  if (p.web) lines.push(`${tab}pnpm -r --if-present lint`, `${tab}pnpm -r build`);
  lines.push(`${tab}$(MAKE) test`, "", "test:");
  if (p.rust) lines.push(`${tab}cargo test --workspace`);
  if (p.web) lines.push(`${tab}pnpm -r --if-present test`);
  lines.push(
    "",
    "# Housekeeping never fails the build: missing tools or a stopped daemon only print a note.",
    "gc:",
  );
  if (p.rust) {
    lines.push(
      `${tab}@if command -v cargo-sweep >/dev/null 2>&1; then cargo sweep --time $(GC_DAYS) || true; \\`,
      `${tab}else echo "note: cargo-sweep not installed; cargo install cargo-sweep --locked"; fi`,
    );
  }
  if (p.docker) {
    lines.push(
      `${tab}@if docker info >/dev/null 2>&1; then docker builder prune -f --max-used-space $(GC_DOCKER_KEEP) >/dev/null || true; \\`,
      `${tab}else echo "note: docker isn't running; skipped the build-cache prune"; fi`,
    );
  }
  if (!p.rust && !p.docker) lines.push(`${tab}@true`);
  return `${lines.filter((l) => l !== false).join("\n")}\n`;
}

/** Axum server that serves the built frontend from a runtime-configurable directory. */
export const axumMain = () => `use std::net::SocketAddr;
use std::path::PathBuf;

use axum::{Router, routing::get};
use clap::Parser;
use tower_http::services::{ServeDir, ServeFile};

#[derive(Parser)]
struct Args {
    /// Built frontend to serve (apps/web/dist after \`pnpm -r build\`).
    #[arg(long, env = "STATIC_DIR", default_value = "apps/web/dist")]
    static_dir: PathBuf,
    /// Address to listen on.
    #[arg(long, env = "LISTEN", default_value = "0.0.0.0:8080")]
    listen: SocketAddr,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args = Args::parse();
    let index = ServeFile::new(args.static_dir.join("index.html"));
    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(ServeDir::new(&args.static_dir).fallback(index));
    let listener = tokio::net::TcpListener::bind(args.listen).await?;
    println!("listening on http://{}", args.listen);
    axum::serve(listener, app).await
}
`;

/** Multi-stage: cargo-chef for the Rust deps, pnpm fetch for the web deps, assets beside the binary. */
export function dockerfile(p) {
  const out = ["# syntax=docker/dockerfile:1"];
  if (p.rust) {
    out.push(
      "",
      "FROM rust:1-slim AS chef",
      "RUN cargo install cargo-chef --locked",
      "WORKDIR /app",
      "",
      "FROM chef AS planner",
      "COPY . .",
      "RUN cargo chef prepare --recipe-path recipe.json",
      "",
      "FROM chef AS builder",
      "COPY --from=planner /app/recipe.json recipe.json",
      "RUN cargo chef cook --release --recipe-path recipe.json",
      "COPY . .",
      `RUN cargo build --release --bin ${p.name}`,
    );
  }
  if (p.web) {
    out.push(
      "",
      "FROM node:lts-slim AS web",
      "RUN npm install -g pnpm",
      "WORKDIR /app",
      "COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./",
      "RUN pnpm fetch",
      "COPY . .",
      "RUN pnpm install --prefer-offline --frozen-lockfile && pnpm -r build",
    );
  }
  out.push("");
  if (p.rust) {
    out.push(
      "FROM debian:stable-slim",
      "RUN useradd --system --no-create-home app",
      `COPY --from=builder /app/target/release/${p.name} /usr/local/bin/${p.name}`,
    );
    if (p.web) out.push("COPY --from=web /app/apps/web/dist /srv/www", "ENV STATIC_DIR=/srv/www LISTEN=0.0.0.0:8080", "EXPOSE 8080");
    out.push("USER app", `CMD ["${p.name}"]`);
  } else {
    out.push(
      "FROM nginx:stable-alpine",
      "# Client-side routes fall back to index.html, so deep links work.",
      "RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  location / { try_files $uri $uri/ /index.html; }\\n}\\n' > /etc/nginx/conf.d/default.conf",
      "COPY --from=web /app/apps/web/dist /usr/share/nginx/html",
      "EXPOSE 80",
    );
  }
  return `${out.join("\n")}\n`;
}

export function compose(p) {
  const port = p.rust ? "8080:8080" : "8080:80";
  const svc = p.rust && !p.web ? "" : `\n    ports:\n      - "${port}"`;
  return `services:
  ${p.name}:
    build: .
    restart: \${RESTART_POLICY:-no}${svc}
`;
}

const layoutLines = (p) =>
  [
    p.rust && `- \`apps/${p.name}\`: the binary. A thin layer that wires the libraries together.`,
    p.rust && `- \`crates/${p.name}-core\`: library code and business logic.`,
    p.web && "- `apps/web`: the React + TypeScript frontend (Vite). Keep it thin too.",
    p.web && `- \`packages/core\`: shared TypeScript code the frontend builds on.`,
    "- `docs/guides`: user-facing guides.",
  ]
    .filter(Boolean)
    .join("\n");

export const readme = (p) => `# ${p.name}

${p.description || "One sentence on what this is and who it's for."}

## Getting started

${p.docker ? "```sh\ndocker compose up --build\n```\n\nThen open http://localhost:8080.\n" : "See [CONTRIBUTING.md](CONTRIBUTING.md) to build and run it.\n"}
Guides live in [docs/guides](docs/guides).

## Community

Join us on [Discord](${DISCORD}).

## License

${LICENSES[p.license]}. See [LICENSE](LICENSE).
`;

export const contributing = (p) => `# Contributing to ${p.name}

## Setup

You need:
${[p.rust && "- Rust (latest stable), plus `cargo install cargo-sweep --locked` for `make gc`", p.web && "- Node.js LTS and pnpm", p.docker && "- Docker with Compose"].filter(Boolean).join("\n")}

\`\`\`sh
make build   # also runs make gc first
make check   # lint, build and test: what CI runs
\`\`\`
${p.rust && p.web ? "\nDuring development, run the frontend with `pnpm --filter web dev`, and the server with `cargo run -p " + p.name + "` once `apps/web/dist` exists (`--static-dir` / `STATIC_DIR` points it elsewhere).\n" : ""}
## Layout

${layoutLines(p)}

${p.rust ? `To use the core crate from the binary: \`cargo add -p ${p.name} --path crates/${p.name}-core\`.\n\n` : ""}Entry points live in \`apps/\`. Everything reusable lives in ${[p.rust && "`crates/`", p.web && "`packages/`"].filter(Boolean).join(" and ")}, so replacing an app means little rewriting. Core logic talks to infrastructure through interfaces (ports), with adapters behind them.

## Conventions

- Every commit is signed.
- Small, focused changes. Tests first for core logic, and deterministic.
${p.web ? "- End-to-end tests use Playwright, split per feature so each runs alone.\n- Split frontend code with `React.lazy` and dynamic imports.\n" : ""}- Instrument with OpenTelemetry.
- New features: consider a runtime feature flag.
- Compose services use \`restart: \${RESTART_POLICY:-no}\`; production sets \`RESTART_POLICY\` in its own \`.env\`.

## Disk hygiene

\`make gc\` (run by \`make build\`) trims ${[p.rust && "`target/` output older than `GC_DAYS` (14) days", p.docker && "the Docker build cache to `GC_DOCKER_KEEP` (40GB)"].filter(Boolean).join(" and ") || "nothing yet"}. It never fails the build.
`;

export const guidesReadme = (p) => `# ${p.name} guides

Everything a user needs to learn to use ${p.name} goes here, one guide per task.
`;

export const coreIndex = () => `/** Shared code for the apps. Keep it free of framework and transport details. */
export const ready = true;
`;
