<!-- tomorrow: {{ISO timestamp, new Date().toISOString()}} -->
# Tomorrow

Where {{project}} stood at the end of {{date}}, and how to be working again
ten minutes after a restart.

## State of the tree

- **{{branch}}** (`{{checkout}}`): HEAD `{{head}}`, {{clean|dirty}},
  {{pushed|not pushed — why}}.
  Uncommitted:
  - `{{path}}` — what it changes; ready / not ready; what refused it.

## First thing

```bash
cd {{checkout}}
git status --short            # expect: the files listed above
```

1. …
2. …

## Runs in flight

- {{what}} started {{when}}; log at `{{path}}` (may be gone). Showed so
  far: … Next: …

## What shipped

- {{spec/ticket}}: one line. Proven by `{{test}}`.

## Still owed

- …
- Owner questions (answer in the spec, not here): …

## Things that cost time

- …

## Standing constraints

- Secrets live in …; never echo them into a commit, image, log or PR.
- Signing key …; never a session link in a commit.
