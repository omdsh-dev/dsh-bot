# InfoFlow guided onboarding

The per-Bot InfoFlow editor includes a creation guide, local parsing of labeled or JSON credential copies, an optional verified application ID, and separate save versus save-and-connect actions. Credential values remain write-only; pasted source text is discarded. A failed identity check does not alter credentials or binding state. Save-and-connect commits the binding before starting the socket, so connection errors describe a saved configuration without claiming an active connection.

Group access remains restricted unless the user explicitly saves allowAllGroups. Missing optional fields in old settings mean false; the shared bridge honors this option for InfoFlow only. Platform mention decoding remains mandatory, and private-chat allowlists are independent. Groups explicitly created by DSH retain their existing managed membership rules.

The authenticated Remote test command sends fixed text only to an account on the saved private-chat allowlist. It performs no model execution, room creation, connection activation, or manager-level send retry. Error 40070 is translated from the pinned SDK business-code format without exposing its raw message. The UI distinguishes send confirmation from the user-observed inbound reply.

Verification covers credential parsing and masked UI flow, identity mismatch without writes, explicit connection and group access, test-recipient restrictions, redacted SDK failures, and a packaged native Host using deterministic transport and model fixtures. Real enterprise visibility and reply delivery still require the account owner’s live test.
