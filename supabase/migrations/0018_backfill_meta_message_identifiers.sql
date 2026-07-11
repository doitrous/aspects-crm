-- Recover message identifiers omitted by historical n8n normalized records.
-- The complete native Meta event was retained in raw_payload, so this is a
-- deterministic repair and does not invent data.

set search_path = public, extensions;

update public.crm_messages message
set
  platform_message_id = message.raw_payload #>> '{message,mid}',
  sender_id = coalesce(message.sender_id, message.raw_payload #>> '{sender,id}'),
  recipient_id = coalesce(message.recipient_id, message.raw_payload #>> '{recipient,id}')
where message.platform_message_id is null
  and nullif(message.raw_payload #>> '{message,mid}', '') is not null
  and not exists (
    select 1
    from public.crm_messages existing
    where existing.id <> message.id
      and existing.platform = message.platform
      and existing.platform_message_id = message.raw_payload #>> '{message,mid}'
  );

update public.crm_messages message
set
  sender_id = coalesce(message.sender_id, message.raw_payload #>> '{sender,id}'),
  recipient_id = coalesce(message.recipient_id, message.raw_payload #>> '{recipient,id}')
where (message.sender_id is null or message.recipient_id is null)
  and (
    nullif(message.raw_payload #>> '{sender,id}', '') is not null
    or nullif(message.raw_payload #>> '{recipient,id}', '') is not null
  );
