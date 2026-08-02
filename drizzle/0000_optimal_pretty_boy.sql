CREATE TYPE "public"."booking_status" AS ENUM('ACTIVE', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."card_kind" AS ENUM('AMEX_PLATINUM', 'CSR', 'CSR_BUSINESS', 'JPM_RESERVE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('ELIGIBLE', 'PREPARING', 'SUBMITTED', 'APPROVED', 'PARTIAL', 'DENIED', 'EXPIRED', 'NOT_PURSUED');--> statement-breakpoint
CREATE TYPE "public"."comparison_status" AS ENUM('DRAFT', 'DECIDED', 'BOOKED', 'ABANDONED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"comparison_id" uuid,
	"channel" text NOT NULL,
	"confirmation_number" text,
	"booked_at" timestamp with time zone NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"total_cents" integer NOT NULL,
	"base_cents" integer NOT NULL,
	"cash_charged_cents" integer,
	"points_used" integer,
	"refundable" boolean NOT NULL,
	"cancel_deadline" date,
	"bucket_id" uuid,
	"status" "booking_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "card_kind" NOT NULL,
	"nickname" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"competing_rate_id" uuid,
	"kind" text NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"status" "claim_status" DEFAULT 'ELIGIBLE' NOT NULL,
	"claimed_gap_cents" integer,
	"awarded_cents" integer,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"denial_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid,
	"property_id" uuid,
	"property_name_snapshot" text NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"nights" integer NOT NULL,
	"adults" integer DEFAULT 2 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"rooms" integer DEFAULT 1 NOT NULL,
	"room_type" text,
	"bed_type" text,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	"realization_pct" integer DEFAULT 100 NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"status" "comparison_status" DEFAULT 'DRAFT' NOT NULL,
	"chosen_channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competing_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comparison_id" uuid NOT NULL,
	"site_domain" text NOT NULL,
	"url" text NOT NULL,
	"base_cents" integer NOT NULL,
	"tax_cents" integer,
	"refundable" boolean NOT NULL,
	"publicly_available" boolean NOT NULL,
	"room_type" text,
	"bed_type" text,
	"adults" integer,
	"children" integer,
	"currency" char(3),
	"screenshot_key" text,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"face_cents" integer NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"consumed_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_buckets_user_key_window_start_unique" UNIQUE("user_id","key","window_start")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"country" char(2),
	"brand" text DEFAULT 'NONE' NOT NULL,
	"in_fhr" boolean DEFAULT false NOT NULL,
	"in_thc" boolean DEFAULT false NOT NULL,
	"in_edit" boolean DEFAULT false NOT NULL,
	"property_credit_face_cents" integer DEFAULT 10000 NOT NULL,
	"property_credit_kind" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comparison_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"label" text,
	"total_cents" integer NOT NULL,
	"prepaid" boolean NOT NULL,
	"refundable" boolean NOT NULL,
	"source_url" text,
	"captured_at" timestamp with time zone,
	"sort_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "savings_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"claim_id" uuid,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"realized" boolean DEFAULT false NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"destination" text,
	"start_date" date,
	"end_date" date,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mr_value_micro" integer DEFAULT 15000 NOT NULL,
	"ur_value_micro" integer DEFAULT 17500 NOT NULL,
	"breakfast_per_day_cents" integer DEFAULT 7000 NOT NULL,
	"fora_rate_bps" integer DEFAULT 700 NOT NULL,
	"fora_member" boolean DEFAULT false NOT NULL,
	"cardmember_anniversary" date,
	"home_currency" char(3) DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"cadence_days" integer DEFAULT 7 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bucket_id_credit_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."credit_buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_competing_rate_id_competing_rates_id_fk" FOREIGN KEY ("competing_rate_id") REFERENCES "public"."competing_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competing_rates" ADD CONSTRAINT "competing_rates_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_buckets" ADD CONSTRAINT "credit_buckets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_buckets" ADD CONSTRAINT "credit_buckets_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_flags" ADD CONSTRAINT "rule_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_events" ADD CONSTRAINT "savings_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_events" ADD CONSTRAINT "savings_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_events" ADD CONSTRAINT "savings_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_user_booked_idx" ON "bookings" USING btree ("user_id","booked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "claims_user_deadline_pending_idx" ON "claims" USING btree ("user_id","deadline_at") WHERE "claims"."status" IN ('ELIGIBLE', 'PREPARING');--> statement-breakpoint
CREATE INDEX "comparisons_user_created_idx" ON "comparisons" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "properties_lower_name_idx" ON "properties" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "properties_city_idx" ON "properties" USING btree ("city");--> statement-breakpoint
CREATE INDEX "savings_events_user_occurred_idx" ON "savings_events" USING btree ("user_id","occurred_on");