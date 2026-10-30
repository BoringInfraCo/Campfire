# Superseded MAC-001 iMac run procedure

**Prepared:** October 26, 2026. **State:** Canceled as a MAC-001 exit gate by the founder on October 26. The physical iMac run did not occur; the prepared artifact and procedure are retained as historical preparation, not acceptance evidence. MAC-002 owns integrated two-Mac native inspection and MAC-003 owns packaged-app compatibility if those sprints proceed.

## Artifact prepared on the MacBook

- Private transfer ZIP: `release/mac-001/Campfire-MAC-001-iMac-2026-10-26.zip` (ignored build output, not a public release).
- SHA-256: `93b1f0e4cd5122a25dafbe7e1bed75351a309af0b1c03e15a865af90414a01da`.
- Contents: one ad hoc signed `Campfire MAC-001.app` for Darwin ARM64, target macOS 13 or later. The ZIP was unpacked locally and `codesign --verify --deep --strict` passed; `plutil -lint` passed; no AppleDouble entries or Campfire credentials/Arbora IDs were found in the app binary.
- Source file SHA-256: `CampfireReadOnly.swift` `df04ba70d895335559b779e19dad5a221214973797204a1c828288396bb826f0`; `Info.plist` `1d78be5e832dea843cbdff8f5245b2fefdbf57579392791f1e33743d8727863f`; `build.sh` `722a5aade50b408ecf799a0288d6caa078ca64c1ce12ee8ea1112c4900599e87`.

## iMac procedure

1. Transfer only the ZIP privately (AirDrop or direct file transfer). On the iMac, verify its SHA-256 before opening. Unpack it into a private temporary folder and run `codesign --verify --deep --strict` on the app. Record macOS version and chip. Do not remove quarantine or defeat a macOS security warning programmatically; if macOS asks for approval to run this ad hoc signed prototype, the human makes that choice.
2. Locate the iMac's existing **remote Arbora** Campfire profile. Use installed Campfire's `status --output json` to confirm remote mode, hosted workspace `ws_df6794f33efc459b`, and one open task. Do not create a local workspace, change credentials, or paste a MacBook profile. If the default profile is another identity, set `CAMPFIRE_CONFIG_DIR` to the existing Arbora profile for every command.
3. In a continuing terminal, start that profile's read-only loopback Viewer with `campfire up --no-open --no-connect`. This avoids changing an existing Codex/OpenCode MCP configuration. Confirm `http://127.0.0.1:9415/` responds and the Viewer presents Arbora. If port 9415 is already owned by another process, stop and identify it rather than pointing the app at an unknown listener.
4. Open `Campfire MAC-001.app`. Compare the app's workspace ID, goal, task/finding IDs, and returned/total counts to the same iMac actor's authorized CLI or Viewer reads. Select the task and finding; verify each selected detail belongs to that same record. The app should show `task_3795d9d37d3842e9` and `find_5cd543722a044c20` in complete 1-of-1 slices if the hosted Arbora state has not changed. If it has changed, report the new IDs/counts and compare to a fresh Campfire read rather than forcing these expected values.
5. Observe the accessible workspace picker, Refresh button, and record buttons. Use `⌘R` once. If safe to stop the Viewer process you started, stop it and refresh again: the app should label the previous data **Stale view** rather than presenting it as current. Do not mutate the hosted workspace to create a test state.

## Report back

Record: archive checksum result, signature result, macOS/chip, installed Campfire version and profile mode, Viewer endpoint/ownership, app launch outcome, workspace/task/finding IDs and counts from **both** app and Campfire, selected-detail and refresh results, stale-state result if exercised, any macOS warning, and any mismatch. Do not include bearer tokens, invitation links, private profile files, or full workspace text.

This procedure is no longer required to close MAC-001. Running it later would be new evidence for a later native sprint, not retroactive proof that MAC-001 was tested on the iMac. The separate Cloud sharing and update acceptance gates are unchanged.
