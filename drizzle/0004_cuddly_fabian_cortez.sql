CREATE TYPE "public"."credit_posting_status" AS ENUM('PENDING', 'POSTED', 'MISSING', 'DISPUTED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."payment_route" AS ENUM('PREPAID_VIA_ISSUER', 'DEPOSIT_TO_HOTEL', 'PAY_AT_PROPERTY');--> statement-breakpoint
CREATE TABLE "credit_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bucket_id" uuid,
	"booking_id" uuid,
	"expected_cents" integer NOT NULL,
	"posted_cents" integer,
	"charged_on" date NOT NULL,
	"posted_on" date,
	"status" "credit_posting_status" DEFAULT 'PENDING' NOT NULL,
	"merchant_descriptor" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_route" "payment_route";--> statement-breakpoint
ALTER TABLE "credit_postings" ADD CONSTRAINT "credit_postings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_postings" ADD CONSTRAINT "credit_postings_bucket_id_credit_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."credit_buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_postings" ADD CONSTRAINT "credit_postings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_postings_user_status_charged_idx" ON "credit_postings" USING btree ("user_id","status","charged_on");