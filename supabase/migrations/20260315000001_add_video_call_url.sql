-- Add video call URL for Daily.co consultation rooms
alter table orders add column if not exists video_call_url text;
