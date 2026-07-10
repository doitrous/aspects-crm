# Aspects Clinica CRM Integrations

This repository connects only to Aspects Clinica systems.

## Booking and Admin Scheduling

The CRM reads and writes the canonical Aspects booking/Admin project through the
server-only `BOOKING_SUPABASE_URL` and `BOOKING_SUPABASE_SERVICE_ROLE_KEY`.
Doctors, specialties, services, branches, schedules, blocked times, slots, and
appointments are not duplicated into a second CRM availability database.

The CRM Booking drawer and Calendar use the same booking tables. Website
reservations are linked to canonical CRM leads by booking appointment ID, with
normalized phone as the fallback. The reservation ingest receiver is
`POST /api/ingest/reservation` and requires `CRM_INGEST_API_KEY`.

## Facebook and Instagram

Meta webhooks enter through `POST /api/webhooks/meta`. Signatures and ingest
credentials are validated server-side. Normalized conversation content is
stored in the canonical CRM conversation/message tables; receipts, reactions,
and referrals remain distinct event records.

## WhatsApp

Normalized WhatsApp records enter through `POST /api/crm/ingest/whatsapp` using
`WHATSAPP_INGEST_API_KEY` or `CRM_INGEST_API_KEY`. Access tokens and phone/account
IDs remain server-only. When credentials are absent, the drawer reports that the
integration is not configured and does not fabricate messages or connection
state. Outbound WhatsApp sending still requires provider credentials and is not
claimed as verified.

## Email

Resend delivery uses the server-only `RESEND_API_KEY` and `EMAIL_FROM`. Missing
credentials produce a persisted skipped result, never a fabricated delivery.
The overdue route requires `CRON_SECRET`.

## Required Deployment Variables

See `.env.example` for the complete list. At minimum, production requires the
CRM Supabase URL/anonymous/service-role values and the booking Supabase
URL/service-role values. Integration secrets must never use `NEXT_PUBLIC_`.
