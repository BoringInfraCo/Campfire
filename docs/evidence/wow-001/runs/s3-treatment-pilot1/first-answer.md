Investigation and record complete. Workspace `ws_66892b28c1d640a8`.

**Findings (9)** — symptom, gateway 504s, regional aggregate 26/402 IAD vs 0/388 ORD, IAD DB p95 140→1090→980 ms, inconclusive trace gap at ~10% sampling, sampled success gw-101, two hypotheses (DB latency; pre-app stall), and a conclusion that the cause is **not established**:
`find_4834f659837b4366`, `find_7267d5d770a94f53`, `find_128ca2d0ca984431`, `find_bce58bec5aa242a1`, `find_2672022d7a6a46b1`, `find_84e3e7c7d80c4f85`, `find_59e9cd2eb5cd4c9a`, `find_4228073accd84466`, `find_5c5b5222d8d34862`

**Artifacts (4)** — the four evidence files: `art_6aa8bc75b3c74f73`, `art_24d569d1427e486f`, `art_039c358aaf434d7c`, `art_7546bacd9f654b9d`

**Decisions (2, both `proposed` — not approved)**: evidence-first next step `dec_82ef0d50fb394a8a`; interim mitigation `dec_44cd603a30a54b97`

**Tasks (4)** — trace capture `task_3f84f2537b5744a3`, DB/pool metrics `task_31c304e8327b4f11`, retry/region check `task_3ff4477d51344c7e`, approval gate `task_f9f0f12445ac45d2`

**Citations**: basis `cit_0038593321a14bdd`, `cit_4e93edd6cdd140be`, `cit_09db88ec96a24d82`, `cit_1871da05aa004a08`, `cit_d31884281cd84cae`; evidence `fev_2516c9dfe0764315`, `fev_db5cd95dc6214e91`, `fev_47cdcbaacc6d4453`, `fev_24ff66ab2e4e4811`, `fev_55ef0a98784046a9`. Session `ses_c5b74dd631a2449c`.

Cause is explicitly left unresolved; no production change and no self-approval.
