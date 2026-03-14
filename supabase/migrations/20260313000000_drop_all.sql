-- Drop everything Prisma may have created so we can start clean
-- Run this before the initial_schema migration

drop table if exists "ContactBypassLog" cascade;
drop table if exists "Payout" cascade;
drop table if exists "Dispute" cascade;
drop table if exists "Review" cascade;
drop table if exists "Message" cascade;
drop table if exists "OrderPhoto" cascade;
drop table if exists "OrderStageUpdate" cascade;
drop table if exists "Order" cascade;
drop table if exists "OfflineOrder" cascade;
drop table if exists "TailorClient" cascade;
drop table if exists "PortfolioPhoto" cascade;
drop table if exists "TailorProfile" cascade;
drop table if exists "CustomerProfile" cascade;
drop table if exists "User" cascade;

-- Drop any enums Prisma may have created
drop type if exists "UserRole" cascade;
drop type if exists "GarmentContext" cascade;
drop type if exists "BodyShape" cascade;
drop type if exists "FitStyle" cascade;
drop type if exists "TailorTier" cascade;
drop type if exists "AvailabilityStatus" cascade;
drop type if exists "FabricSource" cascade;
drop type if exists "DeliveryMethod" cascade;
drop type if exists "OrderStage" cascade;
drop type if exists "Currency" cascade;
drop type if exists "PaymentProvider" cascade;
drop type if exists "DisputeStatus" cascade;
drop type if exists "ClientType" cascade;
drop type if exists "MessageType" cascade;

-- Also drop snake_case versions if they exist from a partial run
drop table if exists contact_bypass_logs cascade;
drop table if exists payouts cascade;
drop table if exists disputes cascade;
drop table if exists reviews cascade;
drop table if exists messages cascade;
drop table if exists order_photos cascade;
drop table if exists order_stage_updates cascade;
drop table if exists orders cascade;
drop table if exists offline_orders cascade;
drop table if exists tailor_clients cascade;
drop table if exists portfolio_photos cascade;
drop table if exists tailor_profiles cascade;
drop table if exists customer_profiles cascade;
drop table if exists users cascade;

drop type if exists user_role cascade;
drop type if exists garment_context cascade;
drop type if exists body_shape cascade;
drop type if exists fit_style cascade;
drop type if exists tailor_tier cascade;
drop type if exists availability_status cascade;
drop type if exists fabric_source cascade;
drop type if exists delivery_method cascade;
drop type if exists order_stage cascade;
drop type if exists currency cascade;
drop type if exists payment_provider cascade;
drop type if exists dispute_status cascade;
drop type if exists client_type cascade;
drop type if exists message_type cascade;

-- Drop functions
drop function if exists handle_updated_at() cascade;
drop function if exists handle_new_user() cascade;
drop function if exists auth_uid() cascade;
