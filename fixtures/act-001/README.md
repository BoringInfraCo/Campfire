# fixtures/act-001

Synthetic Step 0 fixtures for ACT-001. No real provider data and no production
credentials. The frozen evidence lives in `docs/evidence/act-001/step-0/`.

- `verify.mjs` — recomputes the canonical intent digests, the source
  authority fingerprint, and the signed-payload HMACs, then cross-checks
  `answer-key.json`. Run: `node fixtures/act-001/verify.mjs`.
- `seed.ts` — isolated workspace seed (`seedAct001Database`).
- `github-rerun-stub.ts` — SIMULATED / FIXTURE EVIDENCE rerun-failed-jobs stub.
  Not a product runner and not live GitHub.
- `CLIENT.md` — documented client procedure. Campfire has no execute/run
  GitHub dispatch endpoint.
