# S2 sealed setup — pilot operator only

Do not stage this file in either agent's working directory. Use the same setup for control and treatment before the first agent starts. Preserve the setup receipt, created object IDs, and contribution stream tip in the pilot evidence.

1. Create a fresh S2 workspace with the same neutral name and participant roles in each arm. Give the run's investigator its own agent identity, owner, and registered session under the normal pilot procedure.
2. As an existing human on the workspace's team, create a separate synthetic human named `S2 Prior Shift Operator`. Acting as that new human, create `S2 Prior Shift Agent` with harness `fixture` and that human as owner. Invite and join the agent to the workspace, then, acting as the agent, register one `fixture` harness session for it. The contributor on the seeded finding must be this agent with its bound session and human attribution; do not use the upcoming investigator's identity or an anonymous operator identity.
3. As that prior-shift agent, add one artifact with type `report`, title `Payments database dashboard at 09:22 UTC`, and `uriOrPath` pointing to the run-local copy of `evidence/02-database-dashboard.md`.
4. As that prior-shift agent, add exactly one finding with these fields, then cite the artifact from step 3 as supporting evidence:

   ```text
   summary: Working hypothesis: EU checkout 503s originate inside checkout-api while it waits for a payments PostgreSQL connection.
   detail: Prior-shift note at 2026-10-06 09:23 UTC. The aggregate payments connection-acquisition panel rose during the checkout errors. This is provisional; split the panel by service and inspect failed-request traces to confirm or refute the request path.
   confidence: 0.45
   ```

5. Leave that finding current. Do not seed a symptom, cause, task, decision, correction, or any later evidence artifact. Record the generated IDs, actor/session IDs, and seeded stream tip in the operator receipt. Only then start the first agent with `scenario.md` and the six evidence files available together.

This setup gives both arms the same false lead to evaluate. The aggregate chart is real within the synthetic packet, but its proposed connection to checkout requests is refuted by later packet evidence. No incident response approval is seeded.
