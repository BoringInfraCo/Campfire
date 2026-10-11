# RCL-001 isolation

Freeze date: October 10, 2026. Scored runs have not started.

Answer keys and earlier outputs stay outside agent context. `ground-truth.md` is the answer key. Do not mount this directory, the contract, a prior transcript, or another scenario's packet into an agent session.

The control and Recall arms may receive only the matching task prompt from `scenarios.md`, their own credential, and the seeded workspace. The Recall arm may also receive the matching recall query. Neither arm receives the answer key.

The recipient arm gets only the packet and that scenario's neutral continuation task. Copy the continuation paragraph out alone. The recipient gets no exporter transcript, live workspace credential, scenario file, answer key, or prepared human summary. The packet is not a credential. A later live drill-down, if tested, uses the recipient's own credential and is a separate arm.
