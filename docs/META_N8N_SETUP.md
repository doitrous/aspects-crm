# Meta → n8n → CRM: lossless capture and working chat links

Use the existing real-time Meta workflow. The authoritative path is raw event
capture; the CRM constructs the Business Suite conversation URL from normalized
account, participant, post, media, and ad identifiers. URLs supplied by legacy
n8n enrichment nodes are retained only as source metadata and are not trusted
as the final browser destination.

The recommended live shape is:

```text
Meta Webhook → CRM — Capture Raw Meta → Respond to Webhook (200)
```

Do not add Graph conversation lookups merely to construct browser links. The
tracked `meta-n8n-link-candidates.js` and `meta-n8n-build-link-enrichment.js`
files describe the former enrichment path and are retained for migration
history, not as the preferred deployment.

## Credential to create in n8n

Create one **Header Auth** credential named `Aspects CRM Ingest`:

- Name: `Authorization`
- Value: `Bearer <CRM_INGEST_API_KEY>`

Never place tokens in Code nodes or exported workflow JSON.

## CRM — Capture Raw Meta

Add an **HTTP Request** node directly after the existing Meta Webhook node.

- Method: `POST`
- URL: `https://<CRM-DOMAIN>/api/crm/ingest/message`
- Authentication: `Generic Credential Type`
- Generic Auth Type: `Header Auth`
- Credential: `Aspects CRM Ingest`
- Header: `Content-Type` = `application/json`
- Body Content Type: `JSON`
- JSON expression: `={{ $json.body ?? $json }}`

If the n8n version requires a string in the JSON editor, use:

```text
={{ JSON.stringify($json.body ?? $json) }}
```

Node settings:

- Retry On Fail: on
- Max Tries: `5`
- Wait Between Tries: `2000` ms
- On Error / Continue On Fail: off

This endpoint accepts both DMs and comments. The response must contain
`ok: true`; anything else must fail the execution and must not be acknowledged
as captured.

If the Webhook node responds immediately, change it to **Using Respond to
Webhook**. Put the success response after `CRM — Capture Raw Meta`, with status
`200` and body `EVENT_RECEIVED`. Keep Meta verification/challenge handling
unchanged.

## CRM-generated Business Suite routes

The CRM derives channel-specific routes from normalized data:

| Event | Inbox route | Thread type |
|---|---|---|
| Facebook Messenger | `/latest/inbox/all` | `FB_MESSAGE` |
| Instagram DM | `/latest/inbox/instagram_direct` | `IG_MESSAGE` |
| Facebook page/ad comment | `/latest/inbox/facebook` | `FB_PAGE_POST` or `FB_AD_POST` |
| Instagram comment | `/latest/inbox/instagram` | `INSTAGRAM_POST` |

Each generated URL includes the configured `asset_id`, `business_id`,
`mailbox_id`, and the event-specific `selected_item_id`. Configure the public
routing identifiers with the variable names documented in `.env.example`; do
not copy account secrets into source.

## Retiring the legacy enrichment branch

The active n8neurocure workflow still contains legacy candidate extraction,
Graph conversation requests, and link-building nodes. They are redundant but
must not be edited casually. Before disabling or deleting them:

1. Export and sanitize the complete live workflow JSON.
2. Record the active workflow ID and credential bindings by name only.
3. Keep the raw-capture branch and Meta verification path unchanged.
4. Disable the enrichment branch in a controlled change window.
5. Replay synthetic DM/comment payloads and verify all four routes above.
6. Restore the exported workflow if capture or link behavior regresses.

## Required Meta webhook subscriptions

In the Meta App Dashboard, verify the clinic account is subscribed. At minimum:

- Facebook Page: `feed` plus the available Messenger message, echo, postback,
  seen/delivery, and reaction fields.
- Instagram professional account: `comments`, `live_comments`, `messages`,
  `messaging_postbacks`, `messaging_seen`, `message_reactions`, `standby`, and
  `messaging_referral` where available.

Also verify subscriptions through the corresponding
`/<ACCOUNT_ID>/subscribed_apps` Graph endpoint. Receiving DMs does not prove
that `comments` or `feed` is subscribed.

## Recovering an event already missed

Fixing a webhook does not make Meta replay an old event. Fetch the missing
event from Graph or run a recent-event reconciliation, then send it to the
appropriate CRM ingest route with `Aspects CRM Ingest`. A scheduled
reconciliation workflow is a recovery backstop; it does not replace real-time
raw capture.
