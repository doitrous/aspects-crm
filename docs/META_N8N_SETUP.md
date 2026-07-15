# Meta → n8n → CRM: lossless capture and working chat links

Use the existing real-time Meta workflow. Do not create a separate workflow
just for chat links. Add a raw-capture branch immediately after the existing
Meta Webhook node, then add a second enrichment branch for conversation links.

The recommended shape is:

```text
Meta Webhook
├─ CRM — Capture Raw Meta ── Respond to Webhook (200)
└─ Extract Meta Link Candidates ── Add Meta Inbox Fallback ── Switch Platform
   ├─ Facebook Conversations API ── Build FB Link Enrichment ── CRM — Save Link
   └─ Instagram Conversations API ── Build IG Link Enrichment ── CRM — Save Link
```

The first branch is authoritative and runs before Meta receives success. The
link branch may safely replay the same message: CRM dedupes the bubble by Meta
message ID while applying the newer link metadata.

## Credentials to create in n8n

Create these as **Header Auth** credentials. Do not place tokens in Code nodes.

1. `Aspects CRM Ingest`
   - Name: `Authorization`
   - Value: `Bearer <CRM_INGEST_API_KEY>`
2. `Meta Facebook Page`
   - Name: `Authorization`
   - Value: `Bearer <FACEBOOK_PAGE_ACCESS_TOKEN>`
3. `Meta Instagram Messaging`
   - Name: `Authorization`
   - Value: `Bearer <INSTAGRAM_USER_OR_PAGE_ACCESS_TOKEN>`

## Node 1: CRM — Capture Raw Meta

Add an **HTTP Request** node directly after the existing Meta Webhook node.

- Method: `POST`
- URL: `https://<CRM-DOMAIN>/api/crm/ingest/message`
- Authentication: `Generic Credential Type`
- Generic Auth Type: `Header Auth`
- Credential: `Aspects CRM Ingest`
- Send Headers: on
- Header: `Content-Type` = `application/json`
- Send Body: on
- Body Content Type: `JSON`
- Specify Body: `Using JSON`
- JSON expression: `={{ $json.body ?? $json }}`

If the n8n version requires a string in the JSON editor, use:

```text
={{ JSON.stringify($json.body ?? $json) }}
```

Node **Settings**:

- Retry On Fail: on
- Max Tries: `5`
- Wait Between Tries: `2000` ms
- On Error / Continue On Fail: off

This one endpoint intentionally accepts both DMs and comments, even if a
comment arrives on the message URL. The response must contain `ok: true`.
Anything else must fail the execution and must not be acknowledged as captured.

If the current Webhook node responds immediately, change its response mode to
**Using Respond to Webhook**. Put the existing `Respond to Webhook` success node
after `CRM — Capture Raw Meta`, with status `200` and body `EVENT_RECEIVED`.
Keep the existing Meta verification/challenge path unchanged.

## Node 2: Extract Meta Link Candidates

Create a second connection from the Meta Webhook node to a **Code** node.

- Name: `Extract Meta Link Candidates`
- Mode: `Run Once for All Items`
- Paste the complete contents of `docs/meta-n8n-link-candidates.js`.

This branch emits only actual Messenger/Instagram content messages. Comments,
receipts, reactions, edits and all other events were already persisted in full
by the raw-capture branch.

## Node 3: Add Meta Inbox Fallback

Add an **Edit Fields (Set)** node.

- Name: `Add Meta Inbox Fallback`
- Keep Only Set Fields: off (or Include Other Input Fields: on)
- Add string field `fallback_inbox_link`
- Value: paste the Business Suite Inbox URL that works while signed in as the
  clinic moderator
- Add string field `page_inbox_link` with the same value

Do not guess this URL. Open the clinic's Business Suite Inbox in the browser,
copy the working URL, and paste it here. It is the safe fallback when Meta does
not expose a supported browser deep link.

## Node 4: Switch Platform

Add a **Switch** node using expression `={{ $json.platform }}`.

- Output 1: equals `facebook`
- Output 2: equals `instagram`
- Fallback Output: none

## Node 5A: Facebook Conversations API

On the Facebook output, add an **HTTP Request** node.

- Method: `GET`
- URL: `https://graph.facebook.com/v24.0/{{ $json.page_id }}/conversations`
- Authentication: `Generic Credential Type` → `Header Auth`
- Credential: `Meta Facebook Page`
- Send Query Parameters: on
- `user_id` = `={{ $json.platform_user_id }}`
- `fields` = `id,link,updated_time`
- Send Body: off
- Retry On Fail: on; Max Tries `5`; wait `2000` ms
- Continue On Fail: off

Meta returns a relative `link` for supported Messenger conversations. The next
Code node converts it to an absolute `https://www.facebook.com/...` URL.

## Node 5B: Instagram Conversations API

On the Instagram output, add an **HTTP Request** node.

- Method: `GET`
- URL: `https://graph.instagram.com/v24.0/{{ $json.instagram_account_id }}/conversations`
- Authentication: `Generic Credential Type` → `Header Auth`
- Credential: `Meta Instagram Messaging`
- Send Query Parameters: on
- `user_id` = `={{ $json.platform_user_id }}`
- Send Body: off
- Retry On Fail: on; Max Tries `5`; wait `2000` ms
- Continue On Fail: off

The documented Instagram response reliably supplies the conversation ID but
does not promise a browser `link`. CRM therefore stores the conversation ID and
uses the Business Suite Inbox fallback when `link` is absent.

## Node 6: Build link enrichment

After each Conversations API node, add a **Code** node.

- Names: `Build FB Link Enrichment` and `Build IG Link Enrichment`
- Mode: `Run Once for Each Item`
- Paste `docs/meta-n8n-build-link-enrichment.js` into both nodes.

The script references `Add Meta Inbox Fallback` by name. Keep that node name
exactly, or change the reference in the script.

## Node 7: CRM — Save Link

After each Build node, add an **HTTP Request** node with the same settings as
`CRM — Capture Raw Meta`, except the JSON body is:

```text
={{ $json }}
```

The same Meta message ID makes this an idempotent enrichment replay: it does
not create another bubble or another lead.

## Required Meta webhook subscriptions

In the Meta App Dashboard, verify the clinic account is actually subscribed.
At minimum:

- Facebook Page: `feed` for public comments plus the available Messenger
  message, echo, postback, seen/delivery and reaction fields.
- Instagram professional account: `comments`, `live_comments`, `messages`,
  `messaging_postbacks`, `messaging_seen`, `message_reactions`, `standby`, and
  `messaging_referral` where available.

Also verify the app/account subscriptions through the corresponding
`/<ACCOUNT_ID>/subscribed_apps` Graph API endpoint. Receiving DMs does not prove
that `comments` or `feed` is subscribed.

## Recovering a comment that was already missed

Fixing the webhook does not make Meta replay an old event. Fetch the missing
comment from the Graph API (or run a short recent-comments reconciliation),
then POST the returned raw/normalized comment to:

```text
POST https://<CRM-DOMAIN>/api/crm/ingest/comment
Authorization: Bearer <CRM_INGEST_API_KEY>
Content-Type: application/json
```

Keep a separate scheduled reconciliation workflow as a backstop if the clinic
needs recovery from n8n downtime or a temporarily disabled Meta subscription.
That workflow is for recovery; the real-time link enrichment stays in the
existing webhook workflow.
