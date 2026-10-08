Investigation complete. Root cause: `order-api-r184`'s `DB_POOL_MAX=4` (vs r183's 24) exhausted per-pod connection pools; pool-wait hit the 3000ms `CHECKOUT_TIMEOUT_MS`, producing ~40% 503s on r184 while the database stayed healthy. Response proposed (not approved): shift all traffic off r184 back to r183.

Created in `ws_03abec922ce74395`:

Artifacts: `art_7cde44ac92ff4e47`, `art_65daedc5950c46c5`, `art_fee50746f4304069`, `art_21329a1f063e4eed`, `art_ab369b6019b548a8`

Findings: `find_487c49f010e2462f` (symptom), `find_bdd8be12049749aa` (r184-localized), `find_122fad635ca64392` (config), `find_f9bfdcfb99e04917` (pool saturation), `find_0bea8b50bf5f4db5` (DB healthy), `find_115021c202d04b63` (rollout timeline), `find_67bfd43a9081400e` (cause), `find_6eb550ba79804a86` (uncertainties)

Decision (proposed): `dec_948d10692b3f4595` — basis `cit_229b763bc80a471d`, `cit_e0e0043572fc4ae9`, `cit_f4d9c69d68fb4ffa`, `cit_0106d83242d04c69`, `cit_280f17de5edd458d`

Evidence citations: `fev_1b24be6ebad149ac`, `fev_380a510038cc49f1`, `fev_597829d2822140d4`, `fev_77a50a9351f34976`

Tasks: `task_dd4149e1cb474603`, `task_0c8d6277cee64ce0`, `task_41e32820aca84e8b`, `task_5c0de7b1fa00453a`, `task_6c5227845eff4695` (approval, assigned to the human owner)

No production change made; decision left `proposed` pending authorization.
